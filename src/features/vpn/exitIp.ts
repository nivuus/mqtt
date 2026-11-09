/**
 * The guest VPN's exit IP, measured through the tunnel with `curl --interface <tun>`.
 *
 * Reported only: a device-bound request succeeds even when table 200 has lost its routes, and
 * ipify is a third party whose hiccups say nothing about the tunnel. Whether guests really use
 * the tunnel is tunnelHealth.ts's job; a failure here never changes the state or the DNS table.
 */
import { isIP } from 'net';
import { execute_argv } from '../../utils/exec';

/** Answers with the caller's public IP as plain text. */
export const EXIT_IP_SERVICE = 'https://api.ipify.org';
const EXIT_IP_MAX_TIME_S = 10;
// curl's own --max-time fires first; this only bounds a curl that ignores it.
const EXIT_IP_KILL_MS = (EXIT_IP_MAX_TIME_S + 5) * 1000;

export type ExitIpResult = { exitIp: string } | { error: string };

export async function measureExitIp(device: string): Promise<ExitIpResult> {
  const result = await execute_argv('curl', [
    '--silent', '--show-error', '--fail',
    '--interface', device,
    '--max-time', String(EXIT_IP_MAX_TIME_S),
    EXIT_IP_SERVICE,
  ], { timeoutMs: EXIT_IP_KILL_MS, quiet: true });
  const failed = `no exit IP measured through ${device}`;
  if (result.exitCode !== 0) {
    return { error: `${failed}: ${result.stderr.trim() || `curl exited with ${result.exitCode}`}` };
  }
  const exitIp = result.stdout.trim();
  if (isIP(exitIp) === 0) return { error: `${failed}: ${EXIT_IP_SERVICE} returned no IP address` };
  return { exitIp };
}
