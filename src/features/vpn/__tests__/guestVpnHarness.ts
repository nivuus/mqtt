/**
 * Shared set-up for the GuestVpn feature tests: a connected mock MQTT client, the FakeNm
 * nmcli double (nothing runs on the host), a status double that derives the state from the
 * fake NM, and helpers to read what was published.
 */
import { promises as fs } from 'fs';
import * as execModule from '../../../utils/exec';
import { MockMqttClient } from '../../../mqtt/__tests__/mocks/MockMqttClient';
import { GuestVpn } from '../GuestVpn';
import { readDesiredEnabled } from '../desiredState';
import { GuestVpnStatus } from '../guestVpnStatus';
import { NmGuestVpn } from '../nmGuestVpn';
import { FakeNm } from './fakeNmcli';

/** Read through `jest.mock('../../../config', ...)` factories in the test files. */
export const mockAgentConfig = {
  mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
  device_info: { name: 'Nivuus', identifiers: ['nivuus'], manufacturer: 'Nivuus', model: 'Agent', sw_version: '1.0' },
  features: {
    guest_vpn: { enabled: true, update_interval_seconds: 0, bridge: 'publicBridge', state_file: '' },
  },
  logging: { level: 'info' },
};

export const TOPIC = (suffix: string) => `system_agent/nivuus/guest_vpn/${suffix}`;
export const CONNECTED = { dns: ['10.8.0.1'], exitIp: '203.0.113.7', remote: 'vpn.example.com' };

/** What readGuestVpnStatus would report for the fake NM's state (its own logic is Task 4's). */
export async function fakeStatus(nm: FakeNm, lastActivationError?: string): Promise<GuestVpnStatus> {
  const uuids = nm.uuidsOf(nm.cfg.connectionId);
  if (uuids.length === 0) return { state: 'no_config', dns: [] };
  if (uuids.length > 1) return { state: 'error', lastError: `${uuids.length} profiles named ${nm.cfg.connectionId}`, dns: [] };
  if (nm.active.has(uuids[0])) return { state: 'connected', ...CONNECTED };
  if (!(await readDesiredEnabled(nm.cfg.stateFile))) return { state: 'disabled', dns: [] };
  return { state: 'error', lastError: lastActivationError ?? 'not active although enabled', dns: [] };
}

export interface Harness {
  nm: FakeNm;
  mqtt: MockMqttClient;
  feature: GuestVpn;
  /** Starts the feature and waits for its first tick. */
  start(): Promise<void>;
  /** Runs one scheduled update, as BaseFeature's interval does, and waits for it. */
  tick(): Promise<void>;
  /** Every payload published on `guest_vpn/<suffix>`, in order. */
  payloads(suffix: string): string[];
  last(suffix: string): string | undefined;
  attributes(): Record<string, unknown>;
  upCalls(): number;
  send(command: string): Promise<void>;
  desiredFile(): Promise<string | undefined>;
}

export async function makeHarness(exec: jest.Mocked<typeof execModule>): Promise<Harness> {
  const nm = new FakeNm();
  await nm.install(exec);
  mockAgentConfig.features.guest_vpn.state_file = nm.cfg.stateFile;
  const mqtt = new MockMqttClient();
  await mqtt.connect();
  const feature = new GuestVpn(mqtt, 'guest_vpn', new NmGuestVpn(nm.cfg, nm.env));
  const payloads = (suffix: string) => mqtt.publishedMessages
    .filter(m => m.topic === TOPIC(suffix)).map(m => String(m.message));
  const last = (suffix: string) => payloads(suffix).pop();
  return {
    nm, mqtt, feature, payloads, last,
    start: async () => {
      await feature.start();
      await feature.whenIdle();
    },
    tick: async () => {
      await (feature as unknown as { update(): Promise<void> }).update();
      await feature.whenIdle();
    },
    attributes: () => JSON.parse(last('state/attributes') ?? '{}'),
    upCalls: () => nm.find(a => a.includes('up') && a.includes('connection')).length,
    send: async (command: string) => {
      mqtt.simulateMessage(TOPIC('switch/set'), Buffer.from(command));
      await feature.whenIdle();
    },
    desiredFile: () => fs.readFile(nm.cfg.stateFile, 'utf8').catch(() => undefined),
  };
}
