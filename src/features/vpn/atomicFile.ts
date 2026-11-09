/**
 * Atomic replacement of a small root-only file: write a 0600 sibling, fsync, rename over,
 * fsync the directory. A reader (NetworkManager, the agent after a crash or power loss) sees
 * the old file or the new one, never a truncated one. The temp file may hold a secret, so it
 * is removed on every failure path.
 */
import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import * as path from 'path';

export async function writeFileAtomic0600(file: string, content: string): Promise<void> {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  const handle = await fs.open(tmp, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  const dirHandle = await fs.open(dir, 'r');
  try {
    await dirHandle.sync();
  } finally {
    await dirHandle.close();
  }
}
