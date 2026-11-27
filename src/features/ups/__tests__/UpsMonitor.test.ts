import { UpsMonitor } from '../UpsMonitor';
import { MockMqttClient } from '../../../mqtt/__tests__/mocks/MockMqttClient';
import { execute_argv } from '../../../utils/exec';

jest.mock('../../../utils/exec');
const mockedExec = execute_argv as jest.MockedFunction<typeof execute_argv>;

jest.mock('../../../config', () => {
  const config = {
    mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
    device_info: { name: 'Test', identifiers: ['test'], manufacturer: 'Test', model: 'Agent', sw_version: '1.0' },
    // A zero interval turns the periodic battery test off: nothing touches the state file.
    features: { ups_monitor: { enabled: true, update_interval_seconds: 30, battery_test_interval_days: 0 } },
    logging: { level: 'info' },
  };
  return { getConfigManager: jest.fn(() => ({ config })) };
});

describe('UpsMonitor', () => {
  it('publishes None for numeric readings the UPS does not report, and keeps text states as text', async () => {
    mockedExec.mockResolvedValue({ stdout: 'ups.status: OL\n', stderr: '', exitCode: 0 } as never);
    const mqtt = new MockMqttClient();
    mqtt.connect();
    const feature = new UpsMonitor(mqtt);
    await (feature as unknown as { update(): Promise<void> }).update();

    const states: Record<string, string> = {};
    for (const msg of mqtt.publishedMessages) {
      const match = msg.topic.match(/ups_monitor\/([^/]+)\/state$/);
      if (match) states[match[1]] = msg.message.toString();
    }
    for (const id of ['battery_level', 'runtime', 'load', 'input_voltage', 'power_consumption']) {
      expect(states[id]).toBe('None');
    }
    expect(states.status).toBe('Online');
    expect(states.power_source).toBe('ON');
  });
});
