/**
 * Keeps the guest VPN where the owner put it and reports what it really does.
 *
 * NM never re-activates a VPN profile by itself (bench, 2026-11-09), so every tick, while the
 * owner wants the VPN on and the profile is not active, the supervisor runs one `up()` (spaced
 * by RetryBackoff after failures), and while the owner wants it off and it is active, one
 * `down()`. An activated tunnel that fails its health checks (tunnelHealth.ts) on two ticks in
 * a row is taken down, so guests fall back to the uplink and the next due tick brings it up
 * again. Every attempt is published. Ticks, switch commands and imports share one queue, and
 * each ends by reconciling the DNS table and publishing a snapshot inside it.
 */
import logger from '../../utils/logger';
import { readDesiredEnabled, writeDesiredEnabled } from './desiredState';
import { clearDnsRedirect, reconcileDnsRedirect } from './guestVpnDns';
import { GuestVpnStatus, readGuestVpnStatus } from './guestVpnStatus';
import { GuestVpnConfig, ImportResult, NmGuestVpn, ProfileInput } from './nmGuestVpn';
import { prepareProfileText } from './profileText';
import { SerialQueue } from './serialQueue';
import { GuestVpnSnapshot, logSnapshotChanges, TAG } from './guestVpnSnapshot';
import { TunnelRecovery, UNHEALTHY_TICKS_BEFORE_RESTART } from './tunnelRecovery';

export type { GuestVpnSnapshot } from './guestVpnSnapshot';

type Desired = { value?: boolean; error?: string };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class GuestVpnSupervisor {
  private readonly queue = new SerialQueue();
  private readonly recovery = new TunnelRecovery();
  private switchError: string | undefined;
  private writeError: string | undefined;
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
      if (desired.value !== undefined) {
        try {
          // A switch command that failed is moot once the tunnel matches the owner's choice.
          if (await this.converge(desired.value)) this.switchError = undefined;
        } catch (err) {
          this.tickError = `supervision failed: ${message(err)}`;
        }
      }
      const snapshot = await this.refresh(desired);
      if (desired.value !== true || !this.recovery.observeTick(snapshot.status, Date.now())) return snapshot;
      logger.warn(`${TAG} restarting the tunnel, unhealthy on ${UNHEALTHY_TICKS_BEFORE_RESTART} ticks: `
        + `${snapshot.status.tunnelFault}`);
      try {
        await this.nm.down();
      } catch (err) {
        this.tickError = `restarting the unhealthy tunnel failed: ${message(err)}`;
      }
      return this.refresh(desired);
    });
  }

  switchTo(on: boolean): Promise<GuestVpnSnapshot> {
    return this.queue.run(async () => {
      try {
        await writeDesiredEnabled(this.cfg.stateFile, on);
        this.writeError = undefined;
      } catch (err) {
        // Kept until a later write succeeds: no tick can tell it is moot.
        this.writeError = `saving the switch choice ${on ? 'ON' : 'OFF'} failed: ${message(err)}`;
        return this.refresh();
      }
      this.recovery.startOver();
      try {
        await this.converge(on);
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
        // Validated before anything is announced: a rejected upload never shows `connecting`.
        prepareProfileText(input.ovpn, input.ca);
        this.recovery.startOver();
        if ((await this.readDesired()).value) await this.announceConnecting();
        result = await this.nm.importProfile(input, () => clearDnsRedirect(this.cfg));
      } catch (err) {
        logger.error(`${TAG} profile import failed: ${message(err)}`);
        // A failure after the old tunnel went down changes the state: show it as it is.
        await this.refresh().catch(refreshErr =>
          logger.error(`${TAG} publishing the state after the failed import failed: ${message(refreshErr)}`));
        throw err;
      }
      logger.info(`${TAG} profile imported, activation ${result.activation}`);
      return (await this.refresh()).status;
    });
  }

  /** The status of the last supervision pass; runs a pass only if none has happened yet. */
  async currentStatus(): Promise<GuestVpnStatus> {
    return this.last?.status ?? (await this.tick()).status;
  }

  idle(): Promise<void> {
    return this.queue.idle();
  }

  /**
   * Brings the tunnel to the owner's choice: one `up()` when on, inactive and due, `down()`
   * when off and active. True when it ends there. The DNS table is emptied before `up()`,
   * which can take two minutes. A failed `up()` is kept by NmGuestVpn and surfaces as the
   * status' last error; the backoff decides when the next one runs.
   */
  private async converge(on: boolean): Promise<boolean> {
    if (!(await this.nm.profileExists())) return !on;
    const active = await this.nm.isActive();
    if (on && !active) {
      const startedAt = Date.now();
      if (!this.recovery.mayActivate(startedAt)) return false;
      await clearDnsRedirect(this.cfg);
      await this.announceConnecting();
      try {
        await this.nm.up();
      } catch {
        // Recorded by up() (lastActivationError) and published by refresh().
        this.recovery.activationFailed(startedAt);
        return false;
      }
    } else if (!on && active) {
      await this.nm.down();
    }
    return true;
  }

  private async announceConnecting(): Promise<void> {
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
    this.recovery.observeStatus(status);
    let dnsError: string | undefined;
    try {
      await reconcileDnsRedirect(this.cfg, status);
    } catch (err) {
      dnsError = message(err);
    }
    const errors = [this.writeError, this.switchError, this.tickError, desired.error].filter((e): e is string => !!e);
    const next = this.recovery.nextAttempt();
    const snapshot: GuestVpnSnapshot = {
      ...(desired.value !== undefined && { desired: desired.value }),
      status,
      ...(dnsError !== undefined && { dnsError }),
      ...(errors.length > 0 && { actionError: errors.join('; ') }),
      ...(desired.value === true && next !== undefined && { nextAttempt: new Date(next).toISOString() }),
    };
    logSnapshotChanges(this.last, snapshot);
    this.last = snapshot;
    await this.publish(snapshot);
    return snapshot;
  }
}
