/**
 * The guest VPN's NetworkManager profile: import, activate, deactivate, query.
 *
 * Only `nmcli` is run, and only on the VPN profiles: never firewall-cmd, never the bridge's
 * own profile. Profiles are changed by UUID, never by id. No secret is ever an argv element
 * (`execute_argv` logs its argv): the credentials go straight into the keyfile. Every nmcli
 * failure throws with nmcli's stderr.
 */
import { readDesiredEnabled } from './desiredState';
import { nmcli, NmcliError, withStagedFile } from './nmcli';
import { writeVpnCredentials } from './nmSecrets';
import { GuestVpnConfig, profileSettingsArgs } from './nmProfileSettings';
import { deleteUuid, isUuidActive, keyfileOf, uuidsNamed } from './nmProfiles';
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
  private duplicate: string | undefined;
  /** UUID of the profile this instance last swapped in: the live one if the id is shared. */
  private stagedUuid: string | undefined;
  private readonly env: NmEnv;

  constructor(private readonly cfg: GuestVpnConfig, env: Partial<NmEnv> = {}) {
    this.env = { ...defaultNmEnv(), ...env };
  }

  /**
   * Builds the upload completely under a staging name, renames it to the live id, and only
   * then deletes the replaced profile by UUID. Any failure up to the rename discards the
   * staging profile alone: the live profile, its keyfile and its certificates are untouched.
   */
  async importProfile(input: ProfileInput): Promise<ImportResult> {
    const profile = prepareProfileText(input.ovpn, input.ca);
    if (!input.username || !input.password) throw new Error('username and password are required');

    const id = this.cfg.connectionId;
    const liveUuid = await this.liveUuid();
    const liveBase = liveUuid ? keyfileBasename(await keyfileOf(liveUuid)) : undefined;
    const staging = pickStagingBasename(id, liveBase);
    // Leftovers of an interrupted import would make the name ambiguous or linger as stale certs.
    await this.discardStaging(staging);

    let fresh: string;
    try {
      await withStagedFile(`${staging}.ovpn`, profile,
        file => nmcli(['connection', 'import', 'type', 'openvpn', 'file', file]));
      fresh = await this.onlyUuidNamed(staging);
      await nmcli(['connection', 'modify', 'uuid', fresh, ...profileSettingsArgs(this.cfg)]);
      const keyfile = await keyfileOf(fresh);
      await writeVpnCredentials(keyfile, { username: input.username, password: input.password });
      await nmcli(['connection', 'load', keyfile]);
      if (liveUuid && (await isUuidActive(liveUuid))) {
        await nmcli(['connection', 'down', 'uuid', liveUuid]);
        await waitForDeviceGone(this.env, this.cfg.device);
      }
      await nmcli(['connection', 'modify', 'uuid', fresh, 'connection.id', id]);
    } catch (err) {
      await this.discardStaging(staging).catch((cleanup: Error) => {
        throw new Error(`${(err as Error).message}; removing the staging profile also failed: ${cleanup.message}`);
      });
      throw err;
    }
    this.stagedUuid = fresh;

    if (liveUuid && liveBase !== undefined) {
      try {
        await deleteUuid(liveUuid);
      } catch (err) {
        throw new Error(`profile ${fresh} is now live, but deleting the replaced profile ${liveUuid} `
          + `failed: ${(err as Error).message}`);
      }
      await removeCertFiles(this.env.certDir, id, liveBase);
    }

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
      const uuid = await this.requireLiveUuid();
      await nmcli(['connection', 'up', 'uuid', uuid, 'ifname', this.cfg.bridge], UP_TIMEOUT_MS);
      this.lastError = undefined;
    } catch (err) {
      this.lastError = err instanceof NmcliError ? err.stderr : (err as Error).message;
      throw err;
    }
  }

  async down(): Promise<void> {
    await nmcli(['connection', 'down', 'uuid', await this.requireLiveUuid()]);
  }

  /** True while NM lists the live profile among active connections (activating or activated). */
  async isActive(): Promise<boolean> {
    const uuid = await this.liveUuid();
    return uuid !== undefined && isUuidActive(uuid);
  }

  async profileExists(): Promise<boolean> {
    return (await uuidsNamed(this.cfg.connectionId)).length > 0;
  }

  /** nmcli's stderr from the last failed `up`, cleared by a successful one. */
  lastActivationError(): string | undefined {
    return this.lastError;
  }

  /** Set while several profiles carry the live id; cleared once only one does. */
  duplicateProfileError(): string | undefined {
    return this.duplicate;
  }

  /**
   * The live profile's UUID. With several profiles named after the live id, it is the one
   * this instance swapped in, and the duplicate is reported; without that knowledge it
   * throws rather than guess.
   */
  private async liveUuid(): Promise<string | undefined> {
    const uuids = await uuidsNamed(this.cfg.connectionId);
    if (uuids.length <= 1) {
      this.duplicate = undefined;
      return uuids[0];
    }
    this.duplicate = `${uuids.length} profiles named ${this.cfg.connectionId}: ${uuids.join(', ')}`;
    if (this.stagedUuid && uuids.includes(this.stagedUuid)) return this.stagedUuid;
    throw new Error(`${this.duplicate}; refusing to guess which one is live`);
  }

  private async requireLiveUuid(): Promise<string> {
    const uuid = await this.liveUuid();
    if (!uuid) throw new Error(`no ${this.cfg.connectionId} profile`);
    return uuid;
  }

  private async onlyUuidNamed(name: string): Promise<string> {
    const uuids = await uuidsNamed(name);
    if (uuids.length !== 1) throw new Error(`expected one imported profile named ${name}, found ${uuids.length}`);
    return uuids[0];
  }

  /** Removes every profile named `staging` and NM's certificate copies made for it. */
  private async discardStaging(staging: string): Promise<void> {
    for (const uuid of await uuidsNamed(staging)) await deleteUuid(uuid);
    await removeCertFiles(this.env.certDir, this.cfg.connectionId, staging);
  }
}
