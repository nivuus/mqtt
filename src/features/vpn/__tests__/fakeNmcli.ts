/**
 * Test double for `execute_argv('nmcli', ...)`: records every call and keeps just enough
 * NetworkManager state for NmGuestVpn (profiles by UUID with their id and keyfile, active
 * UUIDs, the tun device in a fake /sys/class/net, NM's certificate copies). Like NM, it
 * allows several profiles with the same id. Nothing runs on the host.
 */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as execModule from '../../../utils/exec';
import { DEFAULT_GUEST_VPN_CONFIG, GuestVpnConfig, NmEnv } from '../nmGuestVpn';

export type Call = { file: string; args: string[] };
export type Result = { stdout: string; stderr: string; exitCode: number; spawnError?: string };
export type Staged = { file: string; content: string; fileMode: number; dirMode: number };
type Profile = { id: string; keyfile: string };

export const KEYFILE = '[connection]\nid=ID\n\n[vpn]\npassword-flags=1\n\n[ipv4]\nmethod=auto\n';

export const ok = (stdout = ''): Result => ({ stdout, stderr: '', exitCode: 0 });
export const fail = (stderr: string): Result => ({ stdout: '', stderr, exitCode: 4 });

export class FakeNm {
  calls: Call[] = [];
  profiles = new Map<string, Profile>();
  active = new Set<string>();
  staged: Staged[] = [];
  override: ((args: string[]) => Result | undefined) | undefined;
  /** When false, `connection down` leaves the tun device in place. */
  downRemovesDevice = true;
  /**
   * What NM does after `connection up`, which (like nmcli 1.52 on the guest bridge) always
   * returns 0: the VPN activates, NM drops it (wrong password), or it stays activating.
   */
  upOutcome: 'activated' | 'dropped' | 'stuck' = 'activated';
  private activating = new Set<string>();
  dir = '';
  cfg: GuestVpnConfig = DEFAULT_GUEST_VPN_CONFIG;
  env: NmEnv = { sysClassNet: '', certDir: '', sleep: async () => undefined, deviceGoneTimeoutMs: 1000, pollMs: 100,
    activationTimeoutMs: 1000 };
  private serial = 0;

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
  async addProfile(id: string, base: string, active = false): Promise<{ uuid: string; keyfile: string }> {
    const uuid = this.newProfile(id, path.join(this.dir, 'system-connections', `${base}.nmconnection`));
    const keyfile = this.profiles.get(uuid)!.keyfile;
    await fs.writeFile(keyfile, KEYFILE.replace('ID', id), { mode: 0o600 });
    await fs.writeFile(path.join(this.env.certDir, `${base}-ca.pem`), 'old');
    if (active) await this.activate(uuid);
    return { uuid, keyfile };
  }

  ids(): string[] {
    return [...this.profiles.values()].map(p => p.id);
  }

  uuidsOf(id: string): string[] {
    return [...this.profiles].filter(([, p]) => p.id === id).map(([u]) => u);
  }

  keyfileBase(id: string): string {
    const [uuid] = this.uuidsOf(id);
    return path.basename(this.profiles.get(uuid)!.keyfile, '.nmconnection');
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

  private newProfile(id: string, keyfile: string): string {
    const uuid = `00000000-0000-4000-8000-${String(++this.serial).padStart(12, '0')}`;
    this.profiles.set(uuid, { id, keyfile });
    return uuid;
  }

  private async activate(uuid: string): Promise<void> {
    this.active.add(uuid);
    await fs.mkdir(this.device(), { recursive: true });
  }

  /** UUIDs addressed by `uuid <u>` or `id <name>` in argv. */
  private targets(args: string[]): string[] {
    const u = args.indexOf('uuid');
    if (u >= 0) return this.profiles.has(args[u + 1]) ? [args[u + 1]] : [];
    const i = args.indexOf('id');
    return i >= 0 ? this.uuidsOf(args[i + 1]) : [];
  }

  private async answer(args: string[]): Promise<Result> {
    const forced = this.override?.(args);
    if (forced) return forced;
    const at = args.indexOf('connection');
    const verb = args.slice(at, at + 2).join(' ');
    const targets = this.targets(args);
    if (verb === 'connection import') return this.import(args[args.indexOf('file') + 1]);
    if (verb === 'connection show' && args.includes('--active')) return ok([...this.active].map(u => `${u}\n`).join(''));
    if (verb === 'connection show' && args.includes('UUID,FILENAME')) {
      return ok([...this.profiles].map(([u, p]) => `${u}:${p.keyfile}\n`).join(''));
    }
    if (verb === 'connection show' && args.includes('GENERAL.STATE')) {
      if (!targets.length) return fail('Error: no such connection profile.');
      if (this.activating.has(targets[0])) return ok('GENERAL.STATE:activating\n');
      return ok(this.active.has(targets[0]) ? 'GENERAL.STATE:activated\n' : '');
    }
    if (verb === 'connection show') {
      const rows = [['bridge-publicBridge', 'ffffffff-0000-4000-8000-000000000000'],
        ...[...this.profiles].map(([u, p]) => [p.id, u])];
      return ok(rows.map(r => r.join(':')).join('\n') + '\n');
    }
    if (['connection delete', 'connection modify', 'connection up', 'connection down'].includes(verb) && !targets.length) {
      return fail('Error: unknown connection.');
    }
    if (verb === 'connection delete') {
      for (const u of targets) {
        await fs.rm(this.profiles.get(u)!.keyfile, { force: true });
        this.profiles.delete(u);
        this.active.delete(u);
      }
    }
    if (verb === 'connection modify' && args.includes('connection.id')) {
      this.profiles.get(targets[0])!.id = args[args.indexOf('connection.id') + 1];
    }
    if (verb === 'connection up' && this.upOutcome === 'activated') await this.activate(targets[0]);
    if (verb === 'connection up' && this.upOutcome === 'stuck') {
      this.active.add(targets[0]);
      this.activating.add(targets[0]);
    }
    if (verb === 'connection down') {
      this.active.delete(targets[0]);
      this.activating.delete(targets[0]);
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
    this.newProfile(base, keyfile);
    return ok();
  }
}
