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
export const MAX_PAYLOAD_BYTES_LIMIT = 16 * 1024 * 1024;
export const DEFAULT_AUTH_TIMEOUT_MS = 10_000;
// Five minutes is far beyond any real handshake, and keeps the value well
// inside setTimeout's 2^31-1 ms range (beyond it Node fires after 1 ms).
export const MAX_AUTH_TIMEOUT_MS = 300_000;

export class WebSocketConfigError extends Error {}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || host.startsWith('127.');
}

function isPlaceholder(token: string): boolean {
  // Repository placeholders (CHANGE_ME_*, any case) and an unresolved `${VAR}`
  // reference are both public strings, never a secret.
  return token.toUpperCase().startsWith('CHANGE_ME') || /^\$\{.*\}$/.test(token);
}

/** Which source supplies the token: the environment wins unless it is empty. */
function tokenFromEnvironment(env: NodeJS.ProcessEnv): string | undefined {
  return env[TOKEN_ENV_VAR] || undefined;
}

/**
 * Human-readable origin of the token, for the startup log. Never contains the
 * token itself. Says so when the variable exists but is empty, because that
 * silently falls back to agent.yaml.
 */
export function describeTokenSource(raw: RawWebSocketConfig, env: NodeJS.ProcessEnv = process.env): string {
  if (tokenFromEnvironment(env)) return `environment (${TOKEN_ENV_VAR})`;
  if (env[TOKEN_ENV_VAR] !== undefined) return `agent.yaml (${TOKEN_ENV_VAR} is set but empty)`;
  return raw.auth?.token ? 'agent.yaml' : 'none';
}

function resolveToken(raw: RawWebSocketConfig, env: NodeJS.ProcessEnv): string {
  const token = tokenFromEnvironment(env) ?? raw.auth?.token ?? '';
  if (!token) {
    throw new WebSocketConfigError(`No WebSocket token configured: set ${TOKEN_ENV_VAR}`);
  }
  if (isPlaceholder(token)) {
    throw new WebSocketConfigError(`WebSocket token is a placeholder: set ${TOKEN_ENV_VAR} to a real secret`);
  }
  // Refused rather than trimmed: the client would have to send the exact same
  // padding, so a stray space or newline is a configuration error to surface.
  if (token !== token.trim()) {
    throw new WebSocketConfigError('WebSocket token has leading or trailing whitespace');
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new WebSocketConfigError(`WebSocket token is shorter than ${MIN_TOKEN_LENGTH} characters`);
  }
  if (new Set(token).size === 1) {
    throw new WebSocketConfigError('WebSocket token is a single repeated character');
  }
  return token;
}

function positiveInteger(value: unknown, fallback: number, name: string, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > max) {
    throw new WebSocketConfigError(`websocket.${name} must be an integer between 1 and ${max}`);
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

  const port = positiveInteger(raw.port, DEFAULT_PORT, 'port', 65535);

  const origins = raw.allowed_origins ?? [];
  if (!Array.isArray(origins) || origins.some((o) => typeof o !== 'string')) {
    throw new WebSocketConfigError('websocket.allowed_origins must be a list of strings');
  }

  return {
    port,
    host: raw.host || DEFAULT_HOST,
    token: resolveToken(raw, env),
    maxPayloadBytes: positiveInteger(raw.max_payload_bytes, DEFAULT_MAX_PAYLOAD_BYTES, 'max_payload_bytes', MAX_PAYLOAD_BYTES_LIMIT),
    authTimeoutMs: positiveInteger(raw.auth_timeout_ms, DEFAULT_AUTH_TIMEOUT_MS, 'auth_timeout_ms', MAX_AUTH_TIMEOUT_MS),
    allowedOrigins: origins,
  };
}
