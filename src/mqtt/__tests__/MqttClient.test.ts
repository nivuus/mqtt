// src/mqtt/__tests__/MqttClient.test.ts
//
// The wrapper's subscribe() is promise-only and settles exactly once. It used
// to call a callback AND reject when disconnected, and its (topic, fn) form
// never settled at all.

import { EventEmitter } from 'node:events';
import { MqttClient } from '../MqttClient';
import logger from '../../utils/logger';
import * as mqtt from 'mqtt';

// connect() is replaced so a (re)connection can be driven by hand.
jest.mock('mqtt', () => ({ ...jest.requireActual('mqtt'), connect: jest.fn() }));

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
  public publishError: Error | null = null;
  async subscribeAsync(topic: string) {
    if (this.subscribeError) throw this.subscribeError;
    return [{ topic, qos: 1 }];
  }
  async publishAsync(topic: string) {
    if (this.publishError) throw this.publishError;
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

// Every feature republishes all its states on every tick; the broker already
// holds an unchanged retained value, so sending it again only costs a QoS 1
// round trip and a Home Assistant event (about 200 000 a day).
describe('MqttClient retained de-duplication', () => {
  const retained = { retain: true, qos: 1 as const };

  it('does not send an unchanged retained payload again', async () => {
    const inner = new FakeInnerClient();
    const client = connectedClient(inner);
    await client.publish('a/state', '42', retained);
    await client.publish('a/state', '42', retained);
    await client.publish('a/state', '43', retained);
    await client.publish('a/state', '42', retained);
    expect(inner.published).toEqual(['a/state', 'a/state', 'a/state']);
  });

  it('keeps topics apart', async () => {
    const inner = new FakeInnerClient();
    const client = connectedClient(inner);
    await client.publish('a/state', '42', retained);
    await client.publish('b/state', '42', retained);
    expect(inner.published).toEqual(['a/state', 'b/state']);
  });

  it('always sends a non-retained payload, events included', async () => {
    const inner = new FakeInnerClient();
    const client = connectedClient(inner);
    await client.publish('a/event', 'x', { qos: 1 });
    await client.publish('a/event', 'x', { qos: 1 });
    expect(inner.published).toEqual(['a/event', 'a/event']);
  });

  it('sends everything again after forgetRetained (Home Assistant birth)', async () => {
    const inner = new FakeInnerClient();
    const client = connectedClient(inner);
    await client.publish('a/state', '42', retained);
    client.forgetRetained();
    await client.publish('a/state', '42', retained);
    expect(inner.published).toEqual(['a/state', 'a/state']);
  });

  it('sends everything again on a new broker connection', async () => {
    const inner = new FakeInnerClient();
    const client = connectedClient(inner);
    await client.publish('a/state', '42', retained);
    // What the wrapper does when mqtt.js reports a (re)connection.
    client.connected = false;
    const fresh = new FakeInnerClient();
    (mqtt.connect as unknown as jest.Mock).mockReturnValue(fresh);
    const connecting = client.connect();
    fresh.emit('connect');
    await connecting;
    await client.publish('a/state', '42', retained);
    expect(fresh.published).toEqual(['a/state']);
  });

  it('sends the payload again after a failed send', async () => {
    const inner = new FakeInnerClient();
    const client = connectedClient(inner);
    inner.publishError = new Error('broker gone');
    await expect(client.publish('a/state', '42', retained)).rejects.toThrow('broker gone');
    inner.publishError = null;
    await client.publish('a/state', '42', retained);
    expect(inner.published).toEqual(['a/state']);
  });
});
