// src/features/vm/__tests__/VmManager.setup.test.ts
//
// Features start one after another; the broker may drop meanwhile. setup()
// must then fail as a whole (BaseFeature.start logs it, the reconnection
// restarts the feature), never leave a rejected subscription behind.

import { VmManager } from '../VmManager';
import { MockMqttClient } from '../../../mqtt/__tests__/mocks/MockMqttClient';
import { unhandledRejectionsDuring } from '../../../mqtt/__tests__/mocks/unhandledRejections';
import logger from '../../../utils/logger';

jest.mock('../../../config', () => ({
  getConfigManager: jest.fn(() => ({
    config: {
      mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
      device_info: { name: 'Test', identifiers: ['nivuus'], manufacturer: 'T', model: 'A', sw_version: '1' },
      features: { vm_manager: { enabled: true, update_interval_seconds: 60 } },
    },
  })),
}));

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {});
  }
});

afterEach(() => jest.restoreAllMocks());

const setupOf = (feature: VmManager) => (feature as unknown as { setup: () => Promise<void> }).setup();

describe('VmManager.setup', () => {
  it('leaves no unhandled rejection when the broker is disconnected', async () => {
    const client = new MockMqttClient(); // connected = false
    const feature = new VmManager(client, 'vm_manager');
    const reasons = await unhandledRejectionsDuring(() => setupOf(feature));
    expect(reasons).toEqual([]);
    await expect(setupOf(new VmManager(client, 'vm_manager'))).rejects.toThrow(/Not connected/);
  });

  it('subscribes to the command and discovery topics when connected', async () => {
    const client = new MockMqttClient();
    await client.connect();
    await setupOf(new VmManager(client, 'vm_manager'));
    expect(client.subscribedTopics).toEqual([
      'system_agent/nivuus/vm_manager/+/command',
      'homeassistant/+/nivuus/+/config',
    ]);
  });
});
