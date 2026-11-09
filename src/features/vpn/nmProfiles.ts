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

export async function keyfileOf(uuid: string): Promise<string> {
  const file = (await nmcli(['-g', 'GENERAL.FILENAME', 'connection', 'show', 'uuid', uuid])).trim();
  if (!path.isAbsolute(file)) throw new Error(`NetworkManager reported no keyfile for ${uuid}: "${file}"`);
  return file;
}

export async function deleteUuid(uuid: string): Promise<void> {
  await nmcli(['connection', 'delete', 'uuid', uuid]);
}
