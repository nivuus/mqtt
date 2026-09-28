// src/features/updates/hostMaintenanceQueue.ts

/**
 * The single FIFO every host maintenance operation runs through, so that a
 * container recreate (DockerUpdates) and an apt upgrade (AptUpdates) never
 * overlap.
 *
 * Run concurrently, they break each other: docker-ce's postinst restarts
 * dockerd in the middle of whatever `docker compose up` is recreating a
 * container, and the apt path's snapshot of running compose services records
 * a service that is mid-recreate as "not running", so it is never recreated
 * after the upgrade -- a leftover `<id>_<name>` container, or a service left
 * down. Home Assistant sends several install commands in the same second,
 * the APT entity's among them.
 *
 * The queue is module state on purpose: both features import this one
 * module, so the exclusivity holds across the whole agent process.
 */

let tail: Promise<void> = Promise.resolve();

/**
 * Runs `operation` once every operation queued before it has settled, and
 * returns its outcome. Operations start in the order runExclusive was
 * called. A rejecting operation never blocks the ones queued behind it; its
 * own caller still receives the rejection.
 */
export function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const run = tail.then(() => operation());
  tail = run.then(settled, settled);
  return run;
}

// The next operation only waits for the previous one to settle: that
// operation's result or rejection belongs to its own caller.
function settled(): void {}
