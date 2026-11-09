/**
 * How the supervisor recovers: an activated tunnel that fails its health checks, activation
 * failures (backoff), the DNS table around activations, and failed switch writes.
 */
import * as execModule from '../../../utils/exec';
import * as desiredModule from '../desiredState';
import { writeDesiredEnabled } from '../desiredState';
import { clearDnsRedirect, reconcileDnsRedirect } from '../guestVpnDns';
import { readGuestVpnStatus } from '../guestVpnStatus';
import { fail } from './fakeNmcli';
import { CONNECTED, fakeStatus, Harness, makeHarness } from './guestVpnHarness';

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
const mockedReconcile = reconcileDnsRedirect as jest.MockedFunction<typeof reconcileDnsRedirect>;
const mockedClear = clearDnsRedirect as jest.MockedFunction<typeof clearDnsRedirect>;
const S = 1000;
const FAULT = 'no default route via nvguest0 in table 200';
const ID = 'nivuus-guest-vpn';
const INPUT = { ovpn: 'client\nremote vpn.example.com 1194\n<ca>\nX\n</ca>\n', username: 'u', password: 'p' };

describe('GuestVpn recovery', () => {
  let h: Harness;
  let unhealthy: boolean;
  let clock: number;
  let order: string[];
  beforeEach(async () => {
    h = await makeHarness(mockedExec);
    unhealthy = false;
    clock = 1_000_000 * S;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    order = [];
    mockedStatus.mockImplementation(async (_cfg, lastError) => {
      const status = await fakeStatus(h.nm, lastError);
      if (status.state !== 'connected' || !unhealthy) return status;
      return { state: 'error', lastError: `unhealthy: ${FAULT}`, tunnelFault: FAULT, dns: CONNECTED.dns };
    });
    mockedReconcile.mockResolvedValue(undefined);
    mockedClear.mockReset();
    mockedClear.mockImplementation(async () => { order.push('clear'); });
    h.nm.override = args => {
      if (args.includes('up') && args.includes('connection')) order.push('up');
      if (args.includes('down') && args.includes('connection')) order.push('down');
      return undefined;
    };
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await h.feature.stop();
    await h.nm.remove();
  });

  const downCalls = () => h.nm.find(a => a.includes('down') && a.includes('connection')).length;
  const at = async (seconds: number) => { clock = 1_000_000 * S + seconds * S; await h.tick(); };

  it('an activated tunnel failing health two ticks in a row is taken down, then brought up next tick', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    await h.nm.addProfile(ID, ID, true);
    unhealthy = true;
    await at(0);
    expect(h.last('state/state')).toBe('error');
    expect(h.attributes().last_error).toContain(FAULT);
    expect(downCalls()).toBe(0);
    await at(15);
    expect(downCalls()).toBe(1);
    expect(h.upCalls()).toBe(0);
    unhealthy = false;
    await at(30);
    expect(h.upCalls()).toBe(1);
    expect(h.last('state/state')).toBe('connected');
  });

  it('one failed health check followed by a healthy one never restarts the tunnel', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    await h.nm.addProfile(ID, ID, true);
    unhealthy = true;
    await at(0);
    unhealthy = false;
    await at(15);
    unhealthy = true;
    await at(30);
    expect(downCalls()).toBe(0);
  });

  it('a tunnel that keeps coming up unhealthy backs off between restarts', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    await h.nm.addProfile(ID, ID, true);
    unhealthy = true;
    for (let t = 0; t <= 150; t += 15) await at(t);
    // down at 15, up at 30, down at 45, up at 75 (30 s after), down at 90, up at 150 (60 s after).
    expect(order).toEqual(['down', 'clear', 'up', 'down', 'clear', 'up', 'down', 'clear', 'up']);
  });

  it('empties the DNS table before up(), so it never DNATs to a provider DNS while routing is gone', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    await h.nm.addProfile(ID, ID);
    await at(0);
    expect(order).toEqual(['clear', 'up']);
  });

  it('import empties the DNS table right after the old tunnel goes down, before the new one comes up', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    await h.nm.addProfile(ID, ID, true);
    await h.start();
    order = [];
    await h.feature.importProfile(INPUT);
    expect(order).toEqual(['down', 'clear', 'up']);
  });

  it('failed activations back off 15 s, 30 s, 60 s... and publish next_attempt', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    await h.nm.addProfile(ID, ID);
    h.nm.override = args => (args.includes('up') ? fail('Error: auth failed') : undefined);
    const attemptsAt: number[] = [];
    for (let t = 0; t <= 120; t += 15) {
      const before = h.upCalls();
      await at(t);
      if (h.upCalls() > before) attemptsAt.push(t);
    }
    expect(attemptsAt).toEqual([0, 15, 45, 105]);
    expect(h.attributes().next_attempt).toBe(new Date(1_000_000 * S + 225 * S).toISOString());
    expect(h.last('state/state')).toBe('error');
  });

  it('a switch command and an import reset the backoff; a healthy tunnel clears next_attempt', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    await h.nm.addProfile(ID, ID);
    h.nm.override = args => (args.includes('up') ? fail('Error: auth failed') : undefined);
    await h.start(); // first attempt at 0 s
    await at(15); // next attempt at 45 s
    await h.send('ON');
    expect(h.upCalls()).toBe(3);
    await h.feature.importProfile(INPUT);
    expect(h.upCalls()).toBe(4);
    h.nm.override = undefined;
    await at(20);
    expect(h.upCalls()).toBe(5);
    expect(h.last('state/state')).toBe('connected');
    expect(h.attributes().next_attempt).toBeNull();
  });

  it('a failed write of the switch choice stays visible until a later write succeeds', async () => {
    await h.nm.addProfile(ID, ID);
    await h.start();
    const write = jest.spyOn(desiredModule, 'writeDesiredEnabled').mockRejectedValueOnce(new Error('EROFS: read-only'));
    await h.send('ON');
    expect(h.attributes().action_error).toBe('saving the switch choice ON failed: EROFS: read-only');
    await at(15); // converged to the (unchanged) choice: off
    expect(h.last('state/state')).toBe('disabled');
    expect(h.attributes().action_error).toContain('EROFS');
    await h.send('OFF');
    expect(write).toHaveBeenCalledTimes(2);
    expect(h.attributes().action_error).toBeNull();
  });
});
