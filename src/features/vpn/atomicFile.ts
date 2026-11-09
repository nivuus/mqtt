/**
 * Atomic replacement of a small root-only file: write a 0600 sibling, fsync, rename over.
 * A reader (NetworkManager, the agent after a crash) sees the old file or the new one, never
 * a truncated one.
 */
import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import * as path from 'path';

export async function writeFileAtomic0600(file: string, content: string): Promise<void> {
  const suffix = randomBytes(6).toString('hex');
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${suffix}.tmp`);
  const handle = await fs.open(tmp, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}
