import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeFileAtomic0600 } from '../atomicFile';

describe('writeFileAtomic0600', () => {
  let dir: string;
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vpn-atomic-')); });
  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('replaces the file, 0600, and fsyncs the directory after the rename', async () => {
    const file = path.join(dir, 'f');
    await fs.writeFile(file, 'old', { mode: 0o644 });
    const opened: string[] = [];
    const realOpen = fs.open.bind(fs);
    jest.spyOn(fs, 'open').mockImplementation(((p: string, ...rest: unknown[]) => {
      opened.push(p);
      return (realOpen as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof fs.open);
    await writeFileAtomic0600(file, 'new');
    expect(await fs.readFile(file, 'utf8')).toBe('new');
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(opened[opened.length - 1]).toBe(dir);
    expect(await fs.readdir(dir)).toEqual(['f']);
  });

  it('removes the temp file (it may hold a secret) when the write fails', async () => {
    const file = path.join(dir, 'f');
    const realOpen = fs.open.bind(fs);
    jest.spyOn(fs, 'open').mockImplementationOnce((async (...args: unknown[]) => {
      const handle = await (realOpen as (...a: unknown[]) => Promise<fs.FileHandle>)(...args);
      handle.sync = async () => { throw new Error('EIO: fsync failed'); };
      return handle;
    }) as typeof fs.open);
    await expect(writeFileAtomic0600(file, 'secret')).rejects.toThrow(/fsync failed/);
    expect(await fs.readdir(dir)).toEqual([]);
  });
});
