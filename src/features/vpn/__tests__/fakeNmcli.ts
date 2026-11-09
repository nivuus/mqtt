/**
 * Test double for `execute_argv('nmcli', ...)`: records every call and keeps just enough
 * NetworkManager state for NmGuestVpn (profiles with their keyfiles, active ids, the tun
 * device in a fake /sys/class/net, NM's certificate copies). Nothing runs on the host.
 */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as execModule from '../../../utils/exec';
import { DEFAULT_GUEST_VPN_CONFIG, GuestVpnConfig, NmEnv } from '../nmGuestVpn';

export type Call = { file: string; args: string[] };
export type Result = { stdout: string; stderr: string; exitCode: number };
export type Staged = { file: string; content: string; fileMode: number; dirMode: number };

export const KEYFILE = '[connection]\nid=ID\n\n[vpn]\npassword-flags=1\n\n[ipv4]\nmethod=auto\n';

export const ok = (stdout = ''): Result => ({ stdout, stderr: '', exitCode: 0 });
export const fail = (stderr: string): Result => ({ stdout: '', stderr, exitCode: 4 });

export class FakeNm {
  calls: Call[] = [];
  /** id -> keyfile path */
  profiles = new Map<string, string>();
  active = new Set<string>();
  staged: Staged[] = [];
  override: ((args: string[]) => Result | undefined) | undefined;
  /** When false, `connection down` leaves the tun device in place. */
  downRemovesDevice = true;
  dir = '';
  cfg: GuestVpnConfig = DEFAULT_GUEST_VPN_CONFIG;
  env: NmEnv = { sysClassNet: '', certDir: '', sleep: async () => undefined, deviceGoneTimeoutMs: 1000, pollMs: 100 };

  async install(exec: jest.Mocked<typeof execModule>): Promise<void> {
    this.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nm-guest-vpn-'));
    for (const sub of ['system-connections', 'sys-class-net', 'certs']) await fs.mkdir(path.join(this.dir, sub));
    this.cfg = { ...DEFAULT_GUEST_VPN_CONFIG, stateFile: path.join(this.dir, 'guest-vpn.json') };
    this.env = { ...this.env, sysClassNet: path.join(this.dir, 'sys-class-net'), certDir: path.join(this.dir, 'certs') };
    exec.execute_argv.mockImplementation(async (file: string, args: string[]) => {
      this.calls.push({ file, args: [...args] });
      return this.answer(args);
    });
  }

  async remove(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
  }

  /** A profile as a previous import left it: keyfile, NM's CA copy, optionally active. */
  async addProfile(id: string, base: string, active = false): Promise<string> {
    const keyfile = path.join(this.dir, 'system-connections', `${base}.nmconnection`);
    await fs.writeFile(keyfile, KEYFILE.replace('ID', id), { mode: 0o600 });
    await fs.writeFile(path.join(this.env.certDir, `${base}-ca.pem`), 'old');
    this.profiles.set(id, keyfile);
    if (active) await this.activate(id);
    return keyfile;
  }

  device(): string {
    return path.join(this.env.sysClassNet, this.cfg.device);
  }

  async certs(): Promise<string[]> {
    return (await fs.readdir(this.env.certDir)).sort();
  }

  find(pred: (args: string[]) => boolean): Call[] {
    return this.calls.filter(c => pred(c.args));
  }

  verbs(): string[] {
    return this.calls.map(c => {
      const at = c.args.indexOf('connection');
      return c.args.slice(at, at + 2).join(' ');
    });
  }

  private async activate(id: string): Promise<void> {
    this.active.add(id);
    await fs.mkdir(this.device(), { recursive: true });
  }

  private async answer(args: string[]): Promise<Result> {
    const forced = this.override?.(args);
    if (forced) return forced;
    const at = args.indexOf('connection');
    const verb = args.slice(at, at + 2).join(' ');
    const id = args[args.indexOf('id') + 1];
    if (verb === 'connection import') return this.import(args[args.indexOf('file') + 1]);
    if (verb === 'connection show' && args.includes('--active')) {
      return ok([...this.active].map(a => `${a}:activated\n`).join(''));
    }
    if (verb === 'connection show' && args.includes('GENERAL.FILENAME')) {
      const keyfile = this.profiles.get(id);
      return keyfile ? ok(`${keyfile}\n`) : fail(`Error: ${id} - no such connection profile.`);
    }
    if (verb === 'connection show') return ok(['bridge-publicBridge', ...this.profiles.keys()].join('\n') + '\n');
    if (verb === 'connection delete') {
      const keyfile = this.profiles.get(id);
      if (!keyfile) return fail(`Error: unknown connection '${id}'.`);
      await fs.rm(keyfile, { force: true });
      this.profiles.delete(id);
      this.active.delete(id);
    }
    if (verb === 'connection modify' && args.includes('connection.id')) {
      this.profiles.set(args[args.indexOf('connection.id') + 1], this.profiles.get(id) as string);
      this.profiles.delete(id);
    }
    if (verb === 'connection up') {
      if (!this.profiles.has(id)) return fail(`Error: unknown connection '${id}'.`);
      await this.activate(id);
    }
    if (verb === 'connection down') {
      this.active.delete(id);
      if (this.downRemovesDevice) await fs.rm(this.device(), { recursive: true, force: true });
    }
    return ok();
  }

  private async import(file: string): Promise<Result> {
    const content = await fs.readFile(file, 'utf8');
    this.staged.push({
      file,
      content,
      fileMode: (await fs.stat(file)).mode & 0o777,
      dirMode: (await fs.stat(path.dirname(file))).mode & 0o777,
    });
    const base = path.basename(file, '.ovpn');
    const keyfile = path.join(this.dir, 'system-connections', `${base}.nmconnection`);
    await fs.writeFile(keyfile, KEYFILE.replace('ID', base), { mode: 0o600 });
    if (content.includes('<ca>')) await fs.writeFile(path.join(this.env.certDir, `${base}-ca.pem`), 'new');
    this.profiles.set(base, keyfile);
    return ok();
  }
}
