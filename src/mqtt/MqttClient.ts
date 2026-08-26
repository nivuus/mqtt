// src/mqtt/MqttClient.ts

import * as mqtt from 'mqtt';
import { MqttClient as MqttClientInterface, AgentConfig } from '../core/types'; // Our custom interface
import { 
  IClientOptions, 
  MqttClient as ExternalMqttClient, // Renamed to avoid confusion
  IClientPublishOptions, 
  IClientSubscribeOptions, 
  PacketCallback, 
  ClientSubscribeCallback 
} from 'mqtt';
import * as fs from 'fs';
import { getConfigManager } from '../config';
import logger from '../utils/logger';
import { EventEmitter } from 'node:events'; // Import EventEmitter

interface QueuedMessage {
  topic: string;
  message: string | Buffer;
  options?: IClientPublishOptions;
}

export class MqttClient extends EventEmitter implements MqttClientInterface {
  private client: ExternalMqttClient | null = null;
  private mqttOptions: IClientOptions; // Renamed from 'options'
  private agentConfig: AgentConfig;
  private noWill: boolean;
  private reconnectPeriod: number = 10000; // Reconnect after 10 seconds
  private reconnectAttempts: number = 0;
  private maxReconnectPeriod: number = 300000; // 5 min max
  private reconnectTimer: NodeJS.Timeout | null = null;

  private connectionPromise: Promise<void> | null = null;
  private resolveConnectionPromise: (() => void) | null = null;
  private rejectConnectionPromise: ((error: Error) => void) | null = null;

  // Publish queue for retained messages when disconnected (Bug 7)
  private publishQueue: QueuedMessage[] = [];
  private readonly maxQueueSize: number = 200;

  public connected: boolean = false;
  public connecting: boolean = false; // Part of our custom interface
  private internalDisconnecting: boolean = false; // For managing our reconnect logic

  constructor(opts: { noWill?: boolean } = {}) {
    super(); // Call EventEmitter constructor
    this.noWill = opts.noWill === true;
    this.agentConfig = getConfigManager().config;
    const mqttConfig = this.agentConfig.mqtt;

    // Build connect options; include LWT unless disabled
    this.mqttOptions = {
      host: mqttConfig.host,
      port: mqttConfig.port,
      username: mqttConfig.username,
      password: mqttConfig.password,
      protocol: mqttConfig.protocol || (mqttConfig.ca_file ? 'mqtts' : 'mqtt'),
      reconnectPeriod: 0,
      connectTimeout: 10000,
      clientId: `mqtt_system_agent_${this.agentConfig.device_info.identifiers[0]}_${Math.random().toString(16).substring(2, 10)}`,
    };
    if (!this.noWill) {
      this.mqttOptions.will = {
        topic: `${mqttConfig.base_topic}/${this.agentConfig.device_info.identifiers[0]}/status`,
        payload: 'offline',
        qos: 1,
        retain: true,
      };
    }

    if (mqttConfig.ca_file) {
      this.mqttOptions.ca = [fs.readFileSync(mqttConfig.ca_file)];
    }
    if (mqttConfig.cert_file) {
      this.mqttOptions.cert = fs.readFileSync(mqttConfig.cert_file);
    }
    if (mqttConfig.key_file) {
      this.mqttOptions.key = fs.readFileSync(mqttConfig.key_file);
    }
    if (mqttConfig.reject_unauthorized !== undefined) {
      this.mqttOptions.rejectUnauthorized = mqttConfig.reject_unauthorized;
    }
  }

  public connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    if (this.connecting && this.connectionPromise) return this.connectionPromise;

    // Clean up old client if it exists (e.g. during reconnection)
    if (this.client) {
      this.client.removeAllListeners();
      try { this.client.end(true); } catch { /* ignore */ }
      this.client = null;
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      this.resolveConnectionPromise = resolve;
      this.rejectConnectionPromise = reject;
    });

    logger.info(`Attempting to connect to MQTT broker at ${this.mqttOptions.host}:${this.mqttOptions.port}`);
    this.client = mqtt.connect(this.mqttOptions);
    this.connecting = true;

    this.client.on('connect', () => {
      logger.info('Successfully connected to MQTT broker.');
      this.connected = true;
      this.connecting = false;
      this.reconnectAttempts = 0;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.drainQueue();
      this.emit('connect');
      if (this.resolveConnectionPromise) this.resolveConnectionPromise();
    });

    this.client.on('error', (error) => {
      logger.error('MQTT Client Error:', error.message);
      this.connecting = false;
      if (!this.connected && this.rejectConnectionPromise) {
        this.rejectConnectionPromise(error);
      }
      this.emit('error', error);
    });

    this.client.on('close', () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.connecting = false;
      if (wasConnected) {
        logger.warn('MQTT connection lost.');
      }
      this.emit('close');
      if (!this.internalDisconnecting) {
        this.scheduleReconnect();
      }
    });

    this.client.on('offline', () => {
      logger.warn('MQTT client is offline. Connection may be lost.');
      this.emit('offline');
    });

    this.client.on('reconnect', () => {
      logger.info('MQTT client library is attempting to reconnect.');
      this.connecting = true;
      this.emit('reconnect');
    });

    this.client.on('message', (topic, payload, packet) => {
        this.emit('message', topic, payload, packet as any); // Cast packet if type mismatch
    });

    return this.connectionPromise;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(
      this.reconnectPeriod * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectPeriod
    );
    this.reconnectAttempts++;
    logger.info(`Scheduling MQTT reconnect #${this.reconnectAttempts} in ${delay / 1000}s...`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.internalDisconnecting) return;
      try {
        await this.connect();
      } catch (err: any) {
        logger.error(`Reconnect #${this.reconnectAttempts} failed:`, err.message);
        // The close handler will schedule the next attempt
      }
    }, delay);
  }

  public async publish(topic: string, message: string | Buffer, options?: IClientPublishOptions, callback?: PacketCallback): Promise<this> {
    if (!this.client || !this.connected) {
      // Queue retained messages for delivery on reconnect
      if (options?.retain) {
        this.enqueue({ topic, message, options });
      }
      const err = new Error(`MQTT client not connected. Cannot publish to ${topic}.`);
      logger.debug(err.message);
      if (callback) callback(err);
      return this;
    }
    return new Promise((resolve, reject) => {
      this.client!.publish(topic, message, options, (err, packet) => {
        if (callback) callback(err, packet);
        if (err) {
          reject(err);
        } else {
          resolve(this);
        }
      });
    });
  }

  private enqueue(msg: QueuedMessage): void {
    const idx = this.publishQueue.findIndex(m => m.topic === msg.topic);
    if (idx !== -1) {
      this.publishQueue[idx] = msg;
    } else {
      if (this.publishQueue.length >= this.maxQueueSize) this.publishQueue.shift();
      this.publishQueue.push(msg);
    }
  }

  private async drainQueue(): Promise<void> {
    if (this.publishQueue.length === 0) return;
    logger.info(`Draining ${this.publishQueue.length} queued messages...`);
    const queue = [...this.publishQueue];
    this.publishQueue = [];
    for (const msg of queue) {
      if (!this.connected) break;
      try {
        await new Promise<void>((resolve, reject) => {
          this.client!.publish(msg.topic, msg.message, msg.options, (err) => err ? reject(err) : resolve());
        });
      } catch { /* skip failed messages */ }
    }
  }

  public async subscribe(topic: string | string[], options?: IClientSubscribeOptions, callback?: ClientSubscribeCallback): Promise<this> {
    if (!this.client || !this.connected) {
      const err = new Error(`MQTT client not connected. Cannot subscribe to ${Array.isArray(topic) ? topic.join(', ') : topic}.`);
      logger.warn(err.message);
      if (callback) callback(err, undefined);
      return Promise.reject(err);
    }
    return new Promise((resolve, reject) => {
      const cb: ClientSubscribeCallback = (err, granted) => {
        if (err) {
          logger.error(`Failed to subscribe to ${topic}:`, err);
          reject(err);
        } else {
          logger.debug(`Subscribed to ${topic}`, granted);
          resolve(this);
        }
        if (callback) callback(err, granted);
      };
      if (typeof options === 'function') { // (topic, cb)
          this.client!.subscribe(topic, options as ClientSubscribeCallback); // This case is tricky, mqtt.js might not have this overload for Promise
      } else { // (topic, opts, cb) or (topic, cb) where cb is the last arg
          this.client!.subscribe(topic, options || {}, cb);
      }
    });
  }

  public end(force?: boolean, opts?: object, cb?: (...args: any[]) => void): this {
    if (this.client) {
      this.internalDisconnecting = true;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      logger.info('Closing MQTT connection...');
      // The mqtt.js 'end' method has specific overloads. We adapt to a simpler one.
      // The 'opts' in our interface is generic 'object', mqtt.js might expect IDisconnectPacket.
      // For simplicity, we might not pass 'opts' if it causes type issues, or cast it.
      this.client.end(force, opts as any, () => { // Cast opts to any if type is problematic
        this.connected = false;
        this.connecting = false;
        logger.info('MQTT connection ended.');
        if (cb) cb();
        this.emit('end');
      });
    } else {
        if (cb) cb();
    }
    return this;
  }

  // Event methods (on, emit, etc.) are now inherited from EventEmitter.
  // The calls to this.emit() within this class will now correctly use the
  // EventEmitter's own emit method, notifying listeners attached to this MqttClient instance.
}
