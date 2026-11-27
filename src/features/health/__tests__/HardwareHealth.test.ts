import { HardwareHealth } from '../HardwareHealth';
import { MockMqttClient } from '../../../mqtt/__tests__/mocks/MockMqttClient';

jest.mock('../hardwareProbes', () => ({
  findChip: jest.fn(() => '/sys/class/hwmon/hwmon-test'),
  listDisks: jest.fn(() => []),
  readCpuCounters: jest.fn(() => ({ mce: null, thermal: null })),
  readDiskErrors: jest.fn(async () => ({ total: 0, perDisk: {} })),
  readMemoryErrors: jest.fn(() => ({ supported: false, correctable: 0, uncorrectable: 0 })),
  readInt: jest.fn(() => null),
  readRails: jest.fn(() => ({})),
}));

jest.mock('../../../config', () => {
  const config = {
    mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
    device_info: { name: 'Test', identifiers: ['test'], manufacturer: 'Test', model: 'Agent', sw_version: '1.0' },
    features: { hardware_health: { enabled: true, update_interval_seconds: 30 } },
    logging: { level: 'info' },
  };
  return { getConfigManager: jest.fn(() => ({ config })) };
});

describe('HardwareHealth', () => {
  it('publishes None for rails and counters it cannot read, so HA shows unknown instead of rejecting the payload', async () => {
    const mqtt = new MockMqttClient();
    mqtt.connect();
    const feature = new HardwareHealth(mqtt, 'hardware_health');
    await (feature as unknown as { update(): Promise<void> }).update();

    const states: Record<string, string> = {};
    for (const msg of mqtt.publishedMessages) {
      const match = msg.topic.match(/hardware_health\/([^/]+)\/state$/);
      if (match) states[match[1]] = msg.message.toString();
    }
    for (const id of ['psu_12v', 'psu_5v', 'vcore', 'max_rail_drift', 'cpu_machine_checks', 'cpu_thermal_events']) {
      expect(states[id]).toBe('None');
    }
  });
});
