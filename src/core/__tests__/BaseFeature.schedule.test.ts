// src/core/__tests__/BaseFeature.schedule.test.ts
//
// The periodic refresh of a feature must not depend on its first sample: a
// local failure at start (a command not there yet, a file not yet written)
// used to leave the feature without a timer until the next broker reconnection.

import { BaseFeature } from '../BaseFeature';
import { MockMqttClient } from '../../mqtt/__tests__/mocks/MockMqttClient';
import logger from '../../utils/logger';

jest.mock('../../config', () => ({
  getConfigManager: jest.fn(() => ({
    config: {
      mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
      device_info: { name: 'Test', identifiers: ['nivuus'], manufacturer: 'T', model: 'A', sw_version: '1' },
      features: { probe: { enabled: true, update_interval_seconds: 30 } },
    },
  })),
}));

class ProbeFeature extends BaseFeature {
  readonly updateMock = jest.fn(async (): Promise<void> => {});
  readonly setupMock = jest.fn(async (): Promise<void> => {});
  constructor(client: MockMqttClient) {
    super(client, 'probe');
  }
  protected async publishDiscovery(): Promise<void> { /* none */ }
  protected setup(): Promise<void> { return this.setupMock(); }
  protected update(): Promise<void> { return this.updateMock(); }
}

let feature: ProbeFeature;

beforeEach(async () => {
  jest.useFakeTimers();
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {});
  }
  const client = new MockMqttClient();
  await client.connect();
  feature = new ProbeFeature(client);
});

afterEach(async () => {
  await feature.stop();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('BaseFeature periodic updates', () => {
  it('keeps refreshing a feature whose first update failed', async () => {
    feature.updateMock.mockRejectedValueOnce(new Error('command not found'));

    await feature.start();
    expect(logger.error).toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(30_000);
    expect(feature.updateMock).toHaveBeenCalledTimes(2);
  });

  it('arms no timer when setup() fails, so the next start begins clean', async () => {
    feature.setupMock.mockRejectedValueOnce(new Error('subscribe refused'));

    await feature.start();
    await jest.advanceTimersByTimeAsync(30_000);

    expect(feature.updateMock).not.toHaveBeenCalled();
  });
});
