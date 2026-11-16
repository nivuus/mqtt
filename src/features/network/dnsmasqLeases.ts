/**
 * DHCP leases of NetworkManager's shared-mode dnsmasq, one file per bridge:
 * `<dir>/dnsmasq-<bridge>.leases`. Each IPv4 lease is one line of five space-separated
 * fields: expiry (epoch seconds, 0 = infinite), MAC, IP, host name (`*` = none), client id.
 * A `duid ...` line (DHCPv6 server id) and IPv6 leases (no MAC field) are skipped.
 *
 * Host names are sent by the devices themselves, guests included: untrusted text, passed
 * through cleanHostname() before anything publishes them.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { Validators } from '../../utils/validators';

export const DEFAULT_DNSMASQ_LEASE_DIR = '/var/lib/NetworkManager';

export interface DnsmasqLease {
  mac: string;
  ip: string;
  hostname?: string;
  /** ISO 8601 expiry, undefined for an infinite lease. */
  expires?: string;
}

const MAC = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i;
/** C0/C1 controls and format characters (bidi overrides, zero-width, ...), in any script. */
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;
/** RFC 1035: a domain name is at most 253 octets in text form. */
const MAX_NAME_BYTES = 253;

/**
 * A host name fit to publish: invisible characters removed, at most 253 UTF-8 bytes (cut on a
 * code point), undefined when nothing is left. Letters of every script are kept.
 */
export function cleanHostname(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  let name = '';
  let bytes = 0;
  for (const ch of raw.replace(INVISIBLE, '').trim()) {
    bytes += Buffer.byteLength(ch, 'utf8');
    if (bytes > MAX_NAME_BYTES) break;
    name += ch;
  }
  return name === '' ? undefined : name;
}

export function parseDnsmasqLeases(text: string): DnsmasqLease[] {
  const leases: DnsmasqLease[] = [];
  for (const line of text.split('\n')) {
    const [expiry, mac, ip, name] = line.trim().split(/\s+/);
    if (!mac || !MAC.test(mac) || !ip || !Validators.isIPv4(ip)) continue;
    const seconds = Number(expiry);
    leases.push({
      mac: mac.toLowerCase(),
      ip,
      hostname: name === '*' ? undefined : cleanHostname(name),
      expires: Number.isInteger(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined,
    });
  }
  return leases;
}

/** The leases dnsmasq handed out on `bridge`; none when the bridge has no lease file. */
export async function readBridgeLeases(dir: string, bridge: string): Promise<DnsmasqLease[]> {
  // The bridge name becomes part of a path: it must stay one plain file-name component.
  if (bridge !== path.basename(bridge) || bridge.startsWith('.')) throw new Error(`invalid bridge name: ${bridge}`);
  try {
    return parseDnsmasqLeases(await fs.readFile(path.join(dir, `dnsmasq-${bridge}.leases`), 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}
