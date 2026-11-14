// src/features/wifi/__tests__/HostapdManager.rename.test.ts
//
// A rename from Home Assistant keeps the network's entity id only once the files are
// written: a failed write must leave network_<n> on the SSID that really exists.

import { HostapdManager } from '../HostapdManager';
import { MockMqttClient } from '../../../mqtt/__tests__/mocks/MockMqttClient';
import { execute_argv } from '../../../utils/exec';

const RADIO = '/etc/hostapd/2.4Ghz.conf';

jest.mock('../../../utils/exec', () => ({ execute_argv: jest.fn() }));
jest.mock('fs', () => ({ ...jest.requireActual('fs'), writeFileSync: jest.fn() }));
jest.mock('../../../config', () => ({
  getConfigManager: jest.fn(() => ({
    config: {
      mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
      device_info: { name: 'Nivuus', identifiers: ['nivuus'], manufacturer: 'n', model: 'A', sw_version: '1' },
      features: { hostapd_manager: { enabled: true, update_interval_seconds: 0, config_paths: ['/etc/hostapd/2.4Ghz.conf'] } },
      logging: { level: 'info' },
    },
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockedFs = require('fs') as { writeFileSync: jest.Mock };
const mockedExec = execute_argv as jest.MockedFunction<typeof execute_argv>;

const FIXTURE = [
  'interface=wlan0', 'bridge=localBridge', 'ssid=Home', 'wpa=2', 'wpa_key_mgmt=WPA-PSK',
  'wpa_passphrase=main-secret-1', '', 'bss=wlan1', 'ssid=Guest', 'bridge=publicBridge', 'wpa=2',
  'wpa_key_mgmt=WPA-PSK', 'wpa_passphrase=guest-secret-1', '',
].join('\n');

interface ManagerInternals {
  publishDiscovery(): Promise<void>;
  update(): Promise<void>;
  handleMqttMessage(topic: string, payload: Buffer): Promise<void>;
  ssidToId: Map<string, number>;
}

let files: Map<string, string>;
let writeFails: boolean;

beforeEach(() => {
  files = new Map([[RADIO, FIXTURE]]);
  writeFails = false;
  mockedFs.writeFileSync.mockImplementation((path: string, content: string) => files.set(path, String(content)));
  mockedExec.mockImplementation(async (command: string, args: string[]) => {
    const argv = command === 'sudo' ? args : [command, ...args];
    const ok = (stdout = '') => ({ stdout, stderr: '', exitCode: 0 });
    if (argv[0] === 'cat') return ok(files.get(argv[1]) ?? '');
    if (argv[0] === 'cp' && writeFails) return { stdout: '', stderr: 'cp: Read-only file system', exitCode: 1 };
    if (argv[0] === 'cp' || argv[0] === 'mv') {
      files.set(argv[2], files.get(argv[1])!);
      return ok();
    }
    if (argv[0] === 'systemctl') return ok();
    throw new Error(`unexpected command ${argv.join(' ')}`);
  });
});

async function startManager(): Promise<{ client: MockMqttClient; manager: ManagerInternals }> {
  const client = new MockMqttClient();
  await client.connect();
  const manager = new HostapdManager(client as never) as unknown as ManagerInternals;
  await manager.publishDiscovery();
  return { client, manager };
}

async function renameGuest(manager: ManagerInternals): Promise<void> {
  const id = manager.ssidToId.get('Guest');
  const topic = (path: string) => `system_agent/nivuus/hostapd_manager/network_${id}/${path}`;
  await manager.handleMqttMessage(topic('name/set'), Buffer.from('Guest2'));
  await manager.handleMqttMessage(topic('command/apply'), Buffer.from('APPLY'));
}

const discoveredIds = (client: MockMqttClient) => new Set(client.publishedMessages
  .map((m) => /^homeassistant\/[a-z_]+\/nivuus\/nivuus_hostapd_manager_network_(\d+)_/.exec(m.topic)?.[1])
  .filter((id): id is string => !!id));

describe('HostapdManager rename', () => {
  it('keeps the entity id on the old SSID when the write fails, and publishes no duplicate', async () => {
    const { client, manager } = await startManager();
    const guestId = manager.ssidToId.get('Guest');
    expect(discoveredIds(client)).toEqual(new Set(['1', '2']));
    writeFails = true;

    await renameGuest(manager);
    await manager.update();

    expect(files.get(RADIO)).toBe(FIXTURE);
    expect(manager.ssidToId.get('Guest')).toBe(guestId);
    expect(manager.ssidToId.has('Guest2')).toBe(false);
    expect(discoveredIds(client)).toEqual(new Set(['1', '2']));
  });

  it('moves the entity id to the new SSID once the write succeeded', async () => {
    const { client, manager } = await startManager();
    const guestId = manager.ssidToId.get('Guest');

    await renameGuest(manager);

    expect(files.get(RADIO)).toContain('ssid=Guest2');
    expect(manager.ssidToId.get('Guest2')).toBe(guestId);
    expect(manager.ssidToId.has('Guest')).toBe(false);
    expect(discoveredIds(client)).toEqual(new Set(['1', '2']));
  });
});
