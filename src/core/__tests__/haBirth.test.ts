import { EventEmitter } from 'events';
import { HaBirthWatcher, isHaBirth, HA_STATUS_TOPIC } from '../haBirth';
import { MqttClient as MqttClientInterface } from '../types';

class FakeClient extends EventEmitter {
  subscribed: string[] = [];
  async subscribe(topic: string) {
    this.subscribed.push(topic);
    return this;
  }
}

const asClient = (c: FakeClient) => c as unknown as MqttClientInterface;
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('isHaBirth', () => {
  it('accepts only "online" on homeassistant/status', () => {
    expect(isHaBirth(HA_STATUS_TOPIC, Buffer.from('online'))).toBe(true);
    expect(isHaBirth(HA_STATUS_TOPIC, Buffer.from('offline'))).toBe(false);
    expect(isHaBirth('system_agent/nivuus/status', Buffer.from('online'))).toBe(false);
  });
});

describe('HaBirthWatcher', () => {
  it('subscribes to the Home Assistant status topic', async () => {
    const client = new FakeClient();
    await new HaBirthWatcher(asClient(client), async () => undefined).subscribe();
    expect(client.subscribed).toEqual([HA_STATUS_TOPIC]);
  });

  it('republishes on a birth message, not on other messages', async () => {
    const client = new FakeClient();
    const republish = jest.fn(async () => undefined);
    new HaBirthWatcher(asClient(client), republish);
    client.emit('message', HA_STATUS_TOPIC, Buffer.from('offline'));
    client.emit('message', 'system_agent/x', Buffer.from('online'));
    await flush();
    expect(republish).not.toHaveBeenCalled();
    client.emit('message', HA_STATUS_TOPIC, Buffer.from('online'));
    await flush();
    expect(republish).toHaveBeenCalledTimes(1);
  });

  it('answers a birth received during a republish with one more, never in parallel', async () => {
    let release!: () => void;
    let active = 0;
    let maxActive = 0;
    const republish = jest.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => { release = resolve; });
      active -= 1;
    });
    const watcher = new HaBirthWatcher(asClient(new FakeClient()), republish);
    const first = watcher.trigger('test');
    void watcher.trigger('test');
    void watcher.trigger('test');
    release();
    await flush();
    release();
    await first;
    expect(republish).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });

  it('keeps working after a failed republish', async () => {
    const republish = jest.fn()
      .mockRejectedValueOnce(new Error('broker hiccup'))
      .mockResolvedValueOnce(undefined);
    const watcher = new HaBirthWatcher(asClient(new FakeClient()), republish);
    await watcher.trigger('test');
    await watcher.trigger('test');
    expect(republish).toHaveBeenCalledTimes(2);
  });
});
