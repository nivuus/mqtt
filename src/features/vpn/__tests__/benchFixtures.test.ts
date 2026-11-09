/**
 * Real command output captured on the bench VM (Task 9b, nmcli 1.52.1, iproute2 of Debian 13),
 * replayed to the code that runs it (benchReplay.ts). `fixtures/bench/manifest.json` lists
 * every capture with its command, exit code and stderr; public addresses are redacted to
 * documentation ranges and the username to guest@example.com. See
 * docs/claude/guest-vpn-host-notes.md, "Task 9b".
 */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as execModule from '../../../utils/exec';
import { writeDesiredEnabled } from '../desiredState';
import { readGuestVpnStatus } from '../guestVpnStatus';
import { NmGuestVpn } from '../nmGuestVpn';
import { DEFAULT_GUEST_VPN_CONFIG, GuestVpnConfig } from '../nmProfileSettings';
import { keyfileOf } from '../nmProfiles';
import { checkTunnelHealth } from '../tunnelHealth';
import { ok } from './fakeNmcli';
import { manifest, namesListing, replay, stdout, uuidOf } from './benchReplay';

jest.mock('../../../utils/exec');
const mockedExec = execModule as jest.Mocked<typeof execModule>;

const GENERAL_STATE = 'nmcli -t -f GENERAL.STATE connection show uuid <u>';
const EXIT_IP = '192.0.2.10';

/** NAME,UUID listing and curl are not in the captures: synthesized from the captured UUID. */
const extra = (uuid: string) => (file: string, args: string[]) => {
  if (file === 'curl') return ok(EXIT_IP);
  if (file === 'nmcli' && args.includes('NAME,UUID')) return namesListing(uuid);
  return undefined;
};

describe('bench captures (nmcli 1.52.1)', () => {
  let dir: string;
  let cfg: GuestVpnConfig;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bench-fixtures-'));
    cfg = { ...DEFAULT_GUEST_VPN_CONFIG, stateFile: path.join(dir, 'guest-vpn.json') };
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('every capture is listed with its command and exit code', () => {
    for (const [name, capture] of Object.entries(manifest)) {
      expect(capture.command).toMatch(/^(ip|nmcli) /);
      expect(Number.isInteger(capture.rc)).toBe(true);
      expect(() => stdout(name)).not.toThrow();
    }
  });

  describe('tunnelHealth', () => {
    it('a healthy activated tunnel passes the health checks', async () => {
      replay(mockedExec, uuidOf('active'), ['active']);
      await expect(checkTunnelHealth(cfg, ['10.20.128.1'])).resolves.toBeUndefined();
    });

    it('an inactive profile (empty table 200, no rules) fails on the route check', async () => {
      replay(mockedExec, uuidOf('inactive-off'), ['inactive-off']);
      await expect(checkTunnelHealth(cfg, ['10.20.128.1'])).resolves.toMatch(/no default route via nvguest0 in table 200/);
    });

    it('C1 leak (NM activated, OpenVPN reopened the tun, table 200 empty) fails the health checks', async () => {
      replay(mockedExec, uuidOf('c1-after-reconnect'), ['c1-after-reconnect']);
      await expect(checkTunnelHealth(cfg, ['10.20.128.1'])).resolves.toMatch(/no default route via nvguest0 in table 200/);
    });
  });

  describe('keyfileOf (D1: -g GENERAL.FILENAME is empty when inactive, rc 2 when active)', () => {
    it.each(['active', 'inactive-off', 'c1-after-reconnect'])('finds the keyfile of the %s profile', async state => {
      replay(mockedExec, uuidOf(state), [state]);
      await expect(keyfileOf(uuidOf(state)))
        .resolves.toBe('/etc/NetworkManager/system-connections/nivuus-guest-vpn_a.nmconnection');
    });

    it('fails, naming the UUID, when NM lists no such profile', async () => {
      replay(mockedExec, 'not-there', ['inactive-off']);
      await expect(keyfileOf('00000000-0000-4000-8000-00000000dead')).rejects.toThrow(/no keyfile.*00000000-0000-4000-8000-00000000dead/);
    });
  });

  describe('readGuestVpnStatus (D2: VPN.VPN-STATE cannot be selected with -f, rc 2)', () => {
    it('healthy activated tunnel → connected, DNS and remote read', async () => {
      const uuid = uuidOf('active');
      replay(mockedExec, uuid, ['active'], { extra: extra(uuid) });
      await expect(readGuestVpnStatus(cfg)).resolves.toEqual({
        state: 'connected', remote: 'nl2.webunlim.com:1194', dns: ['10.20.128.1'], exitIp: EXIT_IP,
      });
    });

    it('inactive profile, switch off → disabled', async () => {
      const uuid = uuidOf('inactive-off');
      replay(mockedExec, uuid, ['inactive-off'], { extra: extra(uuid) });
      await writeDesiredEnabled(cfg.stateFile, false);
      await expect(readGuestVpnStatus(cfg)).resolves.toEqual({ state: 'disabled', remote: 'nl2.webunlim.com:1194', dns: [] });
    });

    it('activating → connecting', async () => {
      const uuid = uuidOf('active');
      replay(mockedExec, uuid, ['activating'], { extra: extra(uuid) });
      await writeDesiredEnabled(cfg.stateFile, true);
      await expect(readGuestVpnStatus(cfg)).resolves.toMatchObject({ state: 'connecting' });
    });

    it('C1 leak → error with the tunnel fault, never connected', async () => {
      const uuid = uuidOf('c1-after-reconnect');
      replay(mockedExec, uuid, ['c1-after-reconnect'], { extra: extra(uuid) });
      await writeDesiredEnabled(cfg.stateFile, true);
      await expect(readGuestVpnStatus(cfg)).resolves.toMatchObject({
        state: 'error', tunnelFault: expect.stringMatching(/no default route via nvguest0 in table 200/),
      });
    });
  });

  describe('NmGuestVpn.up (D3: `connection up … ifname publicBridge` returns 0 at once)', () => {
    let clockMs = 0;
    const env = { sleep: async (ms: number) => { clockMs += ms; }, now: () => clockMs, pollMs: 500, activationTimeoutMs: 90000 };

    it('waits until NM reports the VPN activated', async () => {
      const uuid = uuidOf('active');
      const commands = replay(mockedExec, uuid, ['activation'], {
        extra: extra(uuid),
        sequences: { [GENERAL_STATE]: ['activating.nmcli-general-state', 'active.nmcli-general-state'] },
      });
      const vpn = new NmGuestVpn(cfg, env);
      await expect(vpn.up()).resolves.toBeUndefined();
      expect(commands.filter(c => c === GENERAL_STATE)).toHaveLength(2);
      expect(vpn.lastActivationError()).toBeUndefined();
    });

    it('wrong password: NM drops the activating VPN → up() fails and records why', async () => {
      const uuid = uuidOf('active');
      replay(mockedExec, uuid, ['activation'], {
        extra: extra(uuid),
        sequences: { [GENERAL_STATE]: ['activating.nmcli-general-state', 'auth-failed.nmcli-general-state'] },
      });
      const vpn = new NmGuestVpn(cfg, env);
      await expect(vpn.up()).rejects.toThrow(/NetworkManager dropped the VPN while activating/);
      expect(vpn.lastActivationError()).toMatch(/dropped the VPN while activating/);
    });
  });
});
