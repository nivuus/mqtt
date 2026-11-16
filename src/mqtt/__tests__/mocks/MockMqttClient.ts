// src/mqtt/__tests__/mocks/MockMqttClient.ts

import { EventEmitter } from 'node:events';
import { MqttClient as MqttClientInterface } from '../../../core/types';
import { IClientPublishOptions, IClientSubscribeOptions } from 'mqtt';

export interface PublishedMessage {
  topic: string;
  message: string | Buffer;
  options?: IClientPublishOptions;
}

// Mirrors src/mqtt/MqttClient.ts: a mock more permissive than the real client
// hides the failures production meets (a disconnected subscribe rejects).
export class MockMqttClient extends EventEmitter implements MqttClientInterface {
  public connected: boolean = false;
  public connecting: boolean = false;
  
  public publishedMessages: PublishedMessage[] = [];
  /** Retained messages published while disconnected, as the real client queues them. */
  public queuedMessages: PublishedMessage[] = [];
  public subscribedTopics: string[] = [];
  public unsubscribedTopics: string[] = []; // For testing cleanup

  constructor() {
    super();
  }

  // Make connect synchronous for easier testing; real client is async.
  connect(): Promise<void> {
    this.connecting = false; // No longer "connecting" as it's immediate
    this.connected = true;
    this.emit('connect');
    return Promise.resolve(); 
  }

  // Like the real client: resolves while disconnected, keeping only retained messages.
  async publish(topic: string, message: string | Buffer, options?: IClientPublishOptions): Promise<this> {
    if (!this.connected) {
      if (options?.retain) this.queuedMessages.push({ topic, message, options });
      return this;
    }
    this.publishedMessages.push({ topic, message, options });
    return this;
  }

  // Like the real client: rejects while disconnected.
  async subscribe(topic: string | string[], _options?: IClientSubscribeOptions): Promise<this> {
    if (!this.connected) {
      throw new Error('MockMQTT: Not connected');
    }

    const topics = Array.isArray(topic) ? topic : [topic];
    topics.forEach(t => {
      if (!this.subscribedTopics.includes(t)) {
        this.subscribedTopics.push(t);
      }
    });
    return this;
  }

  /**
   * Counted only: the real client's retained de-duplication is a transport
   * concern tested in MqttClient.test.ts, and feature tests count every
   * publish their update() makes.
   */
  public forgetRetainedCalls = 0;
  forgetRetained(): void {
    this.forgetRetainedCalls++;
  }

  // Unsubscribe can remain synchronous or also be async if the underlying lib is.
  // For simplicity, keeping it as returning `this` directly if the interface allows,
  // but the interface was changed to Promise<this>.
  async unsubscribe(topic: string | string[], options?: object | (() => void), callback?: () => void): Promise<this> {
    if (!this.connected) {
      // if (typeof options === 'function') options(); // No error handling in original mock for unsubscribe not connected
      // else if (callback) callback();
      return Promise.reject(new Error('MockMQTT: Not connected for unsubscribe'));
    }
    const topics = Array.isArray(topic) ? topic : [topic];
    topics.forEach(t => {
        this.subscribedTopics = this.subscribedTopics.filter(sub => sub !== t);
        this.unsubscribedTopics.push(t);
    });

    if (typeof options === 'function') options();
    else if (callback) callback();
    return Promise.resolve(this);
  }

  end(force?: boolean, opts?: object, cb?: (...args: any[]) => void): this {
    this.connected = false;
    this.connecting = false;
    this.emit('end');
    if (cb) cb();
    return this;
  }

  // Helper to simulate an incoming message for testing features. Like mqtt.js,
  // the payload is a Buffer and the packet carries the retain flag.
  public simulateMessage(topic: string, message: string | Buffer, opts: { retain?: boolean } = {}): void {
    const payload = Buffer.isBuffer(message) ? message : Buffer.from(message);
    this.emit('message', topic, payload, { cmd: 'publish', topic, payload, retain: opts.retain === true, qos: 0, dup: false });
  }

  // Helper to clear records for fresh tests
  public reset(): void {
    this.publishedMessages = [];
    this.queuedMessages = [];
    this.subscribedTopics = [];
    this.unsubscribedTopics = [];
    this.connected = false;
    this.connecting = false;
  }
}
