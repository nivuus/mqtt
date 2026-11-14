/**
 * A MockMqttClient that delivers a message only when one of the client's subscriptions
 * matches its topic, as a broker does. The plain mock emits every simulated message, which
 * hides a subscription that can never match (`*` is not an MQTT wildcard).
 */
import { MockMqttClient } from '../../../mqtt/__tests__/mocks/MockMqttClient';

/** MQTT 3.1.1 section 4.7: `+` matches one level, a trailing `#` the rest. */
export function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return i === f.length - 1;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

export class SubscribingMqttClient extends MockMqttClient {
  /** Delivers `payload` like a broker and waits for every listener; false when nothing matched. */
  async deliver(topic: string, payload: string): Promise<boolean> {
    if (!this.subscribedTopics.some(filter => topicMatches(filter, topic))) return false;
    const listeners = this.listeners('message') as Array<(t: string, p: Buffer) => unknown>;
    await Promise.all(listeners.map(listener => listener(topic, Buffer.from(payload))));
    return true;
  }

  /** Every payload published so far, as text. */
  allPayloads(): string[] {
    return this.publishedMessages.map(m => String(m.message));
  }

  payloadsOn(topic: string): string[] {
    return this.publishedMessages.filter(m => m.topic === topic).map(m => String(m.message));
  }
}
