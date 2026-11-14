// src/core/__tests__/BaseFeature.listeners.test.ts
//
// One feature's message handler failing must neither crash the agent (a
// rejected async listener is an unhandled rejection, on which it exits) nor
// keep the other features' handlers from receiving the message.

import { BaseFeature } from '../BaseFeature';
import { MockMqttClient } from '../../mqtt/__tests__/mocks/MockMqttClient';
import { unhandledRejectionsDuring } from '../../mqtt/__tests__/mocks/unhandledRejections';
import logger from '../../utils/logger';

jest.mock('../../config', () => ({
  getConfigManager: jest.fn(() => ({
    config: {
      mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
      device_info: { name: 'Test', identifiers: ['nivuus'], manufacturer: 'T', model: 'A', sw_version: '1' },
      features: { probe: { enabled: true } },
    },
  })),
}));

class ProbeFeature extends BaseFeature {
  constructor(client: MockMqttClient, private readonly handler: (topic: string) => void | Promise<void>) {
    super(client, 'probe');
  }
  protected async publishDiscovery(): Promise<void> { /* none */ }
  protected async update(): Promise<void> { /* none */ }
  protected async setup(): Promise<void> { this.listenToMessages((topic) => this.handler(topic)); }
}

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {});
  }
});

afterEach(() => jest.restoreAllMocks());

describe('BaseFeature.listenToMessages', () => {
  it('contains a handler that throws or rejects, and still feeds the next one', async () => {
    const client = new MockMqttClient();
    await client.connect();
    const received: string[] = [];
    await new ProbeFeature(client, () => { throw new Error('sync failure'); }).start();
    await new ProbeFeature(client, async () => { throw new Error('async failure'); }).start();
    await new ProbeFeature(client, (topic) => { received.push(topic); }).start();

    const reasons = await unhandledRejectionsDuring(async () => {
      client.simulateMessage('a/topic', 'x');
    });

    expect(reasons).toEqual([]);
    expect(received).toEqual(['a/topic']);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('removes the handler on stop()', async () => {
    const client = new MockMqttClient();
    await client.connect();
    const handler = jest.fn();
    const feature = new ProbeFeature(client, handler);
    await feature.start();
    await feature.stop();
    client.simulateMessage('a/topic', 'x');
    expect(handler).not.toHaveBeenCalled();
    expect(client.listenerCount('message')).toBe(0);
  });
});
