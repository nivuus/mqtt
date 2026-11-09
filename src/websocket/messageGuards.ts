// src/websocket/messageGuards.ts
//
// Authentication and request-shape checks for the wizard WebSocket channel.

import { createHash, timingSafeEqual } from 'crypto';
import { AuthMessage, WizardCommand } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Constant-time token comparison. Both sides are hashed first so that the
 * comparison neither short-circuits on the first differing byte nor leaks the
 * expected token's length (timingSafeEqual requires equal-length buffers).
 */
export function tokensMatch(presented: unknown, expected: string): boolean {
  if (typeof presented !== 'string' || expected.length === 0) return false;
  const a = createHash('sha256').update(presented, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

export function isAuthMessage(message: unknown): message is AuthMessage {
  return isRecord(message) && message.type === 'auth' && typeof message.token === 'string';
}

export function isWizardCommand(message: unknown): message is WizardCommand {
  return (
    isRecord(message) &&
    typeof message.id === 'string' &&
    typeof message.type === 'string' &&
    typeof message.feature === 'string' &&
    typeof message.action === 'string' &&
    (message.params === undefined || isRecord(message.params))
  );
}

/**
 * Browsers always send an Origin header on a WebSocket upgrade; the Home
 * Assistant client (python `websockets`) sends none. Refusing any Origin that
 * is not explicitly allowed blocks cross-site WebSocket hijacking from a web
 * page open on a machine that can reach the listener.
 */
export function isOriginAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  return origin === undefined || allowed.includes(origin);
}
