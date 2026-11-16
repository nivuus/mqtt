import * as path from 'path';
import * as execModule from '../../../utils/exec';
import { CommandResult } from '../../../utils/exec';
import { SubscribingMqttClient } from './subscribingMqttClient';
import { ConnectedDevices } from '../ConnectedDevices';
import { reverseLookup } from '../reverseDns';

jest.mock('../../../utils/exec');
jest.mock('../reverseDns');
jest.mock('../../../utils/macVendor', () => ({
  MacVendorLookup: { batchLookup: jest.fn(async () => new Map()), lookupVendor: jest.fn(async () => ({})) },
}));
jest.mock('../../../config', () => ({
  getConfigManager: () => ({
    config: {
      mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
      device_info: { name: 'Nivuus', identifiers: ['nivuus'], manufacturer: 'Nivuus', model: 'Agent', sw_version: '1.0' },
      features: {
        connected_devices: {
          enabled: true, update_interval_seconds: 0,
          dnsmasq_lease_dir: require('path').join(__dirname, 'fixtures'),
        },
      },
      logging: { level: 'info' },
    },
  }),
}));

const mockedExec = execModule as jest.Mocked<typeof execModule>;
const mockedReverse = reverseLookup as jest.MockedFunction<typeof reverseLookup>;

const ADDR: Record<string, string> = {
  localBridge: '3: localBridge: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500\n    inet 192.168.0.1/24 brd 192.168.0.255 scope global localBridge\n',
  publicBridge: '5: publicBridge: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500\n    inet 192.168.2.1/24 brd 192.168.2.255 scope global publicBridge\n',
};
const NEIGH: Record<string, string> = {
  localBridge: [
    '192.168.0.21 lladdr aa:bb:cc:00:00:01 REACHABLE',
    '192.168.0.22 lladdr aa:bb:cc:00:00:02 STALE',
    '192.168.0.23 lladdr aa:bb:cc:00:00:03 REACHABLE',
    '192.168.0.24 lladdr aa:bb:cc:00:00:04 REACHABLE',
    '192.168.0.30 lladdr aa:bb:cc:00:00:30 STALE',
  ].join('\n'),
  publicBridge: '192.168.2.50 lladdr de:ad:be:ef:00:09 REACHABLE',
};

const ok = (stdout: string): CommandResult => ({ stdout, stderr: '', exitCode: 0 });
const refused = (what: string): CommandResult => ({ stdout: '', stderr: `refused: ${what}`, exitCode: 126 });

/** Answers the read-only `ip` commands, whichever way they are run. */
function answer(argv: string[]): CommandResult {
  const line = argv.join(' ');
  if (line === 'ip addr show') return ok(ADDR.localBridge + ADDR.publicBridge);
  const addr = line.match(/^ip addr show (\w+)$/);
  if (addr) return ok(ADDR[addr[1]] ?? '');
  const neigh = line.match(/^ip neigh show dev (\w+)$/);
  if (neigh) return ok(NEIGH[neigh[1]] ?? '');
  return refused(line);
}

type Device = { ip: string; hostname: string };

describe('ConnectedDevices host names', () => {
  let mqtt: SubscribingMqttClient;
  let feature: ConnectedDevices;
  const devicesOf = (bridge: string): Device[] => {
    const raw = mqtt.payloadsOn(`system_agent/nivuus/connected_devices/${bridge}/devices/attributes`).pop();
    return JSON.parse(raw ?? '{"devices":[]}').devices;
  };
  const nameOf = (bridge: string, ip: string) => devicesOf(bridge).find(d => d.ip === ip)?.hostname;

  beforeEach(async () => {
    mqtt = new SubscribingMqttClient();
    await mqtt.connect();
    mockedExec.execute_command.mockImplementation(async (command: string) => answer(command.split(' ')));
    mockedExec.execute_argv.mockImplementation(async (file: string, args: string[]) => answer([file, ...args]));
    mockedReverse.mockImplementation(async ip => (ip === '192.168.0.30' ? 'nas.home.arpa' : undefined));
    feature = new ConnectedDevices(mqtt, 'connected_devices');
    await feature.start();
  });
  afterEach(() => feature.stop());

  it('takes host names from the dnsmasq lease file of the bridge being processed', () => {
    expect(nameOf('localBridge', '192.168.0.21')).toBe('laptop-anna');
    expect(nameOf('publicBridge', '192.168.2.50')).toBe('guest-phone');
    expect(JSON.stringify(devicesOf('localBridge'))).not.toContain('guest-phone');
    expect(JSON.stringify(devicesOf('publicBridge'))).not.toContain('laptop-anna');
  });

  it('keeps names in any script and strips control and bidi characters from untrusted names', () => {
    expect(nameOf('localBridge', '192.168.0.23')).toBe('téléphone-ünïcode');
    expect(nameOf('localBridge', '192.168.0.24')).toBe('evil"name<script>');
  });

  it('falls back to a reverse lookup, short name only, when the lease has no name', () => {
    expect(nameOf('localBridge', '192.168.0.30')).toBe('nas');
    expect(nameOf('localBridge', '192.168.0.22')).toBe('Unknown');
    expect(mockedReverse).not.toHaveBeenCalledWith('192.168.0.21');
  });

  it('runs no shell command string at all', () => {
    expect(mockedExec.execute_command).not.toHaveBeenCalled();
    expect(mockedExec.execute_argv.mock.calls.map(c => c[0])).toEqual(expect.arrayContaining(['ip']));
    expect(mockedExec.execute_argv.mock.calls.some(c => ['brctl', 'timeout', 'dig', 'ping', 'getent'].includes(c[0]))).toBe(false);
  });
});
