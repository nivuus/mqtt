/**
 * Set-up for the PppoeCredentials tests: a keyfile fixture in a temp directory, a broker-like
 * MQTT client and an nmcli double. Nothing runs on the host.
 */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as execModule from '../../../utils/exec';
import { CommandResult } from '../../../utils/exec';
import { PppoeCredentials } from '../PppoeCredentials';
import { SubscribingMqttClient } from './subscribingMqttClient';

export const PROFILE_UUID = '6f1c2a5e-0d3b-4c7a-9b1e-2f4d5a6b7c8d';
export const OLD_SECRET = 'old-isp-secret-7f3a';

export const KEYFILE = [
  '[connection]',
  'id=pppoe-wan',
  `uuid=${PROFILE_UUID}`,
  'type=pppoe',
  'autoconnect=false',
  '',
  '[pppoe]',
  'parent=eth0.835',
  `password=${OLD_SECRET}`,
  'username=old-user@isp.example',
  '',
  '[ipv4]',
  'method=auto',
  '',
].join('\n');

/** Read through the `jest.mock('../../../config', ...)` factory of the test file. */
export const mockAgentConfig = {
  mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
  device_info: { name: 'Nivuus', identifiers: ['nivuus'], manufacturer: 'Nivuus', model: 'Agent', sw_version: '1.0' },
  features: {
    pppoe_credentials: {
      enabled: true, update_interval_seconds: 0,
      nmconnection_path: '', chap_secrets_path: '', pap_secrets_path: '',
    },
  },
  logging: { level: 'info' },
};

export const TOPIC = (suffix: string) => `system_agent/nivuus/pppoe_credentials/${suffix}`;

const ok = (stdout = ''): CommandResult => ({ stdout, stderr: '', exitCode: 0 });
const fail = (stderr: string): CommandResult => ({ stdout: '', stderr, exitCode: 1 });

export interface PppoeHarness {
  mqtt: SubscribingMqttClient;
  feature: PppoeCredentials;
  keyfile: string;
  /** argv of every program the feature ran, `file` first. */
  calls: string[][];
  /** Whether NM lists the profile as active. */
  active: boolean;
  /** nmcli verbs (`load`, `up`, ...) that exit 1. */
  failing: Set<string>;
  lastAction(): string | undefined;
  nmcliVerbs(): string[];
  cleanup(): Promise<void>;
}

export async function makePppoeHarness(exec: jest.Mocked<typeof execModule>): Promise<PppoeHarness> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pppoe-test-'));
  const keyfile = path.join(dir, 'pppoe-wan.nmconnection');
  await fs.writeFile(keyfile, KEYFILE, { mode: 0o600 });
  const cfg = mockAgentConfig.features.pppoe_credentials;
  cfg.nmconnection_path = keyfile;
  cfg.chap_secrets_path = path.join(dir, 'absent-chap-secrets');
  cfg.pap_secrets_path = path.join(dir, 'absent-pap-secrets');

  const mqtt = new SubscribingMqttClient();
  await mqtt.connect();
  const h: PppoeHarness = {
    mqtt, keyfile, calls: [], active: false, failing: new Set(),
    feature: undefined as unknown as PppoeCredentials,
    lastAction: () => mqtt.payloadsOn(TOPIC('last_action/state')).pop(),
    nmcliVerbs: () => h.calls.filter(c => c[0] === 'nmcli').map(c => c[c.indexOf('connection') + 1]),
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };

  exec.execute_command.mockResolvedValue(fail('not available in tests'));
  exec.execute_argv.mockImplementation(async (program: string, argv: string[]) => {
    // `sudo nmcli ...` is recorded and answered as `nmcli ...`.
    const [file, ...args] = program === 'sudo' ? argv : [program, ...argv];
    h.calls.push([file, ...args]);
    if (file === 'cat') return fs.readFile(args[0], 'utf8').then(ok, () => fail('No such file'));
    if (file !== 'nmcli') return ok();
    const verb = args[args.indexOf('connection') + 1];
    if (h.failing.has(verb)) return fail(`Error: ${verb} failed`);
    if (verb === 'show' && args.includes('--active')) return ok(h.active ? `${PROFILE_UUID}\n` : '');
    return ok();
  });

  h.feature = new PppoeCredentials(mqtt, 'pppoe_credentials');
  return h;
}
