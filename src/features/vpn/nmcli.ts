/**
 * Thin nmcli runner: argv only (no shell), every non-zero exit throws with nmcli's stderr.
 * `execute_argv` logs its argv, so callers never pass a secret.
 */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execute_argv } from '../../utils/exec';

export class NmcliError extends Error {
  constructor(readonly action: string, readonly stderr: string) {
    super(`nmcli ${action} failed: ${stderr || 'no error output'}`);
    this.name = 'NmcliError';
  }
}

export async function nmcli(args: string[], timeoutMs?: number): Promise<string> {
  const verb = args.indexOf('connection');
  // `connection show` only reads, and the supervisor runs it on every tick: logged at debug.
  const quiet = verb >= 0 && args[verb + 1] === 'show';
  const result = await execute_argv('nmcli', args, { ...(timeoutMs && { timeoutMs }), quiet });
  if (result.exitCode !== 0) {
    throw new NmcliError(args.slice(verb, verb + 2).join(' '), result.stderr.trim());
  }
  return result.stdout;
}

/** Writes `content`, 0600, as `name` in a fresh 0700 directory that is removed afterwards. */
export async function withStagedFile<T>(name: string, content: string, fn: (file: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nivuus-guest-vpn-'));
  try {
    const file = path.join(dir, name);
    await fs.writeFile(file, content, { mode: 0o600, flag: 'wx' });
    return await fn(file);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
