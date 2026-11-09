// src/websocket/sessionProtocol.ts
//
// Per-connection protocol of the wizard channel: the first message must carry
// the shared token, then each message is a command for the WizardHandler.
// Transport concerns (listening, upgrade, Origin, keep-alive) stay in
// WebSocketServer.ts.

import { WebSocket, RawData } from 'ws';
import logger from '../utils/logger';
import { ConnectedClient, WizardCommand, WizardResponse, WizardEvent, AuthResponse } from './types';
import { isAuthMessage, isWizardCommand, tokensMatch } from './messageGuards';

/** The part of WizardHandler the protocol depends on. */
export interface CommandHandler {
  handleCommand(command: WizardCommand): Promise<unknown>;
}

type OutgoingMessage = WizardResponse | WizardEvent | AuthResponse | { type: 'auth_required'; message: string };

// RFC 6455 close code for a policy violation.
const POLICY_VIOLATION = 1008;

export function sendJson(ws: WebSocket, payload: OutgoingMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

export function sendAuthRequired(ws: WebSocket): void {
  sendJson(ws, {
    type: 'auth_required',
    message: 'Authentication required. Send { "type": "auth", "token": "your_token" }',
  });
}

export function closeUnauthenticated(ws: WebSocket, reason: string): void {
  ws.close(POLICY_VIOLATION, reason);
}

/** Before authentication only a correct auth message is accepted; anything else closes. */
function handleAuth(ws: WebSocket, client: ConnectedClient, message: unknown, token: string): void {
  if (isAuthMessage(message) && tokensMatch(message.token, token)) {
    clearTimeout(client.authTimer);
    client.authenticated = true;
    logger.info(`WebSocket client authenticated: ${client.id}`);
    sendJson(ws, { type: 'auth_result', success: true });
    sendJson(ws, { id: 'welcome', success: true, data: { message: 'Authenticated successfully', clientId: client.id } });
    return;
  }
  logger.warn(`WebSocket authentication failed for client ${client.id} from ${client.remoteAddress}`);
  sendJson(ws, { type: 'auth_result', success: false, error: 'Invalid token' });
  closeUnauthenticated(ws, 'Authentication failed');
}

async function runCommand(ws: WebSocket, command: WizardCommand, handler: CommandHandler): Promise<void> {
  try {
    const result = await handler.handleCommand(command);
    sendJson(ws, { id: command.id, success: true, data: result });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Error handling command ${command.feature}.${command.action}: ${errorMessage}`);
    sendJson(ws, { id: command.id, success: false, error: errorMessage });
  }
}

export async function handleClientMessage(
  ws: WebSocket,
  client: ConnectedClient,
  data: RawData,
  token: string,
  handler: CommandHandler,
): Promise<void> {
  client.lastActivity = new Date();
  let message: unknown;
  try {
    message = JSON.parse(data.toString());
  } catch {
    sendJson(ws, { id: 'error', success: false, error: 'Invalid JSON message' });
    if (!client.authenticated) closeUnauthenticated(ws, 'Authentication failed');
    return;
  }

  if (!client.authenticated) {
    handleAuth(ws, client, message, token);
    return;
  }
  if (!isWizardCommand(message)) {
    sendJson(ws, { id: 'error', success: false, error: 'Unknown message type' });
    return;
  }
  logger.debug(`Received command from ${client.id}: ${message.feature}.${message.action}`);
  await runCommand(ws, message, handler);
}
