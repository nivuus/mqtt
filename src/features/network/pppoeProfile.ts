/**
 * Writes new PPPoE credentials into the NetworkManager keyfile and applies them, checking
 * every step. The profile may be a fallback uplink kept down on purpose, so it is re-activated
 * only when it was active before the save: an inactive profile is never brought up.
 *
 * Secrets never reach a command line: the keyfile is written by the agent (root) itself, and
 * nmcli only ever receives the file path and the profile UUID.
 */
import { promises as fs } from 'fs';
import { writeFileAtomic0600 } from '../vpn/atomicFile';
import { isUuidActive } from '../vpn/nmProfiles';
import { nmcli } from '../vpn/nmcli';
import { readPppoeKeyfile, withPppoeCredentials } from './pppoeKeyfile';

/** Above nmcli's own 90 s activation wait, so nmcli reports the failure itself. */
const UP_TIMEOUT_MS = 100_000;

export type SaveOutcome =
  | { ok: true; restarted: boolean }
  | { ok: false; error: string };

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function profileUuid(keyfile: string): Promise<string> {
  const uuid = readPppoeKeyfile(await fs.readFile(keyfile, 'utf8')).uuid;
  if (!uuid) throw new Error(`no [connection] uuid in ${keyfile}`);
  return uuid;
}

/** The user name stored in the keyfile. Throws when the file cannot be read. */
export async function readStoredUsername(keyfile: string): Promise<string | undefined> {
  return readPppoeKeyfile(await fs.readFile(keyfile, 'utf8')).username;
}

/** Whether NetworkManager lists the keyfile's profile among active connections. Throws on failure. */
export async function isProfileActive(keyfile: string): Promise<boolean> {
  return isUuidActive(await profileUuid(keyfile));
}

/** Saves `username`, and `password` when given; an undefined password keeps the stored one. */
export async function saveCredentials(keyfile: string, username: string, password: string | undefined): Promise<SaveOutcome> {
  let uuid: string;
  let wasActive: boolean;
  try {
    const text = await fs.readFile(keyfile, 'utf8');
    uuid = readPppoeKeyfile(text).uuid ?? '';
    if (!uuid) return { ok: false, error: `no [connection] uuid in ${keyfile}` };
    const updated = withPppoeCredentials(text, username, password);
    // Asked before anything changes: if NM cannot answer, nothing is written.
    wasActive = await isUuidActive(uuid);
    await writeFileAtomic0600(keyfile, updated);
  } catch (err) {
    return { ok: false, error: `credentials not saved: ${messageOf(err)}` };
  }
  try {
    await nmcli(['connection', 'load', keyfile]);
  } catch (err) {
    return { ok: false, error: `credentials written but NetworkManager did not reload them: ${messageOf(err)}` };
  }
  if (!wasActive) return { ok: true, restarted: false };
  try {
    // `up` on an active profile re-activates it with the new secrets; no separate `down`,
    // which would leave the link down if the activation then failed.
    await nmcli(['connection', 'up', 'uuid', uuid], UP_TIMEOUT_MS);
  } catch (err) {
    return { ok: false, error: `credentials saved, but the re-activation failed: ${messageOf(err)}` };
  }
  return { ok: true, restarted: true };
}
