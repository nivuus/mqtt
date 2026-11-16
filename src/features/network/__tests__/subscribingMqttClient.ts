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
  /**
   * Delivers `payload` like a broker and returns once `settled` holds; false when nothing matched.
   *
   * A broker does not wait for a handler, and the message listeners' return values are not part
   * of the contract (BaseFeature isolates them), so completion is observed through what the
   * feature publishes, which is what the tests assert on anyway. `settled` defaults to "the
   * feature published something"; pass the feature's last publish when it publishes several.
   */
  async deliver(topic: string, payload: string, settled: () => boolean = () => true): Promise<boolean> {
    if (!this.subscribedTopics.some(filter => topicMatches(filter, topic))) return false;
    const before = this.publishedMessages.length;
    this.emit('message', topic, Buffer.from(payload));
    const deadline = Date.now() + 5000;
    while (this.publishedMessages.length === before || !settled()) {
      if (Date.now() > deadline) throw new Error(`No settled publish after delivering on ${topic}`);
      await new Promise(resolve => setTimeout(resolve, 1));
    }
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
