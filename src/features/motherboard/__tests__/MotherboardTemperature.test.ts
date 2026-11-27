import { MotherboardTemperature } from '../MotherboardTemperature';
import { MockMqttClient } from '../../../mqtt/__tests__/mocks/MockMqttClient';
import { execute_argv } from '../../../utils/exec';

jest.mock('../../../utils/exec');
const mockedExec = execute_argv as jest.MockedFunction<typeof execute_argv>;

jest.mock('../../../config', () => {
  const config = {
    mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
    device_info: { name: 'Test', identifiers: ['test'], manufacturer: 'Test', model: 'Agent', sw_version: '1.0' },
    features: { motherboard_temperature: { enabled: true, update_interval_seconds: 30 } },
    logging: { level: 'info' },
  };
  return { getConfigManager: jest.fn(() => ({ config })) };
});

// `sensors -A` on the Nivuus host (nct6798) while the BIOS fan curve has stopped
// chassis fan 1: its first auto point is PWM 1 below 52 °C, so 0 RPM is a real reading.
const SENSORS_OUTPUT = `nct6798-isa-0290
fan1:                        0 RPM  (min =    0 RPM)
fan2:                     1788 RPM  (min =    0 RPM)
SYSTIN:                    +38.0°C  (high = +80.0°C, hyst = +75.0°C)
CPUTIN:                    +60.5°C  (high = +80.0°C, hyst = +75.0°C)
PCH_CHIP_TEMP:             +72.0°C

nvme-pci-0200
Composite:    +57.9°C  (low  = -273.1°C, high = +81.8°C)
`;

async function publishedStates(stdout: string): Promise<Record<string, string>> {
  mockedExec.mockResolvedValue({ stdout, stderr: '', exitCode: 0 } as never);
  const mqtt = new MockMqttClient();
  mqtt.connect();
  const feature = new MotherboardTemperature(mqtt, 'motherboard_temperature');
  await (feature as unknown as { update(): Promise<void> }).update();
  const states: Record<string, string> = {};
  for (const msg of mqtt.publishedMessages) {
    const match = msg.topic.match(/motherboard_temperature\/([^/]+)\/state$/);
    if (match) states[match[1]] = msg.message.toString();
  }
  return states;
}

describe('MotherboardTemperature', () => {
  it('publishes a stopped fan as 0 RPM, not as a missing reading', async () => {
    const states = await publishedStates(SENSORS_OUTPUT);
    expect(states.chassis_fan1).toBe('0.0');
    expect(states.chassis_fan2).toBe('1788.0');
    expect(states.system_temperature).toBe('38.0');
    expect(states.nvme_temperature).toBe('57.9');
  });

  it('publishes None, the payload HA reads as unknown, for a reading sensors does not report', async () => {
    const states = await publishedStates(SENSORS_OUTPUT.replace(/^fan2:.*\n/m, ''));
    expect(states.chassis_fan2).toBe('None');
    for (const state of Object.values(states)) expect(state).not.toBe('unknown');
  });

  it('still rejects an implausible temperature', async () => {
    const states = await publishedStates(SENSORS_OUTPUT.replace('+72.0°C', '+0.0°C'));
    expect(states.pch_temperature).toBe('None');
  });
});
