import * as execModule from '../../../utils/exec';
import { writeDesiredEnabled } from '../desiredState';
import { reconcileDnsRedirect } from '../guestVpnDns';
import { readGuestVpnStatus } from '../guestVpnStatus';
import { fail, ok } from './fakeNmcli';
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
const mockedReconcile = reconcileDnsRedirect as jest.MockedFunction<typeof reconcileDnsRedirect>;

const tick = (h: Harness) => h.tick();
let clock = 0;
/** Moves Date.now forward: activation retries are spaced in time (RetryBackoff). */
const later = (seconds: number) => { clock += seconds * 1000; };
/** BaseFeature's own call: starts a tick without waiting for it. */
const scheduledUpdate = (h: Harness) => (h.feature as unknown as { update(): Promise<void> }).update();

describe('GuestVpn supervisor', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness(mockedExec);
    mockedStatus.mockImplementation((_cfg, lastError) => fakeStatus(h.nm, lastError));
    mockedReconcile.mockResolvedValue(undefined);
    clock = 1_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await h.feature.stop();
    await h.nm.remove();
  });

  it('getStatus reuses the last tick snapshot instead of probing again, and ticks once if none exists', async () => {
    await h.feature.getStatus();
    expect(mockedStatus).toHaveBeenCalledTimes(1);
    await h.feature.getStatus();
    expect(mockedStatus).toHaveBeenCalledTimes(1);
  });

  it('supervisor: desired on + profile inactive → up() on each due tick, state connecting/error with last_error published', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    await h.nm.addProfile('nivuus-guest-vpn', 'nivuus-guest-vpn');
    h.nm.override = args => (args.includes('up') ? fail('Error: Connection activation failed: auth failed') : undefined);

    await tick(h);
    expect(h.upCalls()).toBe(1);
    expect(h.payloads('state/state')).toEqual(['connecting', 'error']);
    expect(h.attributes().last_error).toBe('Error: Connection activation failed: auth failed');
    expect(h.last('on_orange/state')).toBe('ON');

    // Backoff (GuestVpnRecovery.test.ts): a tick before the next attempt only publishes the state.
    await tick(h);
    expect(h.upCalls()).toBe(1);
    later(15);
    await tick(h);
    expect(h.upCalls()).toBe(2);
    expect(h.payloads('state/state')).toEqual(['connecting', 'error', 'error', 'connecting', 'error']);
  });

  it('supervisor: brings the tunnel back once the provider answers again', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    await h.nm.addProfile('nivuus-guest-vpn', 'nivuus-guest-vpn');
    h.nm.override = args => (args.includes('up') ? fail('timeout') : undefined);
    await tick(h);
    h.nm.override = undefined;
    later(15);
    await tick(h);
    expect(h.last('state/state')).toBe('connected');
    expect(h.attributes().last_error).toBeNull();
    await tick(h);
    expect(h.upCalls()).toBe(2);
  });

  it('supervisor: desired off → never calls up()', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, false);
    await h.nm.addProfile('nivuus-guest-vpn', 'nivuus-guest-vpn');
    await tick(h);
    await tick(h);
    expect(h.upCalls()).toBe(0);
    expect(h.last('state/state')).toBe('disabled');
    expect(h.last('switch/state')).toBe('OFF');
  });

  it('supervisor: no profile → state no_config, no up()', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    await tick(h);
    expect(h.upCalls()).toBe(0);
    expect(h.last('state/state')).toBe('no_config');
    expect(h.last('switch/state')).toBe('ON');
  });

  it('supervisor: an unreadable on/off file is shown in HA, not treated as off', async () => {
    const { promises: fs } = await import('fs');
    await fs.writeFile(h.nm.cfg.stateFile, '{"enabled":"yes"}');
    await h.nm.addProfile('nivuus-guest-vpn', 'nivuus-guest-vpn');
    mockedStatus.mockRejectedValue(new Error(`${h.nm.cfg.stateFile}: "enabled" must be a boolean`));
    await tick(h);
    expect(h.upCalls()).toBe(0);
    expect(h.last('state/state')).toBe('error');
    expect(h.last('switch/state')).toBe('None');
    expect(h.attributes().action_error).toContain('"enabled" must be a boolean');
  });

  it('overlapping ticks coalesce instead of queueing activations', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    await h.nm.addProfile('nivuus-guest-vpn', 'nivuus-guest-vpn');
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    mockedExec.execute_argv.mockImplementationOnce(async () => { await held; return ok(); });
    await scheduledUpdate(h);
    await scheduledUpdate(h);
    await scheduledUpdate(h);
    release();
    await h.feature.whenIdle();
    expect(mockedStatus).toHaveBeenCalledTimes(1);
    await tick(h);
    expect(mockedStatus).toHaveBeenCalledTimes(2);
  });

  it('a scheduled update returns before a slow activation finishes', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    await h.nm.addProfile('nivuus-guest-vpn', 'nivuus-guest-vpn');
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const fakeExec = mockedExec.execute_argv.getMockImplementation()!;
    mockedExec.execute_argv.mockImplementation(async (file, args, opts) => {
      if (args.includes('up')) await held;
      return fakeExec(file, args, opts);
    });
    await scheduledUpdate(h);
    expect(h.upCalls()).toBe(0);
    release();
    await h.feature.whenIdle();
    expect(h.upCalls()).toBe(1);
  });

  it('a switch command waits for a running tick instead of interleaving with it', async () => {
    await h.nm.addProfile('nivuus-guest-vpn', 'nivuus-guest-vpn');
    await h.start(); // desired off: subscribes the switch, no activation
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    const order: string[] = [];
    h.nm.override = args => {
      if (args.includes('up')) order.push('up');
      if (args.includes('down')) order.push('down');
      return undefined;
    };
    const running = tick(h);
    await h.send('OFF');
    await running;
    expect(order).toEqual(['up', 'down']);
    expect(h.last('state/state')).toBe('disabled');
  });

  it('desired off + profile active → down() on tick, state disabled', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, false);
    await h.nm.addProfile('nivuus-guest-vpn', 'nivuus-guest-vpn', true);
    await tick(h);
    expect(h.nm.find(a => a.includes('down'))).toHaveLength(1);
    expect(h.upCalls()).toBe(0);
    expect(h.last('state/state')).toBe('disabled');
    expect(h.last('on_orange/state')).toBe('ON');
    await tick(h);
    expect(h.nm.find(a => a.includes('down'))).toHaveLength(1);
  });

  it('a failed switch stays visible until a tick converges to the owner\'s choice', async () => {
    await h.nm.addProfile('nivuus-guest-vpn', 'nivuus-guest-vpn', true);
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    await h.start();
    h.nm.override = args => (args.includes('down') ? fail('Error: device busy') : undefined);
    await h.send('OFF');
    expect(h.attributes().action_error).toBe('switching off failed: nmcli connection down failed: Error: device busy');

    await tick(h);
    expect(h.attributes().action_error).toContain('switching off failed');
    expect(h.attributes().action_error).toContain('supervision failed: nmcli connection down failed');

    h.nm.override = undefined;
    await tick(h);
    expect(h.attributes().action_error).toBeNull();
    expect(h.last('state/state')).toBe('disabled');
  });
});
