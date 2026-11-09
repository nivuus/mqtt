/**
 * Host-side helpers for replacing the live VPN profile without disturbing it.
 *
 * `nmcli connection import` names the profile, its keyfile and the certificate copies of
 * inline blocks (`<basename>-ca.pem`, `-tls-auth.pem`, in the importing user's
 * `~/.local/share/networkmanagement/certificates/nm-openvpn/`) after the file's basename.
 * A new upload is therefore staged under one of two basenames, the one the live profile does
 * not use, so it never overwrites certificate files the live profile still references.
 */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface NmEnv {
  /** Where kernel network devices appear (`/sys/class/net`). */
  sysClassNet: string;
  /** nm-openvpn's certificate store of the importing user (the agent: root). */
  certDir: string;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Bound on the wait for the tun device to go after `connection down`. */
  deviceGoneTimeoutMs: number;
  /** Bound on the wait for a VPN activation to succeed or fail (nmActivation.ts). */
  activationTimeoutMs: number;
  pollMs: number;
}

export function defaultNmEnv(): NmEnv {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return {
    sysClassNet: '/sys/class/net',
    certDir: path.join(dataHome, 'networkmanagement', 'certificates', 'nm-openvpn'),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    now: () => Date.now(),
    deviceGoneTimeoutMs: 15000,
    activationTimeoutMs: 90000,
    pollMs: 250,
  };
}

/** The two staging basenames. `_` keeps `<id>-` from being a prefix of them. */
export function stagingBasenames(connectionId: string): [string, string] {
  return [`${connectionId}_a`, `${connectionId}_b`];
}

export function pickStagingBasename(connectionId: string, liveBasename: string | undefined): string {
  const [a, b] = stagingBasenames(connectionId);
  return liveBasename === a ? b : a;
}

export function keyfileBasename(keyfile: string): string {
  return path.basename(keyfile, '.nmconnection');
}

/**
 * Deletes NM's certificate copies made for a basename (a replaced or a failed staging
 * profile; NM's `connection delete` leaves them). Only for a basename the agent chose
 * itself (the id, from older imports, or a staging name): a foreign basename could prefix
 * another profile's files.
 */
export async function removeCertFiles(certDir: string, connectionId: string, oldBasename: string): Promise<void> {
  if (![connectionId, ...stagingBasenames(connectionId)].includes(oldBasename)) return;
  let names: string[];
  try {
    names = await fs.readdir(certDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  const prefix = `${oldBasename}-`;
  for (const name of names) {
    if (name.startsWith(prefix) && name.endsWith('.pem')) await fs.rm(path.join(certDir, name), { force: true });
  }
}

async function deviceExists(env: NmEnv, device: string): Promise<boolean> {
  try {
    await fs.access(path.join(env.sysClassNet, device));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Precondition for activating the new profile: the old OpenVPN must have released the fixed
 * tun name, or the new one fails with `TUNSETIFF ... busy` (bench). Bounded; throws on
 * timeout.
 */
export async function waitForDeviceGone(env: NmEnv, device: string): Promise<void> {
  const polls = Math.ceil(env.deviceGoneTimeoutMs / env.pollMs);
  for (let i = 0; i < polls; i++) {
    if (!(await deviceExists(env, device))) return;
    await env.sleep(env.pollMs);
  }
  if (await deviceExists(env, device)) {
    throw new Error(`${device} still present ${env.deviceGoneTimeoutMs} ms after the VPN went down`);
  }
}
