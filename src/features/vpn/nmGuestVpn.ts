/**
 * The guest VPN's NetworkManager profile: import, activate, deactivate, query.
 *
 * Only `nmcli` is run, and only on the VPN profile: never firewall-cmd, never the bridge's
 * own profile. No secret is ever an argv element (`execute_argv` logs its argv): the
 * credentials go straight into the keyfile. Every nmcli failure throws with nmcli's stderr.
 */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execute_argv } from '../../utils/exec';
import { validateOvpnProfile } from './ovpnProfile';
import { readDesiredEnabled } from './desiredState';
import { writeVpnCredentials } from './nmSecrets';
import { GuestVpnConfig, inlineCa, profileSettingsArgs } from './nmProfileSettings';

export { DEFAULT_GUEST_VPN_CONFIG } from './nmProfileSettings';
export type { GuestVpnConfig } from './nmProfileSettings';

export interface ProfileInput {
  ovpn: string;
  ca?: string;
  username: string;
  password: string;
}

// nmcli's own activation wait is 90 s; leave it room to report its error.
const UP_TIMEOUT_MS = 120000;

export class NmcliError extends Error {
  constructor(readonly action: string, readonly stderr: string) {
    super(`nmcli ${action} failed: ${stderr || 'no error output'}`);
    this.name = 'NmcliError';
  }
}

async function nmcli(args: string[], timeoutMs?: number): Promise<string> {
  const result = await execute_argv('nmcli', args, timeoutMs ? { timeoutMs } : {});
  if (result.exitCode !== 0) {
    const verb = args.indexOf('connection');
    throw new NmcliError(args.slice(verb, verb + 2).join(' '), result.stderr.trim());
  }
  return result.stdout;
}

/** Writes the profile, 0600, into a fresh 0700 directory that is removed afterwards. */
async function withStagedFile<T>(name: string, content: string, fn: (file: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nivuus-guest-vpn-'));
  try {
    const file = path.join(dir, name);
    await fs.writeFile(file, content, { mode: 0o600, flag: 'wx' });
    return await fn(file);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export class NmGuestVpn {
  private lastError: string | undefined;

  constructor(private readonly cfg: GuestVpnConfig) {}

  /**
   * Replaces the profile with the uploaded one. A profile that fails half-way is deleted
   * (it would lack the routing settings) and the error rethrown. The new profile is
   * activated only when the owner has the VPN enabled.
   */
  async importProfile(input: ProfileInput): Promise<void> {
    const validation = validateOvpnProfile(input.ovpn, input.ca);
    if (!validation.ok) throw new Error(`invalid OpenVPN profile: ${validation.reason}`);
    if (!input.username || !input.password) throw new Error('username and password are required');
    const profile = validation.needsCa ? inlineCa(validation.normalized, input.ca as string) : validation.normalized;

    if (await this.profileExists()) await this.deleteProfile();
    // nmcli names the imported profile and its keyfile after the file's basename.
    await withStagedFile(`${this.cfg.connectionId}.ovpn`, profile,
      file => nmcli(['connection', 'import', 'type', 'openvpn', 'file', file]));

    try {
      await nmcli(['connection', 'modify', ...this.idArgs(), ...profileSettingsArgs(this.cfg)]);
      const keyfile = await this.keyfilePath();
      await writeVpnCredentials(keyfile, { username: input.username, password: input.password });
      await nmcli(['connection', 'load', keyfile]);
    } catch (err) {
      await this.deleteProfile().catch((cleanup: Error) => {
        throw new Error(`${(err as Error).message}; removing the incomplete profile also failed: ${cleanup.message}`);
      });
      throw err;
    }

    if (await readDesiredEnabled(this.cfg.stateFile)) await this.up();
  }

  /** Activates the VPN on the guest bridge (the WAN is not NM-managed, so NM needs a base). */
  async up(): Promise<void> {
    try {
      await nmcli(['connection', 'up', ...this.idArgs(), 'ifname', this.cfg.bridge], UP_TIMEOUT_MS);
      this.lastError = undefined;
    } catch (err) {
      this.lastError = err instanceof NmcliError ? err.stderr : (err as Error).message;
      throw err;
    }
  }

  async down(): Promise<void> {
    await nmcli(['connection', 'down', ...this.idArgs()]);
  }

  /** True while NM lists the profile among active connections (activating or activated). */
  async isActive(): Promise<boolean> {
    const out = await nmcli(['-g', 'NAME,STATE', 'connection', 'show', '--active']);
    return out.split('\n').some(line => line.split(':')[0] === this.cfg.connectionId);
  }

  async profileExists(): Promise<boolean> {
    const out = await nmcli(['-g', 'NAME', 'connection', 'show']);
    return out.split('\n').some(line => line === this.cfg.connectionId);
  }

  /** nmcli's stderr from the last failed `up`, cleared by a successful one. */
  lastActivationError(): string | undefined {
    return this.lastError;
  }

  private idArgs(): string[] {
    return ['id', this.cfg.connectionId];
  }

  private async deleteProfile(): Promise<void> {
    await nmcli(['connection', 'delete', ...this.idArgs()]);
  }

  private async keyfilePath(): Promise<string> {
    const file = (await nmcli(['-g', 'GENERAL.FILENAME', 'connection', 'show', ...this.idArgs()])).trim();
    if (!path.isAbsolute(file)) {
      throw new Error(`NetworkManager reported no keyfile for ${this.cfg.connectionId}: "${file}"`);
    }
    return file;
  }
}
