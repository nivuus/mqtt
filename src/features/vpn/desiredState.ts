/**
 * The owner's on/off choice for the guest VPN, persisted by the agent.
 *
 * NetworkManager never autoconnects a VPN profile and never re-activates one after OpenVPN
 * exits (bench, 2026-11-09), so this file, not NM, is the source of truth the supervisor
 * compares the live state against.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { writeFileAtomic0600 } from './atomicFile';

/** Reads the desired state; a missing file means the owner never enabled the VPN. */
export async function readDesiredEnabled(file: string): Promise<boolean> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
  const parsed: unknown = JSON.parse(text);
  const enabled = (parsed as { enabled?: unknown } | null)?.enabled;
  if (typeof enabled !== 'boolean') {
    throw new Error(`${file}: "enabled" must be a boolean`);
  }
  return enabled;
}

export async function writeDesiredEnabled(file: string, on: boolean): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFileAtomic0600(file, `${JSON.stringify({ enabled: on })}\n`);
}
