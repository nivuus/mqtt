/**
 * Test double for `execute_argv('nmcli', ...)`: records every call and keeps just enough
 * NetworkManager state (profile present, active) for NmGuestVpn. Nothing runs on the host.
 */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as execModule from '../../../utils/exec';
import { DEFAULT_GUEST_VPN_CONFIG, GuestVpnConfig } from '../nmGuestVpn';

export type Call = { file: string; args: string[] };
export type Result = { stdout: string; stderr: string; exitCode: number };
export type Staged = { file: string; content: string; fileMode: number; dirMode: number };

export const KEYFILE = '[connection]\nid=nivuus-guest-vpn\n\n[vpn]\npassword-flags=1\n\n[ipv4]\nmethod=auto\n';

export const ok = (stdout = ''): Result => ({ stdout, stderr: '', exitCode: 0 });
export const fail = (stderr: string): Result => ({ stdout: '', stderr, exitCode: 4 });

export class FakeNm {
  calls: Call[] = [];
  exists = false;
  active = false;
  staged: Staged | undefined;
  override: ((args: string[]) => Result | undefined) | undefined;
  dir = '';
  keyfile = '';
  cfg: GuestVpnConfig = DEFAULT_GUEST_VPN_CONFIG;

  /** Creates the temp dir and keyfile fixture and routes the mocked execute_argv here. */
  async install(exec: jest.Mocked<typeof execModule>): Promise<void> {
    this.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nm-guest-vpn-'));
    this.keyfile = path.join(this.dir, 'nivuus-guest-vpn.nmconnection');
    await fs.writeFile(this.keyfile, KEYFILE, { mode: 0o600 });
    this.cfg = { ...DEFAULT_GUEST_VPN_CONFIG, stateFile: path.join(this.dir, 'guest-vpn.json') };
    exec.execute_argv.mockImplementation(async (file: string, args: string[]) => {
      this.calls.push({ file, args: [...args] });
      if (args[0] === 'connection' && args[1] === 'import') await this.stage(args[args.indexOf('file') + 1]);
      return this.answer(args);
    });
  }

  async remove(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
  }

  find(pred: (args: string[]) => boolean): Call[] {
    return this.calls.filter(c => pred(c.args));
  }

  verbs(): string[] {
    return this.calls.map(c => c.args.slice(0, 2).join(' '));
  }

  private async stage(file: string): Promise<void> {
    this.staged = {
      file,
      content: await fs.readFile(file, 'utf8'),
      fileMode: (await fs.stat(file)).mode & 0o777,
      dirMode: (await fs.stat(path.dirname(file))).mode & 0o777,
    };
    this.exists = true;
  }

  private answer(args: string[]): Result {
    const forced = this.override?.(args);
    if (forced) return forced;
    const at = args.indexOf('connection');
    const verb = args.slice(at, at + 2).join(' ');
    const id = this.cfg.connectionId;
    if (verb === 'connection show' && args.includes('--active')) return ok(this.active ? `${id}:activated\n` : '');
    if (verb === 'connection show' && args.includes('GENERAL.FILENAME')) return ok(`${this.keyfile}\n`);
    if (verb === 'connection show') return ok(this.exists ? `bridge-publicBridge\n${id}\n` : 'bridge-publicBridge\n');
    if (verb === 'connection delete') { this.exists = false; this.active = false; }
    if (verb === 'connection up') this.active = true;
    if (verb === 'connection down') this.active = false;
    return ok();
  }
}
