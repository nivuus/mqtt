// src/websocket/WebSocketServer.ts

import { WebSocketServer as WSServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { createServer as createHttpsServer, Server as HttpsServer } from 'https';
import { createServer as createHttpServer, Server as HttpServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import logger from '../utils/logger';
import {
  WebSocketConfig,
  ConnectedClient,
  WizardCommand,
  WizardResponse,
  AuthMessage,
  AuthResponse,
  WizardEvent,
} from './types';
import { WizardHandler } from './WizardHandler';

/**
 * WebSocket server for the Nivuus Wizard API
 * Provides bidirectional real-time communication for system configuration
 * Supports both WS and WSS (secure) connections
 */
export class WebSocketServer {
  private server: WSServer | null = null;
  private httpServer: HttpServer | HttpsServer | null = null;
  private readonly config: WebSocketConfig;
  private readonly clients: Map<WebSocket, ConnectedClient> = new Map();
  private readonly wizardHandler: WizardHandler;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(config: WebSocketConfig, wizardHandler: WizardHandler) {
    this.config = config;
    this.wizardHandler = wizardHandler;
  }

  /**
   * Start the WebSocket server
   */
  public start(): void {
    if (!this.config.enabled) {
      logger.info('WebSocket server is disabled in config');
      return;
    }

    // Check for SSL certificates
    const sslConfig = this.config.ssl;
    const useSSL = sslConfig?.enabled &&
      sslConfig.cert && existsSync(sslConfig.cert) &&
      sslConfig.key && existsSync(sslConfig.key);

    if (useSSL && sslConfig) {
      // Create HTTPS server for WSS
      try {
        const httpsOptions = {
          cert: readFileSync(sslConfig.cert!),
          key: readFileSync(sslConfig.key!),
        };
        this.httpServer = createHttpsServer(httpsOptions);
        this.server = new WSServer({ server: this.httpServer });

        this.httpServer.listen(this.config.port, this.config.host, () => {
          logger.info(`WebSocket server listening on wss://${this.config.host}:${this.config.port}`);
        });
      } catch (error) {
        logger.error(`Failed to start WSS server: ${error}`);
        logger.info('Falling back to WS (insecure) mode');
        this.startInsecure();
        return;
      }
    } else {
      this.startInsecure();
    }

    this.server!.on('connection', (ws: WebSocket) => this.handleConnection(ws));
    this.server!.on('error', (error: Error) => this.handleServerError(error));

    // Ping clients every 30 seconds to keep connections alive
    this.pingInterval = setInterval(() => this.pingClients(), 30000);
  }

  /**
   * Start insecure WS server
   */
  private startInsecure(): void {
    this.server = new WSServer({
      port: this.config.port,
      host: this.config.host,
    });

    this.server.on('listening', () => {
      logger.info(`WebSocket server listening on ws://${this.config.host}:${this.config.port}`);
    });
  }

  /**
   * Stop the WebSocket server
   */
  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }

      // Close all client connections
      this.clients.forEach((_, ws) => {
        ws.close(1001, 'Server shutting down');
      });
      this.clients.clear();

      const closeServer = () => {
        if (this.httpServer) {
          this.httpServer.close(() => {
            logger.info('WebSocket server stopped');
            this.httpServer = null;
            this.server = null;
            resolve();
          });
        } else {
          logger.info('WebSocket server stopped');
          this.server = null;
          resolve();
        }
      };

      if (this.server) {
        this.server.close(closeServer);
      } else {
        closeServer();
      }
    });
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket): void {
    const clientId = randomUUID();
    const client: ConnectedClient = {
      id: clientId,
      authenticated: this.config.auth.type === 'none',
      connectedAt: new Date(),
      lastActivity: new Date(),
      subscriptions: new Set(),
    };

    this.clients.set(ws, client);
    logger.info(`WebSocket client connected: ${clientId} (auth required: ${!client.authenticated})`);

    ws.on('message', (data: Buffer) => this.handleMessage(ws, client, data));
    ws.on('close', () => this.handleClose(ws, client));
    ws.on('error', (error: Error) => this.handleClientError(ws, client, error));
    ws.on('pong', () => {
      client.lastActivity = new Date();
    });

    // Send welcome message
    if (client.authenticated) {
      this.sendResponse(ws, {
        id: 'welcome',
        success: true,
        data: { message: 'Connected to Nivuus Wizard API', clientId },
      });
    } else {
      this.sendAuthRequired(ws);
    }
  }

  /**
   * Handle incoming message from client
   */
  private async handleMessage(ws: WebSocket, client: ConnectedClient, data: Buffer): Promise<void> {
    client.lastActivity = new Date();

    let message: unknown;
    try {
      message = JSON.parse(data.toString());
    } catch {
      this.sendResponse(ws, {
        id: 'error',
        success: false,
        error: 'Invalid JSON message',
      });
      return;
    }

    // Handle authentication
    if (this.isAuthMessage(message)) {
      await this.handleAuth(ws, client, message);
      return;
    }

    // Require authentication for all other messages
    if (!client.authenticated) {
      this.sendAuthRequired(ws);
      return;
    }

    // Handle wizard commands
    if (this.isWizardCommand(message)) {
      await this.handleCommand(ws, client, message);
      return;
    }

    this.sendResponse(ws, {
      id: 'error',
      success: false,
      error: 'Unknown message type',
    });
  }

  /**
   * Handle authentication message
   */
  private async handleAuth(ws: WebSocket, client: ConnectedClient, message: AuthMessage): Promise<void> {
    const isValid = this.config.auth.type === 'none' ||
      (this.config.auth.type === 'token' && message.token === this.config.auth.token);

    if (isValid) {
      client.authenticated = true;
      logger.info(`WebSocket client authenticated: ${client.id}`);
      this.sendAuthResponse(ws, { type: 'auth_result', success: true });
      this.sendResponse(ws, {
        id: 'welcome',
        success: true,
        data: { message: 'Authenticated successfully', clientId: client.id },
      });
    } else {
      logger.warn(`WebSocket authentication failed for client: ${client.id}`);
      this.sendAuthResponse(ws, { type: 'auth_result', success: false, error: 'Invalid token' });
    }
  }

  /**
   * Handle wizard command
   */
  private async handleCommand(ws: WebSocket, client: ConnectedClient, command: WizardCommand): Promise<void> {
    logger.debug(`Received command from ${client.id}: ${command.feature}.${command.action}`);

    try {
      const result = await this.wizardHandler.handleCommand(command);
      this.sendResponse(ws, {
        id: command.id,
        success: true,
        data: result,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error handling command ${command.feature}.${command.action}: ${errorMessage}`);
      this.sendResponse(ws, {
        id: command.id,
        success: false,
        error: errorMessage,
      });
    }
  }

  /**
   * Handle client disconnect
   */
  private handleClose(ws: WebSocket, client: ConnectedClient): void {
    logger.info(`WebSocket client disconnected: ${client.id}`);
    this.clients.delete(ws);
  }

  /**
   * Handle client error
   */
  private handleClientError(ws: WebSocket, client: ConnectedClient, error: Error): void {
    logger.error(`WebSocket client error (${client.id}): ${error.message}`);
  }

  /**
   * Handle server error
   */
  private handleServerError(error: Error): void {
    logger.error(`WebSocket server error: ${error.message}`);
  }

  /**
   * Send response to client
   */
  private sendResponse(ws: WebSocket, response: WizardResponse): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
    }
  }

  /**
   * Send auth required message
   */
  private sendAuthRequired(ws: WebSocket): void {
    ws.send(JSON.stringify({
      type: 'auth_required',
      message: 'Authentication required. Send { "type": "auth", "token": "your_token" }',
    }));
  }

  /**
   * Send auth response
   */
  private sendAuthResponse(ws: WebSocket, response: AuthResponse): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
    }
  }

  /**
   * Broadcast event to all authenticated clients
   */
  public broadcast(event: WizardEvent): void {
    const message = JSON.stringify(event);
    this.clients.forEach((client, ws) => {
      if (client.authenticated && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }

  /**
   * Ping all clients to keep connections alive
   */
  private pingClients(): void {
    const now = Date.now();
    this.clients.forEach((client, ws) => {
      // Disconnect clients that haven't responded to ping in 60 seconds
      if (now - client.lastActivity.getTime() > 60000) {
        logger.warn(`WebSocket client ${client.id} timed out, closing connection`);
        ws.terminate();
        this.clients.delete(ws);
        return;
      }

      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    });
  }

  /**
   * Type guard for auth message
   */
  private isAuthMessage(message: unknown): message is AuthMessage {
    return (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      (message as AuthMessage).type === 'auth' &&
      'token' in message
    );
  }

  /**
   * Type guard for wizard command
   */
  private isWizardCommand(message: unknown): message is WizardCommand {
    return (
      typeof message === 'object' &&
      message !== null &&
      'id' in message &&
      'type' in message &&
      'feature' in message &&
      'action' in message
    );
  }

  /**
   * Get connected clients count
   */
  public get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Get authenticated clients count
   */
  public get authenticatedClientCount(): number {
    let count = 0;
    this.clients.forEach((client) => {
      if (client.authenticated) count++;
    });
    return count;
  }
}
