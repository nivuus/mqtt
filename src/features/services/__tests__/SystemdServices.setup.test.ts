// src/features/services/__tests__/SystemdServices.setup.test.ts
//
// A subscription attempted while the broker is down must fail setup() as a
// whole, never leave a rejected promise behind: the agent exits on those.

import { SystemdServices } from '../SystemdServices';
import { MockMqttClient } from '../../../mqtt/__tests__/mocks/MockMqttClient';
import { unhandledRejectionsDuring } from '../../../mqtt/__tests__/mocks/unhandledRejections';
import logger from '../../../utils/logger';

jest.mock('../../../config', () => ({
  getConfigManager: jest.fn(() => ({
    config: {
      mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
      device_info: { name: 'Test', identifiers: ['nivuus'], manufacturer: 'T', model: 'A', sw_version: '1' },
      features: { systemd_services: { enabled: true, update_interval_seconds: 60 } },
    },
  })),
}));

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {});
  }
});

afterEach(() => jest.restoreAllMocks());

const setupOf = (feature: SystemdServices) => (feature as unknown as { setup: () => Promise<void> }).setup();

describe('SystemdServices.setup', () => {
  it('leaves no unhandled rejection when the broker is disconnected', async () => {
    const client = new MockMqttClient(); // connected = false
    const reasons = await unhandledRejectionsDuring(() => setupOf(new SystemdServices(client, 'systemd_services')));
    expect(reasons).toEqual([]);
    await expect(setupOf(new SystemdServices(client, 'systemd_services'))).rejects.toThrow(/Not connected/);
  });
});
