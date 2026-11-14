// src/mqtt/__tests__/MqttClient.test.ts
//
// The wrapper's subscribe() is promise-only and settles exactly once. It used
// to call a callback AND reject when disconnected, and its (topic, fn) form
// never settled at all.

import { EventEmitter } from 'node:events';
import { MqttClient } from '../MqttClient';
import logger from '../../utils/logger';

jest.mock('../../config', () => ({
  getConfigManager: jest.fn(() => ({
    config: {
      mqtt: { host: 'broker.test', port: 1883, base_topic: 'system_agent' },
      device_info: { name: 'Test', identifiers: ['nivuus'], manufacturer: 'T', model: 'A', sw_version: '1' },
      features: {},
    },
  })),
}));

/** Stands in for the mqtt.js client the wrapper drives once connected. */
class FakeInnerClient extends EventEmitter {
  public subscribeError: Error | null = null;
  public published: string[] = [];
  async subscribeAsync(topic: string) {
    if (this.subscribeError) throw this.subscribeError;
    return [{ topic, qos: 1 }];
  }
  async publishAsync(topic: string) {
    this.published.push(topic);
    return undefined;
  }
}

function connectedClient(inner: FakeInnerClient): MqttClient {
  const client = new MqttClient({ noWill: true });
  (client as unknown as { client: FakeInnerClient }).client = inner;
  client.connected = true;
  return client;
}

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {});
  }
});

afterEach(() => jest.restoreAllMocks());

describe('MqttClient.subscribe', () => {
  it('rejects once when disconnected and calls no callback', async () => {
    const client = new MqttClient({ noWill: true });
    const legacyCallback = jest.fn();
    const subscribe = client.subscribe as unknown as (...args: unknown[]) => Promise<unknown>;
    await expect(subscribe.call(client, 'a/b', { qos: 1 }, legacyCallback)).rejects.toThrow(/not connected/);
    expect(legacyCallback).not.toHaveBeenCalled();
  });

  it('resolves when the broker grants the subscription', async () => {
    const client = connectedClient(new FakeInnerClient());
    await expect(client.subscribe('a/b')).resolves.toBe(client);
    await expect(client.subscribe('a/b', { qos: 1 })).resolves.toBe(client);
  });

  it('rejects when the broker refuses the subscription', async () => {
    const inner = new FakeInnerClient();
    inner.subscribeError = new Error('refused');
    const client = connectedClient(inner);
    await expect(client.subscribe('a/b')).rejects.toThrow('refused');
  });
});

describe('MqttClient.publish', () => {
  it('resolves while disconnected and delivers a retained message on reconnection', async () => {
    const client = new MqttClient({ noWill: true });
    await expect(client.publish('a/retained', 'x', { retain: true, qos: 1 })).resolves.toBe(client);
    await expect(client.publish('a/transient', 'x', { qos: 0 })).resolves.toBe(client);

    const inner = new FakeInnerClient();
    (client as unknown as { client: FakeInnerClient }).client = inner;
    client.connected = true;
    await (client as unknown as { drainQueue: () => Promise<void> }).drainQueue();
    expect(inner.published).toEqual(['a/retained']);
  });
});
