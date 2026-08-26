import { MqttClient } from '../mqtt/MqttClient';
import { getConfigManager } from '../config';

/**
 * Simplified MQTT message sender for CLI commands
 */
export class MqttMessageSender {
  static async send(suffix: string, payload: object | string): Promise<void> {
    // Disable Last Will to avoid offline status when CLI disconnects
    const client = new MqttClient({ noWill: true });
    await client.connect();
    // Determine payload object and target IDs
    const config = getConfigManager().config;
    const payloadObj = typeof payload === 'string' ? JSON.parse(payload) : payload as any;
    const ids = payloadObj.id ? [payloadObj.id] : config.device_info.identifiers;
    const baseTopic = config.mqtt.base_topic;
    const device = {
      identifiers: config.device_info.identifiers,
      name: config.device_info.name,
      model: config.device_info.model,
      manufacturer: config.device_info.manufacturer,
      sw_version: config.device_info.sw_version,
    };
    // Publish discovery and event per ID
    for (const id of ids) {
      // Discovery: event sensor
      const eventCfgTopic = `homeassistant/sensor/${id}/event/config`;
      const eventStateTopic = `${baseTopic}/${id}/event`;
      const eventCfg = { name: `${config.device_info.name} Event (${id})`, state_topic: eventStateTopic, json_attributes_topic: eventStateTopic, value_template: "{{ value_json.type }}", unique_id: `${id}_event`, device, icon: "mdi:bell" };
      await client.publish(eventCfgTopic, JSON.stringify(eventCfg), { retain: true, qos: 1 });
      // Publish event payload
      const topic = `${baseTopic}/${id}/event`;
      await client.publish(topic, JSON.stringify(payloadObj), { qos: 1, retain: true });
    }
    client.end();
  }
}