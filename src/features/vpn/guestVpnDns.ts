/**
 * Guest DNS through the tunnel: while the guest VPN is connected, every DNS query arriving on
 * the guest bridge (udp/tcp 53, whatever its destination) is DNATed to the first IPv4 DNS the
 * VPN pushed, and guest IPv6 DNS is rejected, so no guest name lookup leaves in clear on the
 * uplink. Otherwise the table is kept empty and guests use the router's resolver.
 *
 * The agent is the single owner of `inet nivuus_guest_vpn`. It is not firewalld's table, so a
 * firewalld reload or restart leaves it alone (measured on the bench, step 6 of
 * docs/claude/guest-vpn-host-notes.md), and nothing here calls firewall-cmd. The rule set is
 * the bench's (scripts/bench/90-nivuus-guest-vpn-dns.dispatcher), applied as one `nft -f`
 * transaction that replaces the whole table atomically.
 */
import { isIPv4 } from 'net';
import { execute_argv, execute_argv_input } from '../../utils/exec';
import { GuestVpnStatus } from './guestVpnStatus';
import { GuestVpnConfig } from './nmProfileSettings';

export const DNS_TABLE = 'nivuus_guest_vpn';

// Linux interface names: at most 15 bytes, no '/', no whitespace, no quotes.
const IFNAME = /^[A-Za-z0-9_.-]{1,15}$/;

export class GuestVpnDnsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuestVpnDnsError';
  }
}

/**
 * The full `nft -f` script for the table. `dns` null, or holding no IPv4 address, renders the
 * empty table: a DNAT target is only ever an address the tunnel pushed.
 */
export function renderDnsTable(bridge: string, dns: string[] | null): string {
  if (!IFNAME.test(bridge)) throw new GuestVpnDnsError(`"${bridge}" is not an interface name`);
  const target = firstIPv4(dns ?? []);
  // `table` first so that `delete` never fails on a missing table; all of it is one transaction.
  const head = `table inet ${DNS_TABLE}\ndelete table inet ${DNS_TABLE}\ntable inet ${DNS_TABLE} {\n`;
  if (target === undefined) return `${head}}\n`;
  const on = `iifname "${bridge}"`;
  const rejectIPv6Dns = [
    `    ${on} meta nfproto ipv6 udp dport 53 reject`,
    `    ${on} meta nfproto ipv6 tcp dport 53 reject with tcp reset`,
  ];
  return [
    head.trimEnd(),
    '  chain prerouting {',
    '    type nat hook prerouting priority dstnat - 10; policy accept;',
    `    ${on} meta nfproto ipv4 udp dport 53 dnat ip to ${target}`,
    `    ${on} meta nfproto ipv4 tcp dport 53 dnat ip to ${target}`,
    '  }',
    '  chain input {',
    '    type filter hook input priority filter - 10; policy accept;',
    ...rejectIPv6Dns,
    '  }',
    '  chain forward {',
    '    type filter hook forward priority filter - 10; policy accept;',
    ...rejectIPv6Dns,
    '  }',
    '}',
    '',
  ].join('\n');
}

// The script last applied successfully. A table found in place with this content needs no
// re-apply; it is forgotten on agent restart, which then re-applies once.
let applied: string | undefined;

/**
 * Brings the table in line with `status`; run on every tick and right after a switch or an
 * import. Throws a GuestVpnDnsError when nft fails, and when the tunnel is connected without
 * an IPv4 DNS (the empty table is applied first: guests then resolve through the router,
 * outside the tunnel, which the caller must surface).
 */
export async function reconcileDnsRedirect(cfg: GuestVpnConfig, status: GuestVpnStatus): Promise<void> {
  const connected = status.state === 'connected';
  const script = renderDnsTable(cfg.bridge, connected ? status.dns : null);

  if (!(applied === script && (await tablePresent()))) {
    const result = await execute_argv_input('nft', ['-f', '-'], script);
    if (result.exitCode !== 0) {
      applied = undefined;
      throw new GuestVpnDnsError(`nft could not apply table inet ${DNS_TABLE}: ${why(result)}`);
    }
    applied = script;
  }

  if (connected && firstIPv4(status.dns) === undefined) {
    const pushed = status.dns.length ? `only ${status.dns.join(', ')}` : 'none';
    throw new GuestVpnDnsError(`the tunnel pushed no IPv4 DNS (${pushed}); guest DNS is not routed into the tunnel`);
  }
}

async function tablePresent(): Promise<boolean> {
  const result = await execute_argv('nft', ['list', 'tables']);
  if (result.exitCode !== 0) throw new GuestVpnDnsError(`nft could not list tables: ${why(result)}`);
  return result.stdout.split('\n').some(line => line.trim() === `table inet ${DNS_TABLE}`);
}

function firstIPv4(dns: string[]): string | undefined {
  return dns.find(entry => isIPv4(entry));
}

function why(result: { stderr: string; exitCode: number | null }): string {
  return result.stderr.trim() || `exit code ${result.exitCode}`;
}
