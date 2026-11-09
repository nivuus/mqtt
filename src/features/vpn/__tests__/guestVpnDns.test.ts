import * as execModule from '../../../utils/exec';
import { GuestVpnStatus } from '../guestVpnStatus';
import { DEFAULT_GUEST_VPN_CONFIG } from '../nmProfileSettings';
import { ok, Result } from './fakeNmcli';

jest.mock('../../../utils/exec');

type Dns = typeof import('../guestVpnDns');
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
  let dnsModule: Dns;
  let exec: jest.Mocked<typeof execModule>;
  let calls: Call[];
  let tables: string[];
  let applyResult: Result;

  beforeEach(() => {
    jest.resetModules();
    exec = require('../../../utils/exec');
    dnsModule = require('../guestVpnDns');
    calls = [];
    tables = ['table inet firewalld'];
    applyResult = ok();
    exec.execute_argv.mockImplementation(async (file, args) => {
      calls.push({ file, args: [...args] });
      if (file === 'nft' && args.join(' ') === 'list tables') return ok(tables.map(t => `${t}\n`).join(''));
      throw new Error(`unexpected ${file} ${args.join(' ')}`);
    });
    exec.execute_argv_input.mockImplementation(async (file, args, input) => {
      calls.push({ file, args: [...args], input });
      if (file === 'nft' && args.join(' ') === '-f -') {
        if (applyResult.exitCode === 0) tables = [...tables.filter(t => !t.includes(TABLE)), `table inet ${TABLE}`];
        return applyResult;
      }
      throw new Error(`unexpected ${file} ${args.join(' ')}`);
    });
  });

  const applied = () => calls.filter(c => c.input !== undefined).map(c => c.input);

  describe('renderDnsTable', () => {
    it('with dns emits udp and tcp dport 53 dnat to the first IPv4 dns for iifname publicBridge, and ipv6 dport 53 reject', () => {
      expect(dnsModule.renderDnsTable('publicBridge', ['fd00::53', TUNNEL_DNS, '10.8.0.2'])).toBe(EXPECTED_WITH_DNS);
    });

    it('renderDnsTable(null) emits an empty table', () => {
      expect(dnsModule.renderDnsTable('publicBridge', null)).toBe(EXPECTED_EMPTY);
    });

    it('with only IPv6 or no dns emits the empty table', () => {
      expect(dnsModule.renderDnsTable('publicBridge', ['fd00::53'])).toBe(EXPECTED_EMPTY);
      expect(dnsModule.renderDnsTable('publicBridge', [])).toBe(EXPECTED_EMPTY);
    });

    it('rejects a bridge name that is not an interface name', () => {
      expect(() => dnsModule.renderDnsTable('br"; flush ruleset', [TUNNEL_DNS])).toThrow(/interface name/);
    });

    it('never treats a non-address entry as the DNAT target', () => {
      expect(dnsModule.renderDnsTable('publicBridge', ['10.8.0.1; flush ruleset'])).toBe(EXPECTED_EMPTY);
    });
  });

  describe('reconcileDnsRedirect', () => {
    it('reconcile adds DNAT when connected', async () => {
      await dnsModule.reconcileDnsRedirect(cfg, status('connected'));
      expect(applied()).toEqual([EXPECTED_WITH_DNS]);
    });

    it('reconcile removes DNAT when not connected', async () => {
      await dnsModule.reconcileDnsRedirect(cfg, status('connected'));
      for (const state of ['connecting', 'error', 'disabled', 'no_config'] as const) {
        calls = [];
        await dnsModule.reconcileDnsRedirect(cfg, status(state));
        expect(applied()).toEqual(state === 'connecting' ? [EXPECTED_EMPTY] : []);
      }
    });

    it('does nothing while the table in place is already the desired one', async () => {
      await dnsModule.reconcileDnsRedirect(cfg, status('connected'));
      calls = [];
      await dnsModule.reconcileDnsRedirect(cfg, status('connected'));
      expect(applied()).toEqual([]);
      expect(calls.map(c => `${c.file} ${c.args.join(' ')}`)).toEqual(['nft list tables']);
    });

    it('reconcile re-creates missing table', async () => {
      await dnsModule.reconcileDnsRedirect(cfg, status('connected'));
      tables = tables.filter(t => !t.includes(TABLE));
      calls = [];
      await dnsModule.reconcileDnsRedirect(cfg, status('connected'));
      expect(applied()).toEqual([EXPECTED_WITH_DNS]);
    });

    it('applies the empty table on the first tick even when not connected', async () => {
      await dnsModule.reconcileDnsRedirect(cfg, status('disabled'));
      expect(applied()).toEqual([EXPECTED_EMPTY]);
    });

    it('follows a change of pushed DNS', async () => {
      await dnsModule.reconcileDnsRedirect(cfg, status('connected'));
      await dnsModule.reconcileDnsRedirect(cfg, status('connected', ['10.9.0.1']));
      expect(applied()[1]).toContain('dnat ip to 10.9.0.1');
    });

    it('connected without an IPv4 dns: applies the empty table and reports it', async () => {
      await dnsModule.reconcileDnsRedirect(cfg, status('connected'));
      await expect(dnsModule.reconcileDnsRedirect(cfg, status('connected', ['fd00::53'])))
        .rejects.toThrow(/no IPv4 DNS/);
      expect(applied()).toEqual([EXPECTED_WITH_DNS, EXPECTED_EMPTY]);
      await expect(dnsModule.reconcileDnsRedirect(cfg, status('connected', [])))
        .rejects.toThrow(/no IPv4 DNS/);
    });

    it('reports a failed nft apply and retries it on the next tick', async () => {
      applyResult = { stdout: '', stderr: 'Error: Could not process rule', exitCode: 1 };
      await expect(dnsModule.reconcileDnsRedirect(cfg, status('connected')))
        .rejects.toThrow(/Could not process rule/);
      applyResult = ok();
      await dnsModule.reconcileDnsRedirect(cfg, status('connected'));
      expect(applied()).toEqual([EXPECTED_WITH_DNS, EXPECTED_WITH_DNS]);
    });

    it('reports a failed nft listing without applying', async () => {
      await dnsModule.reconcileDnsRedirect(cfg, status('connected'));
      calls = [];
      exec.execute_argv.mockResolvedValue({ stdout: '', stderr: 'Operation not permitted', exitCode: 1 });
      await expect(dnsModule.reconcileDnsRedirect(cfg, status('connected')))
        .rejects.toThrow(/Operation not permitted/);
      expect(applied()).toEqual([]);
    });

    it('never invokes firewall-cmd', async () => {
      tables = [];
      for (const s of [status('connected'), status('error'), status('connected', []), status('disabled')]) {
        await dnsModule.reconcileDnsRedirect(cfg, s).catch(() => undefined);
      }
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every(c => c.file === 'nft')).toBe(true);
      expect(exec.execute_command).not.toHaveBeenCalled();
      expect(calls.some(c => [c.file, ...c.args, c.input ?? ''].join(' ').includes('firewall-cmd'))).toBe(false);
    });
  });
});
