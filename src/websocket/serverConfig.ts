// src/websocket/serverConfig.ts
//
// Turns the raw `websocket:` section of agent.yaml (plus the environment) into
// a validated WebSocketConfig. This channel drives root-level actions on the
// host, so any configuration that would leave it unauthenticated or guarded by
// a publicly known secret is refused here, before a socket is ever opened.

import { WebSocketConfig } from './types';

/** Raw shape of the `websocket:` section as read from agent.yaml. */
export interface RawWebSocketConfig {
  enabled?: boolean;
  port?: number;
  host?: string;
  auth?: { type?: string; token?: string };
  max_payload_bytes?: number;
  auth_timeout_ms?: number;
  allowed_origins?: string[];
}

/** Environment variable that carries the token (wins over agent.yaml). */
export const TOKEN_ENV_VAR = 'NIVUUS_WS_TOKEN';

/**
 * A token shorter than this is refused. 32 characters of a random base64 or
 * hex string carry at least 128 bits, which makes guessing it infeasible.
 * Generate one with `openssl rand -hex 32`.
 */
export const MIN_TOKEN_LENGTH = 32;

// HA runs with `network_mode: host`, so it reaches the agent over loopback.
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8766;
// A .ovpn profile with inline certificates is a few tens of KiB; 1 MiB is
// generous for every wizard command while bounding memory per message
// (the `ws` default is 100 MiB).
export const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;
export const DEFAULT_AUTH_TIMEOUT_MS = 10_000;

export class WebSocketConfigError extends Error {}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || host.startsWith('127.');
}

function isPlaceholder(token: string): boolean {
  // Repository placeholders (CHANGE_ME_*) and an unresolved `${VAR}` reference
  // are both public strings, never a secret.
  return token.startsWith('CHANGE_ME') || /^\$\{.*\}$/.test(token);
}

function resolveToken(raw: RawWebSocketConfig, env: NodeJS.ProcessEnv): string {
  const token = env[TOKEN_ENV_VAR] || raw.auth?.token || '';
  if (!token) {
    throw new WebSocketConfigError(`No WebSocket token configured: set ${TOKEN_ENV_VAR}`);
  }
  if (isPlaceholder(token)) {
    throw new WebSocketConfigError(`WebSocket token is a placeholder: set ${TOKEN_ENV_VAR} to a real secret`);
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new WebSocketConfigError(`WebSocket token is shorter than ${MIN_TOKEN_LENGTH} characters`);
  }
  return token;
}

function positiveInteger(value: unknown, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new WebSocketConfigError(`websocket.${name} must be a positive integer`);
  }
  return value;
}

/**
 * Validate the raw section. Returns null when the server is disabled, throws
 * WebSocketConfigError when it is enabled but cannot be run safely.
 */
export function resolveWebSocketConfig(
  raw: RawWebSocketConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): WebSocketConfig | null {
  if (!raw || !raw.enabled) return null;

  const authType = raw.auth?.type ?? 'token';
  if (authType !== 'token') {
    throw new WebSocketConfigError(`Unsupported websocket.auth.type "${authType}": only "token" is accepted`);
  }

  const port = positiveInteger(raw.port, DEFAULT_PORT, 'port');
  if (port > 65535) throw new WebSocketConfigError('websocket.port must be at most 65535');

  const origins = raw.allowed_origins ?? [];
  if (!Array.isArray(origins) || origins.some((o) => typeof o !== 'string')) {
    throw new WebSocketConfigError('websocket.allowed_origins must be a list of strings');
  }

  return {
    port,
    host: raw.host || DEFAULT_HOST,
    token: resolveToken(raw, env),
    maxPayloadBytes: positiveInteger(raw.max_payload_bytes, DEFAULT_MAX_PAYLOAD_BYTES, 'max_payload_bytes'),
    authTimeoutMs: positiveInteger(raw.auth_timeout_ms, DEFAULT_AUTH_TIMEOUT_MS, 'auth_timeout_ms'),
    allowedOrigins: origins,
  };
}
