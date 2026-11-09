/**
 * Whether an activated guest tunnel really carries guest traffic. NM's "activated" is not
 * enough: after a long silent outage OpenVPN reconnects inside the same process, may reopen
 * `nvguest0`, and NM then loses table 200's routes while still reporting the VPN activated
 * (bench, docs/claude/guest-vpn-host-notes.md "Read this first" #3). Guests then leave through
 * the uplink, and a probe bound to the tun device still succeeds.
 *
 * Healthy means all three, checked in this order (read-only):
 * 1. `ip -j -4 route show table <table>` holds a default route via the tun, either as
 *    `default` or as OpenVPN's def1 pair `0.0.0.0/1` + `128.0.0.0/1` (both; one alone is not);
 * 2. `ip -j -4 rule show` holds `priority 100 iif <bridge> lookup <table>`;
 * 3. the first IPv4 DNS the tunnel pushed answers through the tun (dnsProbe.ts).
 */
import { isIPv4 } from 'net';
import { execute_argv } from '../../utils/exec';
import { probeDns } from './dnsProbe';
import { GuestVpnConfig } from './nmProfileSettings';

/** The rule NM installs for guest traffic (nmProfileSettings.ts, `ipv4.routing-rules`). */
export const GUEST_RULE_PRIORITY = 100;

type IpRoute = { dst?: string; dev?: string };
type IpRule = { priority?: number; iif?: string; table?: string | number };

/** Undefined when the tunnel is healthy; otherwise the first reason it is not. */
export async function checkTunnelHealth(cfg: GuestVpnConfig, dns: string[]): Promise<string | undefined> {
  const routes = await readIpJson<IpRoute>('route', ['-j', '-4', 'route', 'show', 'table', String(cfg.table)]);
  if (typeof routes === 'string') return routes;
  if (!hasDefaultVia(routes, cfg.device)) {
    return `no default route via ${cfg.device} in table ${cfg.table}`;
  }

  const rules = await readIpJson<IpRule>('rule', ['-j', '-4', 'rule', 'show']);
  if (typeof rules === 'string') return rules;
  const hasRule = rules.some(r => r.priority === GUEST_RULE_PRIORITY && r.iif === cfg.bridge
    && String(r.table) === String(cfg.table));
  if (!hasRule) return `no rule "priority ${GUEST_RULE_PRIORITY} iif ${cfg.bridge} lookup ${cfg.table}"`;

  const server = dns.find(entry => isIPv4(entry));
  if (server === undefined) {
    const pushed = dns.length ? `only ${dns.join(', ')}` : 'none';
    return `the tunnel pushed no IPv4 DNS (${pushed}): nothing to probe, and guest DNS cannot follow the tunnel`;
  }
  const probeError = await probeDns(cfg.device, server);
  return probeError === undefined ? undefined : `DNS probe failed: ${probeError}`;
}

/** The bench never captured table 200 while healthy: accept NM's `default` and the def1 pair. */
function hasDefaultVia(routes: IpRoute[], device: string): boolean {
  const via = new Set(routes.filter(r => r.dev === device).map(r => r.dst));
  return via.has('default') || (via.has('0.0.0.0/1') && via.has('128.0.0.0/1'));
}

/** The parsed JSON array, or the reason it could not be read. */
async function readIpJson<T>(what: string, args: string[]): Promise<T[] | string> {
  const result = await execute_argv('ip', args, { quiet: true });
  if (result.exitCode !== 0) return `ip ${what} failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`;
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (Array.isArray(parsed)) return parsed as T[];
  } catch {
    // Reported below with the same message as a non-array.
  }
  return `ip ${what} output is not valid JSON`;
}
