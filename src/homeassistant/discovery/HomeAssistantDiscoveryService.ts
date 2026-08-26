// src/homeassistant/discovery/HomeAssistantDiscoveryService.ts
import { MqttClient as MqttClientInterface } from '../../core/types';
import { AgentConfig } from '../../core/types';

/**
 * Publishes MQTT discovery configurations for alerts and events to Home Assistant.
 */
export class HomeAssistantDiscoveryService {
  static async register(client: MqttClientInterface, config: AgentConfig): Promise<void> {
    const deviceId = config.device_info.identifiers[0];
    const baseTopic = config.mqtt.base_topic;
    const device = {
      identifiers: config.device_info.identifiers,
      name: config.device_info.name,
      model: config.device_info.model,
      manufacturer: config.device_info.manufacturer,
      sw_version: config.device_info.sw_version,
    };

    // Alert sensor discovery
    const alertConfigTopic = `homeassistant/sensor/${deviceId}/alert/config`;
    const alertStateTopic = `${baseTopic}/${deviceId}/alert`;
    const alertConfig = {
      name: `${config.device_info.name} Alert`,
      state_topic: alertStateTopic,
      json_attributes_topic: alertStateTopic,
      value_template: "{{ value_json.message }}",
      unique_id: `${deviceId}_alert`,
      device,
      icon: "mdi:alert",
    };
    await client.publish(alertConfigTopic, JSON.stringify(alertConfig), { retain: true, qos: 1 });

    // Event sensor discovery
    const eventConfigTopic = `homeassistant/sensor/${deviceId}/event/config`;
    const eventStateTopic = `${baseTopic}/${deviceId}/event`;
    const eventConfig = {
      name: `${config.device_info.name} Event`,
      state_topic: eventStateTopic,
      json_attributes_topic: eventStateTopic,
      value_template: "{{ value_json.type }}",
      unique_id: `${deviceId}_event`,
      device,
      icon: "mdi:bell",
    };
    await client.publish(eventConfigTopic, JSON.stringify(eventConfig), { retain: true, qos: 1 });
  }
}
