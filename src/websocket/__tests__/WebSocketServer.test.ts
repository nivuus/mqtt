// src/websocket/__tests__/WebSocketServer.test.ts
//
// Exercises the real server over loopback sockets: authentication, closing on
// failure or timeout, payload limit, Origin refusal, and no token in logs.

import WebSocket from 'ws';
import { WebSocketServer, CommandHandler } from '../WebSocketServer';
import { WebSocketConfig } from '../types';
import logger from '../../utils/logger';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), setLevel: jest.fn() },
}));

const TOKEN = 'secret-token-0123456789abcdef0123456789';

function baseConfig(overrides: Partial<WebSocketConfig> = {}): WebSocketConfig {
  return {
    host: '127.0.0.1', port: 0, token: TOKEN, maxPayloadBytes: 1024, authTimeoutMs: 2000, allowedOrigins: [],
    ...overrides,
  };
}

/** Connects and records every message plus the close code. */
function connect(port: number, options: WebSocket.ClientOptions = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, options);
  const messages: any[] = [];
  const queue: Array<(m: any) => void> = [];
  ws.on('message', (data) => {
    const parsed = JSON.parse(data.toString());
    const waiter = queue.shift();
    if (waiter) waiter(parsed); else messages.push(parsed);
  });
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  const next = () => new Promise<any>((resolve) => {
    const pending = messages.shift();
    if (pending !== undefined) resolve(pending); else queue.push(resolve);
  });
  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return { ws, next, closed, opened };
}

describe('WebSocketServer', () => {
  let server: WebSocketServer;
  let handler: jest.Mocked<CommandHandler>;

  async function startWith(config: WebSocketConfig): Promise<number> {
    server = new WebSocketServer(config, handler);
    await server.start();
    return server.port;
  }

  beforeEach(() => {
    handler = { handleCommand: jest.fn().mockResolvedValue({ ok: true }) };
  });

  afterEach(async () => {
    await server.stop();
  });

  it('runs commands only after a valid token', async () => {
    const port = await startWith(baseConfig());
    const client = connect(port);
    expect((await client.next()).type).toBe('auth_required');
    client.ws.send(JSON.stringify({ type: 'auth', token: TOKEN }));
    expect(await client.next()).toEqual({ type: 'auth_result', success: true });
    expect((await client.next()).id).toBe('welcome');

    client.ws.send(JSON.stringify({ id: 'c1', type: 'action', feature: 'vm', action: 'list_vms', params: {} }));
    expect(await client.next()).toEqual({ id: 'c1', success: true, data: { ok: true } });
    expect(handler.handleCommand).toHaveBeenCalledTimes(1);
    client.ws.close();
  });

  it('closes the connection on a wrong token and never runs the command', async () => {
    const port = await startWith(baseConfig());
    const client = connect(port);
    await client.next();
    client.ws.send(JSON.stringify({ type: 'auth', token: TOKEN.slice(0, -1) + 'X' }));
    expect(await client.next()).toMatchObject({ type: 'auth_result', success: false });
    expect(await client.closed).toBe(1008);
    expect(handler.handleCommand).not.toHaveBeenCalled();
  });

  it('closes the connection when a command is sent before authenticating', async () => {
    const port = await startWith(baseConfig());
    const client = connect(port);
    await client.next();
    client.ws.send(JSON.stringify({ id: 'c1', type: 'action', feature: 'vm', action: 'start_vm' }));
    expect(await client.closed).toBe(1008);
    expect(handler.handleCommand).not.toHaveBeenCalled();
  });

  it('closes a connection that does not authenticate in time', async () => {
    const port = await startWith(baseConfig({ authTimeoutMs: 50 }));
    const client = connect(port);
    expect(await client.closed).toBe(1008);
  });

  it('rejects a message larger than the payload limit', async () => {
    const port = await startWith(baseConfig({ maxPayloadBytes: 64 }));
    const client = connect(port);
    await client.next();
    client.ws.send(JSON.stringify({ type: 'auth', token: 'x'.repeat(200) }));
    expect(await client.closed).toBe(1009);
  });

  it('refuses a browser Origin that is not allowlisted', async () => {
    const port = await startWith(baseConfig());
    const client = connect(port, { origin: 'https://evil.example' });
    await expect(client.opened).rejects.toThrow(/403/);
  });

  it('accepts an allowlisted Origin', async () => {
    const port = await startWith(baseConfig({ allowedOrigins: ['http://ha.local:8123'] }));
    const client = connect(port, { origin: 'http://ha.local:8123' });
    await client.opened;
    expect((await client.next()).type).toBe('auth_required');
    client.ws.close();
  });

  it('never writes the token to the logs', async () => {
    const port = await startWith(baseConfig());
    const client = connect(port);
    await client.next();
    client.ws.send(JSON.stringify({ type: 'auth', token: TOKEN }));
    await client.next();
    const logged = (['debug', 'info', 'warn', 'error'] as const)
      .flatMap((level) => (logger[level] as jest.Mock).mock.calls.flat())
      .map(String).join('\n');
    expect(logged).not.toContain(TOKEN);
    client.ws.close();
  });
});
