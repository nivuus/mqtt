/**
 * NetworkManager profile lookups by UUID. Ids are not unique in NM (during a replace two
 * profiles briefly share the live id), so every call that changes a profile addresses it by
 * UUID.
 */
import * as path from 'path';
import { nmcli } from './nmcli';

/** UUIDs of every profile whose id is `name`, in NM's listing order. */
export async function uuidsNamed(name: string): Promise<string[]> {
  const out = await nmcli(['-g', 'NAME,UUID', 'connection', 'show']);
  return out.split('\n').filter(Boolean).flatMap(line => {
    // -g escapes ':' inside the name, so the last ':' separates the UUID.
    const at = line.lastIndexOf(':');
    return line.slice(0, at) === name ? [line.slice(at + 1)] : [];
  });
}

export async function isUuidActive(uuid: string): Promise<boolean> {
  const out = await nmcli(['-g', 'UUID', 'connection', 'show', '--active']);
  return out.split('\n').includes(uuid);
}

/**
 * The keyfile NM keeps the profile in, read from the list form: on one profile,
 * `-g GENERAL.FILENAME` prints nothing while it is inactive and is an invalid field while it
 * is active (nmcli 1.52, bench captures `*.nmcli-filename`).
 */
export async function keyfileOf(uuid: string): Promise<string> {
  const out = await nmcli(['-g', 'UUID,FILENAME', 'connection', 'show']);
  // A UUID holds no ':', so the first one ends it; -g escapes ':' and '\' in the path.
  const row = out.split('\n').find(line => line.slice(0, line.indexOf(':')) === uuid);
  const file = row === undefined ? '' : row.slice(row.indexOf(':') + 1).replace(/\\(.)/g, '$1');
  if (!path.isAbsolute(file)) throw new Error(`NetworkManager reported no keyfile for ${uuid}: "${file}"`);
  return file;
}

/**
 * NM's activation state of the profile (`activating`, `activated`, `deactivating`), or
 * undefined when it is not active. For a VPN, NM derives it from the VPN's own state
 * (nm-vpn-connection.c, `_state_to_ac_state`): prepare to ip-config-get are `activating`.
 */
export async function activationStateOf(uuid: string, timeoutMs?: number): Promise<string | undefined> {
  const out = await nmcli(['-t', '-f', 'GENERAL.STATE', 'connection', 'show', 'uuid', uuid], timeoutMs);
  const line = out.split('\n').find(l => l.startsWith('GENERAL.STATE:'));
  return line?.slice('GENERAL.STATE:'.length);
}

export async function deleteUuid(uuid: string): Promise<void> {
  await nmcli(['connection', 'delete', 'uuid', uuid]);
}
