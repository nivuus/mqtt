// Everything the firewall feature publishes for a given firewalld state:
// discovery configs and states, in order. Pinned by a snapshot so that
// restructuring the feature cannot change what Home Assistant receives.

import * as execModule from '../../../utils/exec';
import { FirewallManager } from '../FirewallManager';
import { MockMqttClient } from '../../../mqtt/__tests__/mocks/MockMqttClient';

jest.mock('../../../utils/exec');
jest.mock('../../../config', () => ({
  getConfigManager: jest.fn(() => ({
    config: {
      mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
      device_info: { name: 'Nivuus', identifiers: ['nivuus'], manufacturer: 'n', model: 'A', sw_version: '1' },
      features: { firewalld_manager: { enabled: true, update_interval_seconds: 0 } },
      logging: { level: 'info' },
    },
  })),
}));

const mockedExec = execModule as jest.Mocked<typeof execModule>;

// A trimmed copy of the reference host's firewalld.
const ACTIVE_ZONES = [
  'docker', '  interfaces: docker0 br-1234',
  'external', '  interfaces: enp5s0.832 ppp0',
  'home (default)', '  interfaces: localBridge enp15s0',
  'public', '  interfaces: publicBridge',
].join('\n');

function firewallCmd(args: string[]): { stdout: string; exitCode: number } {
  const [first, second] = args;
  if (first === '--get-active-zones') return { stdout: ACTIVE_ZONES, exitCode: 0 };
  if (first === '--get-zones') return { stdout: 'block docker drop external home internal public trusted', exitCode: 0 };
  const zone = first.replace('--zone=', '');
  if (second === '--list-forward-ports') {
    return { stdout: zone === 'external' ? 'port=47984:proto=tcp:toport=47984:toaddr=192.168.3.2' : '', exitCode: 0 };
  }
  if (second === '--list-services') return { stdout: zone === 'home' ? 'dhcp dns ssh' : 'ssh', exitCode: 0 };
  if (second === '--list-ports') return { stdout: zone === 'external' ? '445/tcp 3478/udp' : '', exitCode: 0 };
  if (second === '--query-masquerade') return { stdout: '', exitCode: zone === 'home' ? 1 : 0 };
  return { stdout: '', exitCode: 1 };
}

describe('FirewallManager publications', () => {
  beforeEach(() => {
    mockedExec.execute_argv.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd !== 'firewall-cmd') throw new Error(`unexpected command ${cmd}`);
      return { stderr: '', ...firewallCmd(args) } as never;
    });
  });

  it('publishes the pinned discovery and states', async () => {
    const client = new MockMqttClient();
    await client.connect();
    const feature = new FirewallManager(client as never, 'firewalld_manager');
    await (feature as unknown as { publishDiscovery(): Promise<void> }).publishDiscovery();
    await (feature as unknown as { update(): Promise<void> }).update();
    const published = client.publishedMessages.map((m) => ({
      topic: m.topic,
      retain: m.options?.retain ?? false,
      message: String(m.message).startsWith('{') ? JSON.parse(String(m.message)) : String(m.message),
    }));
    expect(published).toMatchSnapshot();
  });
});
