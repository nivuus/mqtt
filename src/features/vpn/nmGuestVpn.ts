/**
 * The guest VPN's NetworkManager profile: import, activate, deactivate, query.
 *
 * Only `nmcli` is run, and only on the VPN profiles: never firewall-cmd, never the bridge's
 * own profile. No secret is ever an argv element (`execute_argv` logs its argv): the
 * credentials go straight into the keyfile. Every nmcli failure throws with nmcli's stderr.
 */
import * as path from 'path';
import { readDesiredEnabled } from './desiredState';
import { nmcli, NmcliError, withStagedFile } from './nmcli';
import { writeVpnCredentials } from './nmSecrets';
import { GuestVpnConfig, profileSettingsArgs } from './nmProfileSettings';
import {
  NmEnv, defaultNmEnv, keyfileBasename, pickStagingBasename, removeCertFiles, waitForDeviceGone,
} from './nmStaging';
import { prepareProfileText } from './profileText';

export { DEFAULT_GUEST_VPN_CONFIG } from './nmProfileSettings';
export type { GuestVpnConfig } from './nmProfileSettings';
export type { NmEnv } from './nmStaging';
export { NmcliError } from './nmcli';

export interface ProfileInput {
  ovpn: string;
  ca?: string;
  username: string;
  password: string;
}

/**
 * Outcome of a successful import. The profile is in place in every case; activation is a
 * separate result so that "upload failed" is never shown for a profile that was replaced.
 */
export type ImportResult =
  | { activation: 'skipped' }
  | { activation: 'activated' }
  | { activation: 'failed'; error: string };

// nmcli's own activation wait is 90 s; leave it room to report its error.
const UP_TIMEOUT_MS = 120000;

export class NmGuestVpn {
  private lastError: string | undefined;
  private readonly env: NmEnv;

  constructor(private readonly cfg: GuestVpnConfig, env: Partial<NmEnv> = {}) {
    this.env = { ...defaultNmEnv(), ...env };
  }

  /**
   * Builds the uploaded profile completely under a staging name, and only then swaps it in
   * for the live one. Any failure before the swap deletes the staging profile alone and
   * rethrows: the live profile, its keyfile and its certificates are untouched.
   */
  async importProfile(input: ProfileInput): Promise<ImportResult> {
    const profile = prepareProfileText(input.ovpn, input.ca);
    if (!input.username || !input.password) throw new Error('username and password are required');

    const id = this.cfg.connectionId;
    const liveBase = (await this.profileExists()) ? keyfileBasename(await this.keyfilePath(id)) : undefined;
    const staging = pickStagingBasename(id, liveBase);
    // Leftovers of an interrupted import would make the id ambiguous or linger as stale certs.
    await this.discardStaging(staging);

    try {
      await withStagedFile(`${staging}.ovpn`, profile,
        file => nmcli(['connection', 'import', 'type', 'openvpn', 'file', file]));
      await nmcli(['connection', 'modify', 'id', staging, ...profileSettingsArgs(this.cfg)]);
      const keyfile = await this.keyfilePath(staging);
      await writeVpnCredentials(keyfile, { username: input.username, password: input.password });
      await nmcli(['connection', 'load', keyfile]);
      if (liveBase !== undefined && (await this.isActive())) {
        await this.down();
        await waitForDeviceGone(this.env, this.cfg.device);
      }
    } catch (err) {
      await this.discardStaging(staging).catch((cleanup: Error) => {
        throw new Error(`${(err as Error).message}; removing the staging profile also failed: ${cleanup.message}`);
      });
      throw err;
    }

    if (liveBase !== undefined) await this.deleteProfile(id);
    await nmcli(['connection', 'modify', 'id', staging, 'connection.id', id]);
    if (liveBase !== undefined) await removeCertFiles(this.env.certDir, id, liveBase);

    if (!(await readDesiredEnabled(this.cfg.stateFile))) return { activation: 'skipped' };
    try {
      await this.up();
      return { activation: 'activated' };
    } catch {
      // Recorded by up(); the import itself succeeded and the supervisor retries.
      return { activation: 'failed', error: this.lastError as string };
    }
  }

  /** Activates the VPN on the guest bridge (the WAN is not NM-managed, so NM needs a base). */
  async up(): Promise<void> {
    try {
      await nmcli(['connection', 'up', 'id', this.cfg.connectionId, 'ifname', this.cfg.bridge], UP_TIMEOUT_MS);
      this.lastError = undefined;
    } catch (err) {
      this.lastError = err instanceof NmcliError ? err.stderr : (err as Error).message;
      throw err;
    }
  }

  async down(): Promise<void> {
    await nmcli(['connection', 'down', 'id', this.cfg.connectionId]);
  }

  /** True while NM lists the profile among active connections (activating or activated). */
  async isActive(): Promise<boolean> {
    const out = await nmcli(['-g', 'NAME,STATE', 'connection', 'show', '--active']);
    return out.split('\n').some(line => line.split(':')[0] === this.cfg.connectionId);
  }

  async profileExists(): Promise<boolean> {
    return this.hasProfile(this.cfg.connectionId);
  }

  /** nmcli's stderr from the last failed `up`, cleared by a successful one. */
  lastActivationError(): string | undefined {
    return this.lastError;
  }

  private async hasProfile(id: string): Promise<boolean> {
    const out = await nmcli(['-g', 'NAME', 'connection', 'show']);
    return out.split('\n').some(line => line === id);
  }

  private async deleteProfile(id: string): Promise<void> {
    await nmcli(['connection', 'delete', 'id', id]);
  }

  /** Removes a staging profile, if any, and NM's certificate copies made for it. */
  private async discardStaging(staging: string): Promise<void> {
    if (await this.hasProfile(staging)) await this.deleteProfile(staging);
    await removeCertFiles(this.env.certDir, this.cfg.connectionId, staging);
  }

  private async keyfilePath(id: string): Promise<string> {
    const file = (await nmcli(['-g', 'GENERAL.FILENAME', 'connection', 'show', 'id', id])).trim();
    if (!path.isAbsolute(file)) throw new Error(`NetworkManager reported no keyfile for ${id}: "${file}"`);
    return file;
  }
}
