/**
 * What the guest VPN is doing right now, read from NetworkManager, plus the exit IP measured
 * through the tunnel.
 *
 * Read-only: one `nmcli` listing, one `nmcli connection show` of the live profile by UUID and,
 * only while connected, one `curl` bound to the tun device. The tun's `oif` rule exists only
 * while the VPN is up, so the exit IP is never measured otherwise (it would be the uplink's).
 */
import { isIP } from 'net';
import { execute_argv } from '../../utils/exec';
import { readDesiredEnabled } from './desiredState';
import { nmcli } from './nmcli';
import { GuestVpnConfig } from './nmProfileSettings';
import { uuidsNamed } from './nmProfiles';

export type GuestVpnState = 'connected' | 'connecting' | 'disabled' | 'no_config' | 'error';

export interface GuestVpnStatus {
  state: GuestVpnState;
  lastError?: string;
  remote?: string;
  dns: string[];
  exitIp?: string;
}

/** Answers with the caller's public IP as plain text. */
export const EXIT_IP_SERVICE = 'https://api.ipify.org';
const EXIT_IP_MAX_TIME_S = 10;
// curl's own --max-time fires first; this only bounds a curl that ignores it.
const EXIT_IP_KILL_MS = (EXIT_IP_MAX_TIME_S + 5) * 1000;

const SHOW_FIELDS = 'vpn.data,GENERAL.STATE,VPN.VPN-STATE,IP4.DNS';

// NMVpnConnectionState: 1 prepare, 2 need-auth, 3 connect, 4 ip-config-get, 5 activated, 6 failed.
const VPN_ACTIVATED = 5;
const VPN_FAILED = 6;
const isVpnConnecting = (s: number) => s >= 1 && s <= 4;

export async function readGuestVpnStatus(cfg: GuestVpnConfig, lastActivationError?: string): Promise<GuestVpnStatus> {
  const uuids = await uuidsNamed(cfg.connectionId);
  if (uuids.length === 0) return { state: 'no_config', dns: [] };
  if (uuids.length > 1) {
    return {
      state: 'error',
      lastError: `${uuids.length} profiles named ${cfg.connectionId}: ${uuids.join(', ')}; `
        + 'delete the extra ones in NetworkManager',
      dns: [],
    };
  }

  const fields = parseTerse(await nmcli(['-t', '-f', SHOW_FIELDS, 'connection', 'show', 'uuid', uuids[0]]));
  const remote = parseVpnData(fields.get('vpn.data')?.[0] ?? '').get('remote');
  const dns = fields.get('IP4.DNS') ?? [];
  const general = fields.get('GENERAL.STATE')?.[0];
  const vpnStateText = fields.get('VPN.VPN-STATE')?.[0];
  const vpnState = vpnStateText === undefined ? undefined : parseInt(vpnStateText, 10);
  const base = { ...(remote !== undefined && { remote }), dns };

  if (vpnState === VPN_FAILED) {
    return { state: 'error', lastError: lastActivationError ?? `NetworkManager reports ${vpnStateText}`, ...base };
  }
  // VPN-STATE 5 with GENERAL.STATE not (yet or any more) activated is a transition: it falls
  // through to the connecting / inactive checks below, never to `connected`.
  if (vpnState === VPN_ACTIVATED && general === 'activated') return connected(cfg, base);
  if (general === 'activating' || (vpnState !== undefined && isVpnConnecting(vpnState))) {
    return { state: 'connecting', ...(lastActivationError !== undefined && { lastError: lastActivationError }), ...base };
  }

  // Inactive, or on its way down: only the owner's choice tells "off" from "should be up".
  if (!(await readDesiredEnabled(cfg.stateFile))) return { state: 'disabled', ...base };
  return {
    state: 'error',
    lastError: lastActivationError ?? 'the tunnel is not active although enabled; guests use the uplink',
    ...base,
  };
}

async function connected(cfg: GuestVpnConfig, base: { remote?: string; dns: string[] }): Promise<GuestVpnStatus> {
  const result = await execute_argv('curl', [
    '--silent', '--show-error', '--fail',
    '--interface', cfg.device,
    '--max-time', String(EXIT_IP_MAX_TIME_S),
    EXIT_IP_SERVICE,
  ], { timeoutMs: EXIT_IP_KILL_MS });
  // `connected` means measured: an activated tunnel that carries no traffic (e.g. NM lost the
  // table routes after OpenVPN reopened the tun) leaves guests on the uplink, so it is an error.
  const noTraffic = `the tunnel is active but carries no traffic (no exit IP measured through ${cfg.device})`;
  if (result.exitCode !== 0) {
    const why = result.stderr.trim() || `curl exited with ${result.exitCode}`;
    return { state: 'error', lastError: `${noTraffic}: ${why}`, ...base };
  }
  const exitIp = result.stdout.trim();
  if (isIP(exitIp) === 0) {
    return { state: 'error', lastError: `${noTraffic}: ${EXIT_IP_SERVICE} returned no IP address`, ...base };
  }
  return { state: 'connected', ...base, exitIp };
}

/**
 * `nmcli -t` output as field → values, in order. Field names never contain ':'; values have
 * ':' and '\' backslash-escaped. Indexed fields (`IP4.DNS[1]`) are grouped under their name.
 */
function parseTerse(out: string): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  for (const line of out.split('\n')) {
    const at = line.indexOf(':');
    if (at < 0) continue;
    const name = line.slice(0, at).replace(/\[\d+\]$/, '');
    const values = fields.get(name) ?? [];
    values.push(unescape(line.slice(at + 1)));
    fields.set(name, values);
  }
  return fields;
}

/** `vpn.data` as printed by nmcli: `key = value, key = value`, with ',', '=' and '\' escaped. */
function parseVpnData(text: string): Map<string, string> {
  const data = new Map<string, string>();
  for (const item of splitUnescaped(text, ',')) {
    const [key, ...rest] = splitUnescaped(item, '=');
    if (rest.length === 0) continue;
    data.set(unescape(key.trim()), unescape(rest.join('=').trim()));
  }
  return data;
}

/** Splits on `sep` where it is not backslash-escaped; escapes are kept in the parts. */
function splitUnescaped(text: string, sep: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && i + 1 < text.length) {
      current += text[i] + text[++i];
    } else if (text[i] === sep) {
      parts.push(current);
      current = '';
    } else {
      current += text[i];
    }
  }
  parts.push(current);
  return parts;
}

function unescape(text: string): string {
  return text.replace(/\\(.)/g, '$1');
}
