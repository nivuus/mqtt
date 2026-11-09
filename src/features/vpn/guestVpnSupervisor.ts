/**
 * Keeps the guest VPN where the owner put it and reports what it really does.
 *
 * NM never re-activates a VPN profile by itself (bench, 2026-11-09), so every tick, while the
 * owner wants the VPN on and a profile exists that is not active, the supervisor runs one
 * `up()`. Every attempt is published (`connecting`, then the state NM reports with its error):
 * supervision, not a loop that hides failures. Ticks, switch commands and imports go through
 * one queue, and each ends by reconciling the DNS table and publishing a snapshot inside it.
 */
import logger from '../../utils/logger';
import { readDesiredEnabled, writeDesiredEnabled } from './desiredState';
import { reconcileDnsRedirect } from './guestVpnDns';
import { GuestVpnStatus, readGuestVpnStatus } from './guestVpnStatus';
import { GuestVpnConfig, ImportResult, NmGuestVpn, ProfileInput } from './nmGuestVpn';
import { SerialQueue } from './serialQueue';

export interface GuestVpnSnapshot {
  /** The owner's on/off choice; undefined when the file cannot be read. */
  desired?: boolean;
  status: GuestVpnStatus;
  /** The DNS table could not be applied, or guests resolve outside the tunnel. */
  dnsError?: string;
  /** A failed switch command, supervision step or on/off file read. */
  actionError?: string;
}

type Desired = { value?: boolean; error?: string };

const TAG = '[guest_vpn]';
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class GuestVpnSupervisor {
  private readonly queue = new SerialQueue();
  private switchError: string | undefined;
  private tickError: string | undefined;
  private last: GuestVpnSnapshot | undefined;

  constructor(
    private readonly cfg: GuestVpnConfig,
    private readonly nm: NmGuestVpn,
    private readonly publish: (snapshot: GuestVpnSnapshot) => Promise<void>,
  ) {}

  tick(): Promise<GuestVpnSnapshot> {
    return this.queue.run(async () => {
      const desired = await this.readDesired();
      this.tickError = undefined;
      if (desired.value) {
        try {
          if ((await this.nm.profileExists()) && !(await this.nm.isActive())) await this.activate();
        } catch (err) {
          this.tickError = `supervision failed: ${message(err)}`;
        }
      }
      return this.refresh(desired);
    });
  }

  switchTo(on: boolean): Promise<GuestVpnSnapshot> {
    return this.queue.run(async () => {
      try {
        await writeDesiredEnabled(this.cfg.stateFile, on);
        if (on) {
          if ((await this.nm.profileExists()) && !(await this.nm.isActive())) await this.activate();
        } else if (await this.nm.isActive()) {
          await this.nm.down();
        }
        this.switchError = undefined;
      } catch (err) {
        this.switchError = `switching ${on ? 'on' : 'off'} failed: ${message(err)}`;
      }
      return this.refresh();
    });
  }

  /** Imports through NmGuestVpn (which validates first) and returns the resulting status. */
  importProfile(input: ProfileInput): Promise<GuestVpnStatus> {
    return this.queue.run(async () => {
      let result: ImportResult;
      try {
        result = await this.nm.importProfile(input);
      } catch (err) {
        logger.error(`${TAG} profile import failed: ${message(err)}`);
        // A failure after the old tunnel went down changes the state: show it as it is.
        await this.refresh();
        throw err;
      }
      logger.info(`${TAG} profile imported, activation ${result.activation}`);
      return (await this.refresh()).status;
    });
  }

  idle(): Promise<void> {
    return this.queue.idle();
  }

  /** One `up()`; its failure is kept by NmGuestVpn and surfaces as the status' last error. */
  private async activate(): Promise<void> {
    const previous = this.last?.status;
    await this.publish({
      ...this.last,
      desired: true,
      status: {
        state: 'connecting',
        ...(this.nm.lastActivationError() !== undefined && { lastError: this.nm.lastActivationError() }),
        ...(previous?.remote !== undefined && { remote: previous.remote }),
        dns: [],
      },
    });
    try {
      await this.nm.up();
    } catch {
      // Recorded by up() (lastActivationError) and published by refresh(); retried next tick.
    }
  }

  private async readDesired(): Promise<Desired> {
    try {
      return { value: await readDesiredEnabled(this.cfg.stateFile) };
    } catch (err) {
      return { error: `reading the on/off state failed: ${message(err)}` };
    }
  }

  private async refresh(known?: Desired): Promise<GuestVpnSnapshot> {
    const desired = known ?? (await this.readDesired());
    let status: GuestVpnStatus;
    try {
      status = await readGuestVpnStatus(this.cfg, this.nm.lastActivationError());
    } catch (err) {
      status = { state: 'error', lastError: `reading the VPN state failed: ${message(err)}`, dns: [] };
    }
    let dnsError: string | undefined;
    try {
      await reconcileDnsRedirect(this.cfg, status);
    } catch (err) {
      dnsError = message(err);
    }
    const errors = [this.switchError, this.tickError, desired.error].filter((e): e is string => !!e);
    const snapshot: GuestVpnSnapshot = {
      ...(desired.value !== undefined && { desired: desired.value }),
      status,
      ...(dnsError !== undefined && { dnsError }),
      ...(errors.length > 0 && { actionError: errors.join('; ') }),
    };
    this.logChanges(snapshot);
    this.last = snapshot;
    await this.publish(snapshot);
    return snapshot;
  }

  /** Logs each new state or error once, not on every 15 s tick. */
  private logChanges(next: GuestVpnSnapshot): void {
    const prev = this.last;
    if (prev?.status.state !== next.status.state || prev.status.lastError !== next.status.lastError) {
      const why = next.status.lastError ? `: ${next.status.lastError}` : '';
      const line = `${TAG} state ${next.status.state}${why}`;
      if (next.status.state === 'error') logger.warn(line);
      else logger.info(line);
    }
    if (next.dnsError && next.dnsError !== prev?.dnsError) logger.error(`${TAG} DNS: ${next.dnsError}`);
    if (next.actionError && next.actionError !== prev?.actionError) logger.error(`${TAG} ${next.actionError}`);
  }
}
