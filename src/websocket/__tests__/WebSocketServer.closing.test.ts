// src/websocket/__tests__/WebSocketServer.closing.test.ts
//
// Once the server decides to drop a connection, nothing else read from that
// socket may run. In `ws` a closed-but-not-yet-acknowledged socket (CLOSING)
// still emits `message`, so these tests write frames over a raw TCP socket
// that never answers the server's close frame.

import { Socket } from 'net';
import { WebSocketServer, CommandHandler } from '../WebSocketServer';
import { WebSocketConfig } from '../types';
import { rawConnect, textFrame, writeQuietly, delay } from './rawClient';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), setLevel: jest.fn() },
}));

const TOKEN = 'secret-token-0123456789abcdef0123456789';
const COMMAND = { id: 'c1', type: 'action', feature: 'vm', action: 'start_vm', params: {} };

function config(overrides: Partial<WebSocketConfig> = {}): WebSocketConfig {
  return {
    host: '127.0.0.1', port: 0, token: TOKEN, maxPayloadBytes: 4096, authTimeoutMs: 2000, allowedOrigins: [],
    ...overrides,
  };
}

describe('WebSocketServer — dropped connections stay dropped', () => {
  let server: WebSocketServer;
  let handler: jest.Mocked<CommandHandler>;
  let socket: Socket | null = null;

  beforeEach(() => {
    handler = { handleCommand: jest.fn().mockResolvedValue({ ok: true }) };
  });

  afterEach(async () => {
    socket?.destroy();
    socket = null;
    await server.stop();
  });

  async function start(overrides: Partial<WebSocketConfig> = {}): Promise<number> {
    server = new WebSocketServer(config(overrides), handler);
    await server.start();
    return server.port;
  }

  it('ignores a good auth and a command that follow a bad auth in the same burst', async () => {
    socket = await rawConnect(await start());
    await writeQuietly(socket, Buffer.concat([
      textFrame({ type: 'auth', token: 'not-the-token' }),
      textFrame({ type: 'auth', token: TOKEN }),
      textFrame(COMMAND),
    ]));
    await delay(200);
    expect(handler.handleCommand).not.toHaveBeenCalled();
    expect(server.authenticatedClientCount).toBe(0);
  });

  it('ignores a good auth and a command sent after the auth deadline', async () => {
    socket = await rawConnect(await start({ authTimeoutMs: 50 }));
    await delay(150);
    await writeQuietly(socket, Buffer.concat([textFrame({ type: 'auth', token: TOKEN }), textFrame(COMMAND)]));
    await delay(200);
    expect(handler.handleCommand).not.toHaveBeenCalled();
    expect(server.authenticatedClientCount).toBe(0);
  });

  it('drops the TCP connection right after refusing authentication', async () => {
    socket = await rawConnect(await start());
    const ended = new Promise<void>((resolve) => socket!.once('close', () => resolve()));
    await writeQuietly(socket, textFrame({ type: 'auth', token: 'not-the-token' }));
    await expect(Promise.race([ended.then(() => 'closed'), delay(1000).then(() => 'open')]))
      .resolves.toBe('closed');
  });

  it('stops promptly even when a client never answers the close frame', async () => {
    socket = await rawConnect(await start());
    const startedAt = Date.now();
    await server.stop();
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('destroys an upgrade request that arrives after stop()', async () => {
    await start();
    await server.stop();
    const fakeSocket = { on: jest.fn(), destroy: jest.fn(), end: jest.fn(), remoteAddress: '127.0.0.1' };
    const upgrade = (server as unknown as { handleUpgrade: Function }).handleUpgrade.bind(server);
    upgrade({ headers: {} }, fakeSocket, Buffer.alloc(0));
    expect(fakeSocket.destroy).toHaveBeenCalled();
  });
});
