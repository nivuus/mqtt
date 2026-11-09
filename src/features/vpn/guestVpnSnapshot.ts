/**
 * What one supervision pass publishes, and the log line for each change of it (once, not on
 * every 15 s tick).
 */
import logger from '../../utils/logger';
import { GuestVpnStatus } from './guestVpnStatus';

export interface GuestVpnSnapshot {
  /** The owner's on/off choice; undefined when the file cannot be read. */
  desired?: boolean;
  status: GuestVpnStatus;
  /** The DNS table could not be applied, or guests resolve outside the tunnel. */
  dnsError?: string;
  /** A failed switch command, supervision step or on/off file read or write. */
  actionError?: string;
  /** ISO time of the next activation attempt while failures are backing off. */
  nextAttempt?: string;
}

export const TAG = '[guest_vpn]';

export function logSnapshotChanges(prev: GuestVpnSnapshot | undefined, next: GuestVpnSnapshot): void {
  if (prev?.status.state !== next.status.state || prev.status.lastError !== next.status.lastError) {
    const why = next.status.lastError ? `: ${next.status.lastError}` : '';
    const line = `${TAG} state ${next.status.state}${why}`;
    if (next.status.state === 'error') logger.warn(line);
    else logger.info(line);
  }
  if (next.nextAttempt && next.nextAttempt !== prev?.nextAttempt) {
    logger.info(`${TAG} next activation attempt at ${next.nextAttempt}`);
  }
  if (next.status.exitIpError && next.status.exitIpError !== prev?.status.exitIpError) {
    logger.warn(`${TAG} ${next.status.exitIpError}`);
  }
  if (next.dnsError && next.dnsError !== prev?.dnsError) logger.error(`${TAG} DNS: ${next.dnsError}`);
  if (next.actionError && next.actionError !== prev?.actionError) logger.error(`${TAG} ${next.actionError}`);
}
