// src/mqtt/retainedPublishCache.ts
//
// The last payload sent as a retained message on each topic, so an unchanged
// retained state is not sent again. Features publish every state on every
// tick (UPS every 15 s, hardware health every 30 s, CPU, memory, network and
// disks every minute): the broker already holds that exact retained value, and
// sending it again only costs a QoS 1 round trip and a Home Assistant bus
// event, about 200 000 a day.
//
// The broker is the one that holds a retained value, so the cache must be
// forgotten whenever what the broker holds may differ from what it remembers:
// on every (re)connection (a broker restarted without persistence lost its
// retained store) and on Home Assistant's birth message (Agent clears it before
// republishing, so a restarted Home Assistant gets every value again).

export class RetainedPublishCache {
  private readonly lastPayload = new Map<string, string>();

  /**
   * Whether this retained payload must be sent: true unless it is exactly the
   * last one sent on the topic. A payload that must be sent is remembered at
   * once, so two ticks racing on the same topic do not both send it; call
   * failed() if the send then fails.
   */
  public claim(topic: string, payload: string | Buffer): boolean {
    // Buffers are never compared: no caller publishes one, and a binary
    // payload has no stable string form worth keeping in memory.
    if (typeof payload !== 'string') return true;
    if (this.lastPayload.get(topic) === payload) return false;
    this.lastPayload.set(topic, payload);
    return true;
  }

  /** The send claimed for this payload failed: the broker may not hold it. */
  public failed(topic: string, payload: string | Buffer): void {
    if (typeof payload === 'string' && this.lastPayload.get(topic) === payload) {
      this.lastPayload.delete(topic);
    }
  }

  public clear(): void {
    this.lastPayload.clear();
  }
}
