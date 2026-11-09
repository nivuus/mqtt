/**
 * The guest VPN in Home Assistant: an on/off switch, the tunnel state (with NM's last error,
 * the remote server and DNS problems as attributes), the measured exit IP and whether guests
 * currently leave through Orange. The `.ovpn` upload does not fit an MQTT entity; it arrives
 * through `importProfile`, called by the WebSocket API.
 *
 * Only NetworkManager and the agent's own nft table are touched, never firewalld.
 */
import { BaseFeature } from '../../core/BaseFeature';
import { FeatureConfig, MqttClient } from '../../core/types';
import logger from '../../utils/logger';
import { guestVpnEntities, guestVpnTopics, snapshotPayloads } from './guestVpnDiscovery';
import { GuestVpnStatus } from './guestVpnStatus';
import { GuestVpnSnapshot, GuestVpnSupervisor } from './guestVpnSupervisor';
import { DEFAULT_GUEST_VPN_CONFIG, GuestVpnConfig, NmGuestVpn, ProfileInput } from './nmGuestVpn';

/** `bridge` and `state_file` override the defaults; the other names are fixed (plan). */
export function guestVpnConfigFrom(feature: FeatureConfig): GuestVpnConfig {
  const pick = (key: string, fallback: string): string => {
    const value = feature[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || value === '') throw new Error(`guest_vpn.${key} must be a non-empty string`);
    return value;
  };
  return {
    ...DEFAULT_GUEST_VPN_CONFIG,
    bridge: pick('bridge', DEFAULT_GUEST_VPN_CONFIG.bridge),
    stateFile: pick('state_file', DEFAULT_GUEST_VPN_CONFIG.stateFile),
  };
}

export class GuestVpn extends BaseFeature {
  private readonly supervisor: GuestVpnSupervisor;
  private readonly topics: ReturnType<typeof guestVpnTopics>;
  private tickRunning = false;
  private readonly onMessage = (topic: string, payload: Buffer): void => this.handleMessage(topic, payload);

  constructor(mqttClient: MqttClient, featureName: string = 'guest_vpn', nm?: NmGuestVpn) {
    super(mqttClient, featureName);
    const cfg = guestVpnConfigFrom(this.featureConfig);
    this.topics = guestVpnTopics(this.featureName);
    this.supervisor = new GuestVpnSupervisor(cfg, nm ?? new NmGuestVpn(cfg), s => this.publishSnapshot(s));
  }

  /** Validates and imports a profile, then returns the resulting state; throws with the reason. */
  importProfile(input: ProfileInput): Promise<GuestVpnStatus> {
    return this.supervisor.importProfile(input);
  }

  /** The status of the last supervision pass (at most one tick old), without a new probe. */
  getStatus(): Promise<GuestVpnStatus> {
    return this.supervisor.currentStatus();
  }

  /** Resolves once every queued tick, switch command and import has finished. */
  whenIdle(): Promise<void> {
    return this.supervisor.idle();
  }

  protected async publishDiscovery(): Promise<void> {
    for (const entity of guestVpnEntities(this.featureName)) {
      await this.publishEntityDiscovery(entity.component, entity.objectId, entity.payload);
    }
  }

  protected async setup(): Promise<void> {
    await this.mqttClient.subscribe(this.prefixTopic(this.topics.switchSet));
    this.mqttClient.on('message', this.onMessage);
  }

  protected async cleanup(): Promise<void> {
    this.mqttClient.off('message', this.onMessage);
  }

  /**
   * Starts one supervision tick and returns without waiting for it. An `up()` can take up to
   * two minutes: awaited, it would hold the Agent's sequential feature start-up (UPS included)
   * that long. A tick that finds the previous one still running is dropped rather than queued,
   * so missed ticks never turn into back-to-back activations. The tick publishes its own
   * outcome; `whenIdle()` waits for it.
   */
  protected async update(): Promise<void> {
    if (this.tickRunning) return;
    this.tickRunning = true;
    this.supervisor.tick()
      .catch(err => logger.error(`[${this.featureName}] supervision tick crashed:`, err))
      .finally(() => { this.tickRunning = false; });
  }

  private handleMessage(topic: string, payload: Buffer): void {
    if (topic !== this.prefixTopic(this.topics.switchSet)) return;
    const command = payload.toString().trim();
    if (command !== 'ON' && command !== 'OFF') {
      logger.warn(`[${this.featureName}] ignoring switch payload "${command}" (expected ON or OFF)`);
      return;
    }
    logger.info(`[${this.featureName}] switch ${command} requested`);
    // switchTo reports its own failures in the published snapshot; this only catches a bug.
    this.supervisor.switchTo(command === 'ON').catch(err =>
      logger.error(`[${this.featureName}] switch ${command} crashed:`, err));
  }

  private async publishSnapshot(snapshot: GuestVpnSnapshot): Promise<void> {
    for (const [topic, value] of snapshotPayloads(this.featureName, snapshot)) {
      await this.publishState(topic, value, true);
    }
  }
}
