/**
 * The supervisor's memory between ticks: when the next activation may run (RetryBackoff) and
 * how many ticks in a row an activated tunnel has failed its health checks.
 *
 * Expected fallback for guests when the provider dies silently: the DNS probe fails on the
 * first tick after the outage (the DNS table is emptied at once, guest DNS goes to the router),
 * and on the second consecutive failing tick the tunnel is taken down, so guest traffic leaves
 * through the uplink: 15 to 30 s after the outage, plus up to two probe timeouts (3 s each).
 * Without it OpenVPN's pushed ping-restart (120 s) then ping-exit (60 s) took about 3 minutes.
 */
import { RetryBackoff } from './retryBackoff';
import { GuestVpnStatus } from './guestVpnStatus';

/** Consecutive unhealthy ticks (15 s apart) before an activated tunnel is restarted. */
export const UNHEALTHY_TICKS_BEFORE_RESTART = 2;

export class TunnelRecovery {
  private readonly backoff = new RetryBackoff();
  private unhealthyTicks = 0;

  /** True when an activation may start at `now`. */
  mayActivate(now: number): boolean {
    return this.backoff.due(now);
  }

  /** An activation failed, at `endedAt`, or the tunnel was restarted unhealthy. */
  activationFailed(endedAt: number): void {
    this.backoff.failed(endedAt);
  }

  /**
   * Records one tick's status; true when the tunnel must be taken down now. The restart counts
   * as a failed activation, so a tunnel that keeps coming up unhealthy backs off too.
   */
  observeTick(status: GuestVpnStatus, now: number): boolean {
    if (status.tunnelFault === undefined) {
      this.unhealthyTicks = 0;
      return false;
    }
    if (++this.unhealthyTicks < UNHEALTHY_TICKS_BEFORE_RESTART) return false;
    this.unhealthyTicks = 0;
    this.backoff.failed(now);
    return true;
  }

  /** Healthy means the activation worked: the next failure starts the backoff over. */
  observeStatus(status: GuestVpnStatus): void {
    if (status.state === 'connected') this.backoff.reset();
  }

  /** A switch command or an import is a fresh start: retry at once, forget past faults. */
  startOver(): void {
    this.backoff.reset();
    this.unhealthyTicks = 0;
  }

  /** When the next activation may start, while failures are backing off. */
  nextAttempt(): number | undefined {
    return this.backoff.nextAttempt();
  }
}
