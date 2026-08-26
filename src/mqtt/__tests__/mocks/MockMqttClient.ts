// src/mqtt/__tests__/mocks/MockMqttClient.ts

import { EventEmitter } from 'node:events';
import { MqttClient as MqttClientInterface } from '../../../core/types';
import { IClientPublishOptions, IClientSubscribeOptions, PacketCallback, ClientSubscribeCallback } from 'mqtt';

export interface PublishedMessage {
  topic: string;
  message: string | Buffer;
  options?: IClientPublishOptions;
}

export class MockMqttClient extends EventEmitter implements MqttClientInterface {
  public connected: boolean = false;
  public connecting: boolean = false;
  
  public publishedMessages: PublishedMessage[] = [];
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

  async publish(topic: string, message: string | Buffer, options?: IClientPublishOptions, callback?: PacketCallback): Promise<this> {
    if (!this.connected) {
      if (callback) callback(new Error('MockMQTT: Not connected'));
      // To conform to Promise<this>, we should probably throw or return a rejected promise
      // For a mock, simply returning a resolved promise of this might be acceptable for tests not checking failure.
      // Or, throw new Error('MockMQTT: Not connected');
      return Promise.reject(new Error('MockMQTT: Not connected'));
    }
    this.publishedMessages.push({ topic, message, options });
    if (callback) callback(undefined); // Simulate success
    return Promise.resolve(this);
  }

  async subscribe(topic: string | string[], options?: IClientSubscribeOptions | ClientSubscribeCallback, callback?: ClientSubscribeCallback): Promise<this> {
    if (!this.connected) {
      const err = new Error('MockMQTT: Not connected');
      if (typeof options === 'function') options(err, undefined);
      else if (callback) callback(err, undefined);
      return Promise.reject(err);
    }

    const topics = Array.isArray(topic) ? topic : [topic];
    topics.forEach(t => {
      if (!this.subscribedTopics.includes(t)) {
        this.subscribedTopics.push(t);
      }
    });
    
    if (typeof options === 'function') options(null, topics.map(t => ({ topic: t, qos: 0 }))); 
    else if (callback) callback(null, topics.map(t => ({ topic: t, qos: 0 })));
    return Promise.resolve(this);
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

  // Helper to simulate an incoming message for testing features
  public simulateMessage(topic: string, message: string | Buffer): void {
    this.emit('message', topic, message);
  }

  // Helper to clear records for fresh tests
  public reset(): void {
    this.publishedMessages = [];
    this.subscribedTopics = [];
    this.unsubscribedTopics = [];
    this.connected = false;
    this.connecting = false;
  }
}
