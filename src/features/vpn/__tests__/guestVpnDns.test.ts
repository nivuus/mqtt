import * as execModule from '../../../utils/exec';
import { reconcileDnsRedirect, renderDnsTable } from '../guestVpnDns';
import { GuestVpnStatus } from '../guestVpnStatus';
import { DEFAULT_GUEST_VPN_CONFIG } from '../nmProfileSettings';
import { ok, Result } from './fakeNmcli';

jest.mock('../../../utils/exec');
const exec = execModule as jest.Mocked<typeof execModule>;

type Call = { file: string; args: string[]; input?: string };

const cfg = DEFAULT_GUEST_VPN_CONFIG;
const TABLE = 'nivuus_guest_vpn';
const TUNNEL_DNS = '10.8.0.1';

const EXPECTED_WITH_DNS = `table inet ${TABLE}
delete table inet ${TABLE}
table inet ${TABLE} {
  chain prerouting {
    type nat hook prerouting priority dstnat - 10; policy accept;
    iifname "publicBridge" meta nfproto ipv4 udp dport 53 dnat ip to ${TUNNEL_DNS}
    iifname "publicBridge" meta nfproto ipv4 tcp dport 53 dnat ip to ${TUNNEL_DNS}
  }
  chain input {
    type filter hook input priority filter - 10; policy accept;
    iifname "publicBridge" meta nfproto ipv6 udp dport 53 reject
    iifname "publicBridge" meta nfproto ipv6 tcp dport 53 reject with tcp reset
  }
  chain forward {
    type filter hook forward priority filter - 10; policy accept;
    iifname "publicBridge" meta nfproto ipv6 udp dport 53 reject
    iifname "publicBridge" meta nfproto ipv6 tcp dport 53 reject with tcp reset
  }
}
`;

const EXPECTED_EMPTY = `table inet ${TABLE}
delete table inet ${TABLE}
table inet ${TABLE} {
}
`;

const status = (state: GuestVpnStatus['state'], dns: string[] = [TUNNEL_DNS]): GuestVpnStatus =>
  ({ state, dns, ...(state === 'connected' && { exitIp: '5.255.103.96' }) });

describe('guest DNS redirect', () => {
  let calls: Call[];
  let applyResult: Result;

  beforeEach(() => {
    jest.clearAllMocks();
    calls = [];
    applyResult = ok();
    exec.execute_argv.mockImplementation(async (file, args) => {
      calls.push({ file, args: [...args] });
      throw new Error(`unexpected ${file} ${args.join(' ')}`);
    });
    exec.execute_argv_input.mockImplementation(async (file, args, input) => {
      calls.push({ file, args: [...args], input });
      if (file === 'nft' && args.join(' ') === '-f -') return applyResult;
      throw new Error(`unexpected ${file} ${args.join(' ')}`);
    });
  });

  const applied = () => calls.filter(c => c.input !== undefined).map(c => c.input);

  describe('renderDnsTable', () => {
    it('with dns emits udp and tcp dport 53 dnat to the first IPv4 dns for iifname publicBridge, and ipv6 dport 53 reject', () => {
      expect(renderDnsTable('publicBridge', ['fd00::53', TUNNEL_DNS, '10.8.0.2'])).toBe(EXPECTED_WITH_DNS);
    });

    it('renderDnsTable(null) emits an empty table', () => {
      expect(renderDnsTable('publicBridge', null)).toBe(EXPECTED_EMPTY);
    });

    it('with only IPv6 or no dns emits the empty table', () => {
      expect(renderDnsTable('publicBridge', ['fd00::53'])).toBe(EXPECTED_EMPTY);
      expect(renderDnsTable('publicBridge', [])).toBe(EXPECTED_EMPTY);
    });

    it('rejects a bridge name that is not an interface name', () => {
      expect(() => renderDnsTable('br"; flush ruleset', [TUNNEL_DNS])).toThrow(/interface name/);
    });

    it('never treats a non-address entry as the DNAT target', () => {
      expect(renderDnsTable('publicBridge', ['10.8.0.1; flush ruleset'])).toBe(EXPECTED_EMPTY);
    });
  });

  describe('reconcileDnsRedirect', () => {
    it('reconcile adds DNAT when connected', async () => {
      await reconcileDnsRedirect(cfg, status('connected'));
      expect(applied()).toEqual([EXPECTED_WITH_DNS]);
    });

    it('reconcile removes DNAT when not connected', async () => {
      await reconcileDnsRedirect(cfg, status('connected'));
      for (const state of ['connecting', 'error', 'disabled', 'no_config'] as const) {
        calls = [];
        await reconcileDnsRedirect(cfg, status(state));
        expect(applied()).toEqual([EXPECTED_EMPTY]);
      }
    });

    it('reconcile re-creates missing table: the atomic script is applied on every tick', async () => {
      await reconcileDnsRedirect(cfg, status('connected'));
      await reconcileDnsRedirect(cfg, status('connected'));
      expect(applied()).toEqual([EXPECTED_WITH_DNS, EXPECTED_WITH_DNS]);
      expect(calls.map(c => `${c.file} ${c.args.join(' ')}`)).toEqual(['nft -f -', 'nft -f -']);
    });

    it('follows a change of pushed DNS', async () => {
      await reconcileDnsRedirect(cfg, status('connected'));
      await reconcileDnsRedirect(cfg, status('connected', ['10.9.0.1']));
      expect(applied()[1]).toContain('dnat ip to 10.9.0.1');
    });

    it('connected without an IPv4 dns: applies the empty table and reports it', async () => {
      await reconcileDnsRedirect(cfg, status('connected'));
      await expect(reconcileDnsRedirect(cfg, status('connected', ['fd00::53'])))
        .rejects.toThrow(/no IPv4 DNS/);
      expect(applied()).toEqual([EXPECTED_WITH_DNS, EXPECTED_EMPTY]);
      await expect(reconcileDnsRedirect(cfg, status('connected', [])))
        .rejects.toThrow(/no IPv4 DNS/);
    });

    it('reports a failed nft apply and applies again on the next tick', async () => {
      applyResult = { stdout: '', stderr: 'Error: Could not process rule', exitCode: 1 };
      await expect(reconcileDnsRedirect(cfg, status('connected')))
        .rejects.toThrow(/Could not process rule/);
      applyResult = ok();
      await reconcileDnsRedirect(cfg, status('connected'));
      expect(applied()).toEqual([EXPECTED_WITH_DNS, EXPECTED_WITH_DNS]);
    });

    it('never invokes firewall-cmd', async () => {
      for (const s of [status('connected'), status('error'), status('connected', []), status('disabled')]) {
        await reconcileDnsRedirect(cfg, s).catch(() => undefined);
      }
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every(c => c.file === 'nft')).toBe(true);
      expect(exec.execute_command).not.toHaveBeenCalled();
      expect(exec.execute_argv).not.toHaveBeenCalled();
      expect(calls.some(c => [c.file, ...c.args, c.input ?? ''].join(' ').includes('firewall-cmd'))).toBe(false);
    });
  });
});
