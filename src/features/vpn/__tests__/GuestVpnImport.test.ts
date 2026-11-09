import * as execModule from '../../../utils/exec';
import logger from '../../../utils/logger';
import { writeDesiredEnabled } from '../desiredState';
import { reconcileDnsRedirect } from '../guestVpnDns';
import { readGuestVpnStatus } from '../guestVpnStatus';
import { GuestVpnSupervisor } from '../guestVpnSupervisor';
import { NmGuestVpn } from '../nmGuestVpn';
import { fail } from './fakeNmcli';
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

const PASSWORD = 'Pa55-w0rd-n3ver-sh0wn';
const KEY_MARKER = 'PRIVATE-KEY-MATERIAL-0xC0FFEE';
const OVPN = ['client', 'dev tun', 'remote vpn.example.com 1194', 'auth-user-pass',
  '<ca>', 'INLINE-CA', '</ca>', '<key>', KEY_MARKER, '</key>'].join('\n');
const INPUT = { ovpn: OVPN, username: 'guest@example.com', password: PASSWORD };

describe('GuestVpn.importProfile', () => {
  let h: Harness;
  let logged: string[];
  beforeEach(async () => {
    h = await makeHarness(mockedExec);
    mockedStatus.mockImplementation((_cfg, lastError) => fakeStatus(h.nm, lastError));
    mockedReconcile.mockResolvedValue(undefined);
    logged = [];
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      jest.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(a => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' '));
      });
    }
    await h.start();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await h.feature.stop();
    await h.nm.remove();
  });

  const everythingSeen = () => [
    ...logged,
    ...h.mqtt.publishedMessages.map(m => `${m.topic} ${String(m.message)}`),
    ...h.nm.calls.map(c => c.args.join(' ')),
  ].join('\n');

  it('importProfile rejects invalid profiles with the validation reason and changes nothing', async () => {
    const published = h.mqtt.publishedMessages.length;
    const before = h.last('state/state');
    await expect(h.feature.importProfile({ ...INPUT, ovpn: `${OVPN}\nup /bin/sh` }))
      .rejects.toThrow('invalid OpenVPN profile: directive "up" is not allowed');
    expect(h.nm.calls.filter(c => !c.args.includes('show'))).toHaveLength(0);
    expect(h.nm.ids()).toEqual([]);
    expect(await h.desiredFile()).toBeUndefined();
    expect(h.last('state/state')).toBe(before);
    expect(h.mqtt.publishedMessages.slice(published).every(m => !m.topic.startsWith('homeassistant/'))).toBe(true);
  });

  it('returns the status after the import and activates when the owner enabled the VPN', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    const status = await h.feature.importProfile(INPUT);
    expect(status).toMatchObject({ state: 'connected', exitIp: '203.0.113.7' });
    expect(h.nm.ids()).toEqual(['nivuus-guest-vpn']);
    expect(h.last('state/state')).toBe('connected');
    expect(mockedReconcile).toHaveBeenLastCalledWith(h.nm.cfg, expect.objectContaining({ state: 'connected' }));
  });

  it('returns error with nmcli\'s reason when the new profile does not activate', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    h.nm.override = args => (args.includes('up') ? fail('Error: auth failed') : undefined);
    const status = await h.feature.importProfile(INPUT);
    expect(status).toMatchObject({ state: 'error', lastError: 'Error: auth failed' });
    expect(h.attributes().last_error).toBe('Error: auth failed');
  });

  it('importProfile never publishes or logs the password', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    await h.feature.importProfile(INPUT);
    h.nm.override = args => (args.includes('load') ? fail('Error: failed to load connection') : undefined);
    await expect(h.feature.importProfile(INPUT)).rejects.toThrow('failed to load connection');
    h.nm.override = args => (args.includes('up') ? fail('Error: auth failed') : undefined);
    await h.feature.importProfile(INPUT);

    expect(logged.length).toBeGreaterThan(0);
    const seen = everythingSeen();
    expect(seen).not.toContain(PASSWORD);
    expect(seen).not.toContain(KEY_MARKER);
    expect(seen).not.toContain('INLINE-CA');
  });

  it('runs a tick only after a running import has finished', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    const fakeExec = mockedExec.execute_argv.getMockImplementation()!;
    let release!: () => void;
    let held!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const reached = new Promise<void>(resolve => { held = resolve; });
    mockedExec.execute_argv.mockImplementation(async (file, args, opts) => {
      if (args.includes('import')) {
        held();
        await gate;
      }
      return fakeExec(file, args, opts);
    });
    const imported = h.feature.importProfile(INPUT);
    await reached;
    const callsWhileImporting = mockedExec.execute_argv.mock.calls.length;
    expect(mockedExec.execute_argv.mock.calls[callsWhileImporting - 1][1]).toContain('import');
    const ticked = (h.feature as unknown as { update(): Promise<void> }).update();
    for (let i = 0; i < 20; i++) await new Promise(setImmediate);
    // The import is held inside `connection import`: the tick must not have run a single nmcli call.
    expect(mockedExec.execute_argv.mock.calls.length).toBe(callsWhileImporting);
    release();
    await Promise.all([imported, ticked]);
    await h.feature.whenIdle();
    expect(h.upCalls()).toBe(1);
  });

  it('publishes connecting while an enabled import activates, never for a rejected upload', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    const published = h.payloads('state/state').length;
    await expect(h.feature.importProfile({ ...INPUT, ovpn: 'client' })).rejects.toThrow('no remote directive');
    expect(h.payloads('state/state').slice(published)).not.toContain('connecting');
    await h.feature.importProfile(INPUT);
    expect(h.payloads('state/state').slice(published).slice(-2)).toEqual(['connecting', 'connected']);
  });

  it('rethrows the import error even when publishing the state afterwards fails', async () => {
    const supervisor = new GuestVpnSupervisor(h.nm.cfg, new NmGuestVpn(h.nm.cfg, h.nm.env), async () => {
      throw new Error('broker gone');
    });
    await expect(supervisor.importProfile({ ...INPUT, ovpn: `${OVPN}\nplugin x.so` }))
      .rejects.toThrow('directive "plugin" is not allowed');
    expect(logged.join('\n')).toContain('broker gone');
  });
});
