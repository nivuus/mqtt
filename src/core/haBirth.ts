// src/core/haBirth.ts
//
// Republish everything when Home Assistant comes back.
//
// Home Assistant announces itself on `homeassistant/status` ("online") when it
// starts. States the agent publishes without the retain flag, and inputs it
// clears with an empty payload (an empty retained message is MQTT's way of
// deleting the retained one), are then missing until the next update: Home
// Assistant showed CPU load "unknown" for a minute after each restart, and the
// firewall and Wi-Fi forms showed the word "unknown" in their fields. MQTT
// discovery documents the birth message for exactly this.

import { MqttClient as MqttClientInterface } from './types';
import logger from '../utils/logger';

export const HA_STATUS_TOPIC = 'homeassistant/status';
export const HA_BIRTH_PAYLOAD = 'online';

export function isHaBirth(topic: string, payload: Buffer | string): boolean {
  return topic === HA_STATUS_TOPIC && String(payload).trim() === HA_BIRTH_PAYLOAD;
}

/**
 * Calls `republish` on each birth message. A request arriving while a
 * republish runs is not dropped: one more republish follows, so the last
 * request is always answered after it was received.
 */
export class HaBirthWatcher {
  private running: Promise<void> | null = null;
  private pending = false;

  constructor(
    private readonly mqttClient: MqttClientInterface,
    private readonly republish: () => Promise<void>,
  ) {
    this.mqttClient.on('message', (topic: string, payload: Buffer) => {
      if (isHaBirth(topic, payload)) void this.trigger('Home Assistant came online');
    });
  }

  /** Subscribe on every (re)connection: a clean session forgets subscriptions. */
  public async subscribe(): Promise<void> {
    await this.mqttClient.subscribe(HA_STATUS_TOPIC, { qos: 1 });
  }

  /**
   * Run `republish` now, or once more after the run in progress. Every
   * full republish of the agent goes through here (MQTT reconnection too),
   * so two never overlap.
   */
  public trigger(reason: string): Promise<void> {
    if (this.running) {
      this.pending = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.pending = false;
        logger.info(`${reason}: republishing discovery and states.`);
        try {
          await this.republish();
        } catch (error) {
          logger.error(`Republishing (${reason}) failed:`, error);
        }
      } while (this.pending);
      this.running = null;
    })();
    return this.running;
  }
}
