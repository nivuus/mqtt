// src/core/types.ts

import { IClientPublishOptions, IClientSubscribeOptions, PacketCallback, ClientSubscribeCallback } from 'mqtt';
import { EventEmitter } from 'node:events'; // Import EventEmitter

/**
 * Custom Interface for the MQTT client tailored for the agent's needs.
 * This defines the contract that our MqttClient wrapper (src/mqtt/MqttClient.ts) must fulfill.
 * It extends Node.js EventEmitter to handle eventing.
 */
export interface MqttClient extends EventEmitter {
  connected: boolean;
  connecting: boolean; // Custom property for our wrapper
  
  connect(): Promise<void>; // Custom connect method for our wrapper

  // Methods for interacting with MQTT broker
  publish(topic: string, message: string | Buffer, options?: IClientPublishOptions, callback?: PacketCallback): Promise<this>; // Changed to Promise<this>
  subscribe(topic: string | string[], options?: IClientSubscribeOptions, callback?: ClientSubscribeCallback): Promise<this>; // Changed to Promise<this>
  end(force?: boolean, opts?: object, cb?: (...args: any[]) => void): this; // Return this for chaining

  // Event methods are inherited from EventEmitter.
  // We can override or list specific event signatures for clarity if needed,
  // but it's often cleaner to rely on EventEmitter's own typings.
  // For example, to type specific events our client emits:
  on(event: 'connect' | 'error' | 'close' | 'offline' | 'reconnect' | 'message' | 'end', listener: (...args: any[]) => void): this;
  emit(event: 'connect' | 'error' | 'close' | 'offline' | 'reconnect' | 'message' | 'end', ...args: any[]): boolean;
}

/**
 * Basic device information for Home Assistant discovery.
 */
export interface DeviceInfo {
  identifiers: string[];
  name: string;
  manufacturer: string;
  model: string;
  sw_version: string;
  // via_device?: string; // If this agent itself is a device connected to another HA integration
}

/**
 * Configuration for a single feature.
 */
export interface FeatureConfig {
  enabled: boolean;
  update_interval_seconds?: number;
  [key: string]: any; // For feature-specific configurations
}

/**
 * WebSocket server configuration for the Wizard API.
 */
export interface WebSocketConfig {
  enabled: boolean;
  port: number;
  host: string;
  auth: {
    type: 'token' | 'none';
    token?: string;
  };
  ssl?: {
    enabled: boolean;
    cert?: string;
    key?: string;
  };
}

/**
 * Main agent configuration structure, loaded from agent.yaml.
 */
export interface AgentConfig {
  mqtt: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    base_topic: string;
    protocol?: 'mqtt' | 'mqtts' | 'ws' | 'wss';
    ca_file?: string;
    cert_file?: string;
    key_file?: string;
    reject_unauthorized?: boolean;
  };
  device_info: DeviceInfo;
  windows_vm?: {
    hostname: string;
    port: number;
    username: string;
    password: string;
  };
  websocket?: WebSocketConfig;
  features: {
    [featureName: string]: FeatureConfig;
  };
  logging?: {
    level?: 'debug' | 'info' | 'warn' | 'error';
  };
}

/**
 * Structure for Home Assistant MQTT discovery payload.
 * This is a generic base. Specific components (sensor, binary_sensor, switch, etc.)
 * will have additional fields.
 */
export interface HaDiscoveryPayload {
  // Common fields for all components
  unique_id: string; // Unique ID for this entity
  name: string; // Friendly name of the entity
  availability_topic: string; // Topic to monitor agent availability
  payload_available: string; // Payload for "online" state
  payload_not_available: string; // Payload for "offline" state
  device: DeviceInfo; // Links entity to a device in HA

  // Component-specific fields (examples for a sensor)
  state_topic?: string; // Topic to read state from
  json_attributes_topic?: string; // Topic for JSON attributes
  value_template?: string; // Template to extract value
  unit_of_measurement?: string;
  icon?: string;
  device_class?: string;
  entity_category?: 'config' | 'diagnostic';

  // For commandable entities (switch, button, light, etc.)
  command_topic?: string;

  // Allow any other fields as per HA MQTT discovery docs
  [key: string]: any;
}
