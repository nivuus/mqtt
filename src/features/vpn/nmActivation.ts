/**
 * Waits for the outcome of a VPN activation, which `nmcli connection up` does not report here.
 *
 * The VPN is activated on the guest bridge (`ifname publicBridge`), which is already up. nmcli
 * takes an activating connection whose device is a bond, team or bridge in IP_CONFIG..ACTIVATED
 * for an activated one ("controller waiting for ports", nmc_activation_get_effective_state in
 * libnmc-base/nm-client-utils.c, 1.52) and returns 0 at once, also for a VPN that fails a second
 * later with AUTH_FAILED (bench: 18 ms). `--wait` does not change that. So the activation state
 * is polled by UUID: `activated` is success; leaving the active list is failure (NM removes a
 * failed VPN's active connection); still activating at the bound is a timeout, after which the
 * activation is cancelled so that it cannot complete behind the caller's back.
 */
import { nmcli } from './nmcli';
import { activationStateOf } from './nmProfiles';

export interface ActivationEnv {
  sleep: (ms: number) => Promise<void>;
  /** Wall clock in ms; injected so that tests can drive the deadline. */
  now: () => number;
  pollMs: number;
  /** Bound on the wait; NM's own VPN service timeout defaults to 60 s (`vpn.timeout 0`). */
  activationTimeoutMs: number;
}

/** One poll is a local D-Bus read (milliseconds); a hung NetworkManager must not hold the queue. */
export const POLL_TIMEOUT_MS = 10000;

async function cancelActivation(uuid: string): Promise<string> {
  try {
    await nmcli(['connection', 'down', 'uuid', uuid], POLL_TIMEOUT_MS);
    return '';
  } catch (err) {
    return (err as Error).message;
  }
}

export async function waitForActivation(env: ActivationEnv, uuid: string): Promise<void> {
  // The wait ends by the clock, not by a poll count: it is at most the deadline plus one poll timeout.
  const deadline = env.now() + env.activationTimeoutMs;
  for (;;) {
    let state: string | undefined;
    try {
      state = await activationStateOf(uuid, POLL_TIMEOUT_MS);
    } catch (err) {
      // The activation may still be running behind a failed read: cancel it before reporting.
      const failed = await cancelActivation(uuid);
      if (failed) {
        throw new Error(`${(err as Error).message}; cancelling the activation failed too: ${failed}`);
      }
      throw err;
    }
    if (state === 'activated') return;
    if (state === undefined || state === 'deactivating' || state === 'deactivated') {
      throw new Error('NetworkManager dropped the VPN while activating (wrong credentials, unreachable '
        + 'server or rejected configuration; NetworkManager\'s journal has the reason)');
    }
    if (env.now() >= deadline) break;
    await env.sleep(env.pollMs);
  }
  const failed = await cancelActivation(uuid);
  const cancelled = failed ? `; cancelling it failed: ${failed}` : '';
  throw new Error(`the VPN was still activating after ${env.activationTimeoutMs / 1000} s${cancelled}`);
}
