// src/core/__tests__/BaseFeature.discovery.test.ts

import { BaseFeature } from '../BaseFeature';
import { MockMqttClient } from '../../mqtt/__tests__/mocks/MockMqttClient';

jest.mock('../../config', () => ({
  getConfigManager: jest.fn(() => ({
    config: {
      mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
      device_info: { name: 'Test', identifiers: ['nivuus'], manufacturer: 'T', model: 'A', sw_version: '1' },
      features: { firewall: { enabled: true } },
      logging: { level: 'info' },
    },
  })),
}));

const HA_TOPIC_MATCHER =
  /^homeassistant\/\w+\/(?:[a-zA-Z0-9_-]+\/)?[a-zA-Z0-9_-]+\/config$/;

// A feature whose object ids come straight from the system, as the firewall
// manager's do (firewalld zone names).
class ZoneFeature extends BaseFeature {
  constructor(client: MockMqttClient) { super(client, 'firewall'); }
  protected async publishDiscovery(): Promise<void> { /* driven by the test */ }
  protected async update(): Promise<void> { /* unused */ }
  publish(zone: string) { return this.publishEntityDiscovery('sensor', `${zone}_services`, { state_topic: 'x' }); }
  remove(zone: string) { return this.removeEntityDiscovery('sensor', `${zone}_services`); }
}

describe('BaseFeature discovery topics', () => {
  let client: MockMqttClient;
  let feature: ZoneFeature;

  beforeEach(async () => {
    client = new MockMqttClient();
    await client.connect();
    feature = new ZoneFeature(client);
  });

  it('publishes a zone with spaces and parentheses on a topic Home Assistant accepts', async () => {
    await feature.publish('internal (default)');
    const [msg] = client.publishedMessages;
    expect(msg.topic).toMatch(HA_TOPIC_MATCHER);
    // unique_id is the object_id segment, as HA recommends.
    expect(msg.topic.split('/')[3]).toBe(JSON.parse(String(msg.message)).unique_id);
  });

  it('keeps the unique_id of an entity whose id was already legal', async () => {
    await feature.publish('public');
    expect(client.publishedMessages[0].topic)
      .toBe('homeassistant/sensor/nivuus/nivuus_firewall_public_services/config');
  });

  it('removes an entity on the exact topic it was published on', async () => {
    await feature.publish('internal (default)');
    await feature.remove('internal (default)');
    const [published, removed] = client.publishedMessages;
    expect(removed.topic).toBe(published.topic);
    expect(removed.message).toBe('');
  });
});
