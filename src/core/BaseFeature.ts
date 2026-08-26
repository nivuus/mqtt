// src/core/BaseFeature.ts

import { MqttClient, AgentConfig, FeatureConfig, HaDiscoveryPayload, DeviceInfo } from './types';
import { getConfigManager } from '../config';
import logger from '../utils/logger';

/**
 * Abstract base class for all features.
 * Handles common tasks like HA discovery, MQTT publishing, and scheduling updates.
 */
export abstract class BaseFeature {
  protected readonly mqttClient: MqttClient;
  protected readonly agentConfig: AgentConfig;
  private _featureName: string; // Renamed to avoid conflict with getter
  protected readonly featureConfig: FeatureConfig;
  protected readonly deviceInfo: DeviceInfo;
  protected readonly baseTopic: string;
  protected readonly availabilityTopic: string;
  protected readonly payloadAvailable: string = 'online';
  protected readonly payloadNotAvailable: string = 'offline';

  private updateIntervalId?: NodeJS.Timeout;

  constructor(
    mqttClient: MqttClient,
    featureName: string,
  ) {
    this.mqttClient = mqttClient;
    this.agentConfig = getConfigManager().config; // Use the singleton instance
    this._featureName = featureName;
    this.featureConfig = this.agentConfig.features[this._featureName] || { enabled: false };
    this.deviceInfo = this.agentConfig.device_info;
    this.baseTopic = `${this.agentConfig.mqtt.base_topic}/${this.deviceInfo.identifiers[0]}`; // Unique base per agent instance
    this.availabilityTopic = `${this.baseTopic}/status`;
  }

  /**
   * Initializes the feature:
   * - Publishes HA discovery messages.
   * - Sets up periodic updates.
   * - Calls the feature-specific setup.
   */
  public get featureName(): string {
    return this._featureName;
  }

  public async start(): Promise<void> {
    if (!this.featureConfig.enabled) {
      logger.debug(`Feature ${this._featureName} is disabled.`);
      return;
    }

    // Idempotence guard: stop first if already running to prevent duplicate timers/watchers
    if (this.updateIntervalId) {
      await this.stop();
    }

    try {
      await this.publishDiscovery();
      await this.setup(); // Feature-specific setup
      
      // Initial update
      await this.update(); 

      // Schedule periodic updates if an interval is defined
      if (this.featureConfig.update_interval_seconds && this.featureConfig.update_interval_seconds > 0) {
        this.updateIntervalId = setInterval(
          async () => {
            if (!this.mqttClient.connected) return;
            try {
              await this.update();
            } catch (error) {
              logger.error(`Error during scheduled update for ${this._featureName}:`, error);
            }
          },
          this.featureConfig.update_interval_seconds * 1000,
        );
        logger.debug(`Feature ${this._featureName} scheduled for updates every ${this.featureConfig.update_interval_seconds}s.`);
      }
      logger.info(`Feature ${this._featureName} started successfully.`);
    } catch (error) {
      logger.error(`Failed to start feature ${this._featureName}:`, error);
    }
  }

  /**
   * Stops the feature:
   * - Clears any scheduled updates.
   * - Calls feature-specific cleanup.
   */
  public async stop(): Promise<void> {
    if (this.updateIntervalId) {
      clearInterval(this.updateIntervalId);
      this.updateIntervalId = undefined;
    }
    await this.cleanup(); // Feature-specific cleanup
    logger.info(`Feature ${this.featureName} stopped.`);
  }

  /**
   * Publishes the Home Assistant discovery payloads for entities managed by this feature.
   * Concrete classes must implement this to define their entities.
   */
  protected abstract publishDiscovery(): Promise<void>;

  /**
   * Performs the actual data fetching and state publishing for the feature.
   * Concrete classes must implement this.
   */
  protected abstract update(): Promise<void>;

  /**
   * Optional: Feature-specific setup logic to be run once on start.
   * This could include subscribing to MQTT topics for commandable entities,
   * initializing hardware, etc.
   */
  protected async setup(): Promise<void> {
    // Default implementation does nothing. Override in subclasses if needed.
  }

  /**
   * Optional: Feature-specific cleanup logic to be run once on stop.
   */
  protected async cleanup(): Promise<void> {
    // Default implementation does nothing. Override in subclasses if needed.
  }

  /**
   * Helper to publish a Home Assistant discovery payload for an entity.
   * @param component The HA component type (e.g., "sensor", "binary_sensor", "switch").
   * @param objectId A unique ID for this entity within the feature (e.g., "core_0_temp", "total_load").
   * @param payload The discovery payload, excluding common fields like device, availability, unique_id.
   */
  protected async publishEntityDiscovery(component: string, objectId: string, payload: Partial<HaDiscoveryPayload>): Promise<void> {
    if (!this.mqttClient.connected) return;
    const uniqueId = `${this.deviceInfo.identifiers[0]}_${this._featureName}_${objectId}`;
    const discoveryTopic = `homeassistant/${component}/${this.deviceInfo.identifiers[0]}/${uniqueId}/config`;

    const fullPayload: HaDiscoveryPayload = {
      ...payload,
      unique_id: uniqueId,
      name: payload.name || `${this.deviceInfo.name} ${this._featureName} ${objectId.replace(/_/g, ' ')}`, // Default name generation
      device: this.deviceInfo,
      availability_topic: this.availabilityTopic,
      payload_available: this.payloadAvailable,
      payload_not_available: this.payloadNotAvailable,
      // Ensure state_topic and json_attributes_topic are prefixed correctly if not already absolute
      state_topic: payload.state_topic ? this.prefixTopic(payload.state_topic) : undefined,
      json_attributes_topic: payload.json_attributes_topic ? this.prefixTopic(payload.json_attributes_topic) : undefined,
      command_topic: payload.command_topic ? this.prefixTopic(payload.command_topic) : undefined,
    };

    Object.keys(fullPayload).forEach(key => (fullPayload as any)[key] === undefined && delete (fullPayload as any)[key]);

    try {
      const payloadString = JSON.stringify(fullPayload);
      logger.debug(`[MQTT DISCOVERY] Topic: ${discoveryTopic}, Payload: ${payloadString}`);
      await this.mqttClient.publish(discoveryTopic, payloadString, { retain: true, qos: 1 });
    } catch (error) {
      logger.error(`Failed to publish discovery for ${uniqueId}:`, error);
    }
  }
  
  protected prefixTopic(topic: string): string {
    if (topic.startsWith('homeassistant/') || topic.startsWith(this.agentConfig.mqtt.base_topic)) {
      return topic;
    }
    return `${this.baseTopic}/${topic}`;
  }

  protected async publishState(topicPath: string, state: string | number | boolean, retain: boolean = false): Promise<void> {
    if (!this.mqttClient.connected) return;
    const fullTopic = this.prefixTopic(topicPath);
    const payload = String(state);
    logger.debug(`[MQTT STATE] Topic: ${fullTopic}, Payload: ${payload}, Retain: ${retain}`);
    try {
      await this.mqttClient.publish(fullTopic, payload, { retain, qos: 1 });
    } catch (error) {
      logger.error(`Failed to publish state to ${fullTopic}:`, error);
    }
  }

  protected async publishAttributes(topicPath: string, attributes: object, retain: boolean = false): Promise<void> {
    if (!this.mqttClient.connected) return;
    const fullTopic = this.prefixTopic(topicPath);
    const payload = JSON.stringify(attributes);
    logger.debug(`[MQTT ATTR] Topic: ${fullTopic}, Payload: ${payload}, Retain: ${retain}`);
    try {
      await this.mqttClient.publish(fullTopic, payload, { retain, qos: 1 });
    } catch (error) {
      logger.error(`Failed to publish attributes to ${fullTopic}:`, error);
    }
  }
}
