/**
 * When the supervisor may next try to bring the guest tunnel up after failures: 15 s after
 * the first failed attempt, then doubling, capped at 5 minutes. A wrong password would
 * otherwise log in to the provider every 15 s forever (account lock risk, log spam).
 *
 * The supervisor resets it on a switch command, an import, and once the tunnel is healthy.
 * Times are milliseconds since the epoch, measured from the start of the failed attempt.
 */
export const BACKOFF_BASE_MS = 15000;
export const BACKOFF_CAP_MS = 5 * 60 * 1000;
// Attempts happen on update ticks, which are periodic, not exact: a tick that arrives a little
// before the computed time is the tick the delay was meant for, not one to skip.
const TICK_JITTER_MS = 1000;

export class RetryBackoff {
  private failures = 0;
  private next: number | undefined;

  /** Records a failed attempt that started at `startedAt`. */
  failed(startedAt: number): void {
    this.failures++;
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** (this.failures - 1), BACKOFF_CAP_MS);
    this.next = startedAt + delay;
  }

  reset(): void {
    this.failures = 0;
    this.next = undefined;
  }

  /** True when an attempt may start at `now`. */
  due(now: number): boolean {
    return this.next === undefined || now + TICK_JITTER_MS >= this.next;
  }

  /** When the next attempt may start; undefined while no failure is pending. */
  nextAttempt(): number | undefined {
    return this.next;
  }
}
