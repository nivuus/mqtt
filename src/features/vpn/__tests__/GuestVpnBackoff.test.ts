/**
 * Backoff timing against a fake clock: failed activations count from the END of the attempt
 * (an `up()` can wait up to 90 s), and an import whose activation fails counts as an attempt.
 * Bench, 2026-11-09: an import with a wrong password was retried 3 s later, and a 60 s
 * activation timeout published a `next_attempt` already in the past.
 */
import * as execModule from '../../../utils/exec';
import { writeDesiredEnabled } from '../desiredState';
import { clearDnsRedirect, reconcileDnsRedirect } from '../guestVpnDns';
import { readGuestVpnStatus } from '../guestVpnStatus';
import { fakeStatus, Harness, makeHarness } from './guestVpnHarness';

jest.mock('../../../utils/exec');
jest.mock('../guestVpnStatus');
jest.mock('../guestVpnDns', () => ({
  ...jest.requireActual('../guestVpnDns'), reconcileDnsRedirect: jest.fn(), clearDnsRedirect: jest.fn(),
}));
jest.mock('../../../config', () => ({
  getConfigManager: () => ({ config: require('./guestVpnHarness').mockAgentConfig }),
}));

const mockedExec = execModule as jest.Mocked<typeof execModule>;
const mockedStatus = readGuestVpnStatus as jest.MockedFunction<typeof readGuestVpnStatus>;
const S = 1000;
const T0 = 1_000_000 * S;
const ID = 'nivuus-guest-vpn';
const INPUT = { ovpn: 'client\nremote vpn.example.com 1194\n<ca>\nX\n</ca>\n', username: 'u', password: 'p' };

describe('GuestVpn backoff timing', () => {
  let h: Harness;
  let clock: number;
  /** How long NM keeps the VPN activating before dropping it, in fake seconds. */
  let activationSeconds: number;
  beforeEach(async () => {
    h = await makeHarness(mockedExec);
    clock = T0;
    activationSeconds = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    mockedStatus.mockImplementation(async (_cfg, lastError) => fakeStatus(h.nm, lastError));
    (reconcileDnsRedirect as jest.Mock).mockResolvedValue(undefined);
    (clearDnsRedirect as jest.Mock).mockResolvedValue(undefined);
    h.nm.upOutcome = 'dropped';
    // The activation wait polls GENERAL.STATE: let the fake time pass there.
    h.nm.override = args => {
      if (args.includes('GENERAL.STATE')) clock += activationSeconds * S;
      return undefined;
    };
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    await h.nm.addProfile(ID, ID);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await h.feature.stop();
    await h.nm.remove();
  });

  const at = async (seconds: number) => { clock = T0 + seconds * S; await h.tick(); };
  const nextAttempt = () => Date.parse(h.attributes().next_attempt as string);

  it('a long failed activation backs off from its end: next_attempt is never in the past', async () => {
    activationSeconds = 60; // NM's VPN timeout, then the VPN is dropped
    await at(0);
    expect(h.upCalls()).toBe(1);
    expect(clock).toBe(T0 + 60 * S);
    expect(nextAttempt()).toBe(T0 + 75 * S);
    expect(nextAttempt()).toBeGreaterThan(clock);
    await at(70);
    expect(h.upCalls()).toBe(1);
    await at(75);
    expect(h.upCalls()).toBe(2);
    expect(nextAttempt()).toBe(T0 + 135 * S + 30 * S);
  });

  it('an import whose activation fails counts as the first failed attempt', async () => {
    activationSeconds = 3;
    await h.feature.importProfile(INPUT);
    expect(h.upCalls()).toBe(1);
    const ended = clock;
    expect(nextAttempt()).toBe(ended + 15 * S);
    await at((ended - T0) / S + 3); // the next tick: no retry 3 s later
    expect(h.upCalls()).toBe(1);
    await at((ended - T0) / S + 15);
    expect(h.upCalls()).toBe(2);
  });
});
