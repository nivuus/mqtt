// src/websocket/WebSocketServer.ts

import { WebSocketServer as WSServer, WebSocket, RawData } from 'ws';
import { randomUUID } from 'crypto';
import { createServer, IncomingMessage, Server as HttpServer } from 'http';
import { AddressInfo, Socket } from 'net';
import logger from '../utils/logger';
import { WebSocketConfig, ConnectedClient, WizardEvent } from './types';
import { isOriginAllowed } from './messageGuards';
import { isLoopbackHost } from './serverConfig';
import {
  CommandHandler, closeUnauthenticated, handleClientMessage, sendAuthRequired, sendJson,
} from './sessionProtocol';

export type { CommandHandler } from './sessionProtocol';

const PING_INTERVAL_MS = 30_000;
const IDLE_TIMEOUT_MS = 60_000;

/**
 * WebSocket server for the Nivuus Wizard API (used by Home Assistant).
 * Every connection must present the shared token before any command runs; a
 * wrong token, or none within `authTimeoutMs`, closes the connection.
 */
export class WebSocketServer {
  private httpServer: HttpServer | null = null;
  private wss: WSServer | null = null;
  private readonly clients: Map<WebSocket, ConnectedClient> = new Map();
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(private readonly config: WebSocketConfig, private readonly handler: CommandHandler) {}

  /** Start listening; resolves once bound, rejects if the address cannot be bound. */
  public start(): Promise<void> {
    const { host, port, maxPayloadBytes } = this.config;
    if (!isLoopbackHost(host)) {
      logger.warn(`WebSocket server bound to non-loopback address ${host}: restrict it with the host firewall`);
    }
    const wss = new WSServer({ noServer: true, maxPayload: maxPayloadBytes });
    const httpServer = createServer((_req, res) => {
      res.writeHead(426, { Connection: 'close' }).end();
    });
    httpServer.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket as Socket, head));
    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => this.handleConnection(ws, req));
    this.wss = wss;
    this.httpServer = httpServer;

    return new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, host, () => {
        httpServer.off('error', reject);
        httpServer.on('error', (error) => logger.error(`WebSocket server error: ${error.message}`));
        this.pingInterval = setInterval(() => this.pingClients(), PING_INTERVAL_MS);
        logger.info(`WebSocket server listening on ws://${host}:${this.port}`);
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = null;
    this.clients.forEach((client, ws) => {
      clearTimeout(client.authTimer);
      // Close frame first, then drop the socket: waiting for every peer's
      // close acknowledgement could hold a systemd stop for up to 30 s.
      ws.close(1001, 'Server shutting down');
      ws.terminate();
    });
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
    const httpServer = this.httpServer;
    this.httpServer = null;
    return new Promise((resolve) => {
      if (!httpServer?.listening) return resolve();
      httpServer.closeAllConnections();
      httpServer.close(() => {
        logger.info('WebSocket server stopped');
        resolve();
      });
    });
  }

  /** Port actually bound (differs from the configured one when it is 0). */
  public get port(): number {
    const address = this.httpServer?.address() as AddressInfo | null;
    return address ? address.port : this.config.port;
  }

  private handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    socket.on('error', (error) => logger.warn(`WebSocket upgrade socket error: ${error.message}`));
    const wss = this.wss;
    if (!wss) {
      // Stopped: nothing will ever answer this upgrade.
      socket.destroy();
      return;
    }
    const origin = req.headers.origin;
    if (!isOriginAllowed(origin, this.config.allowedOrigins)) {
      logger.warn(`WebSocket upgrade refused from ${socket.remoteAddress}: origin ${JSON.stringify(origin)} not allowed`);
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const client: ConnectedClient = {
      id: randomUUID(),
      authenticated: false,
      remoteAddress: req.socket.remoteAddress ?? 'unknown',
      connectedAt: new Date(),
      lastActivity: new Date(),
      authTimer: setTimeout(() => {
        logger.warn(`WebSocket client ${client.id} (${client.remoteAddress}) did not authenticate in time`);
        closeUnauthenticated(ws, 'Authentication timeout');
      }, this.config.authTimeoutMs),
    };
    this.clients.set(ws, client);
    logger.info(`WebSocket client connected: ${client.id} from ${client.remoteAddress}`);

    ws.on('message', (data: RawData) => void handleClientMessage(ws, client, data, this.config.token, this.handler));
    ws.on('close', () => {
      clearTimeout(client.authTimer);
      this.clients.delete(ws);
      logger.info(`WebSocket client disconnected: ${client.id}`);
    });
    ws.on('error', (error: Error) => logger.warn(`WebSocket client error (${client.id}): ${error.message}`));
    ws.on('pong', () => { client.lastActivity = new Date(); });
    sendAuthRequired(ws);
  }

  /** Broadcast an event to all authenticated clients. */
  public broadcast(event: WizardEvent): void {
    this.clients.forEach((client, ws) => {
      if (client.authenticated) sendJson(ws, event);
    });
  }

  private pingClients(): void {
    const now = Date.now();
    this.clients.forEach((client, ws) => {
      if (now - client.lastActivity.getTime() > IDLE_TIMEOUT_MS) {
        logger.warn(`WebSocket client ${client.id} timed out, closing connection`);
        ws.terminate();
        this.clients.delete(ws);
        return;
      }
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    });
  }

  public get clientCount(): number {
    return this.clients.size;
  }

  public get authenticatedClientCount(): number {
    return [...this.clients.values()].filter((client) => client.authenticated).length;
  }
}
