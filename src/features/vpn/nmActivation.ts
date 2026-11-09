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
  pollMs: number;
  /** Bound on the wait; NM's own VPN service timeout defaults to 60 s (`vpn.timeout 0`). */
  activationTimeoutMs: number;
}

export async function waitForActivation(env: ActivationEnv, uuid: string): Promise<void> {
  const polls = Math.ceil(env.activationTimeoutMs / env.pollMs);
  for (let i = 0; i <= polls; i++) {
    const state = await activationStateOf(uuid);
    if (state === 'activated') return;
    if (state === undefined || state === 'deactivating' || state === 'deactivated') {
      throw new Error('NetworkManager dropped the VPN while activating (wrong credentials, unreachable '
        + 'server or rejected configuration; NetworkManager\'s journal has the reason)');
    }
    if (i < polls) await env.sleep(env.pollMs);
  }
  let cancelled = '';
  try {
    await nmcli(['connection', 'down', 'uuid', uuid]);
  } catch (err) {
    cancelled = `; cancelling it failed: ${(err as Error).message}`;
  }
  throw new Error(`the VPN was still activating after ${env.activationTimeoutMs / 1000} s${cancelled}`);
}
