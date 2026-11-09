/**
 * Real command output captured on the bench VM (Task 9b, nmcli 1.52.1, iproute2 of Debian 13),
 * fed to the code that parses it. `fixtures/bench/manifest.json` lists every capture with its
 * command, exit code and stderr; public addresses are redacted to documentation ranges and the
 * username to guest@example.com. See docs/claude/guest-vpn-host-notes.md, "Task 9b".
 */
import { readFileSync } from 'fs';
import * as path from 'path';
import * as execModule from '../../../utils/exec';
import { DEFAULT_GUEST_VPN_CONFIG } from '../nmProfileSettings';
import { checkTunnelHealth } from '../tunnelHealth';
import { ok } from './fakeNmcli';

jest.mock('../../../utils/exec');
const mockedExec = execModule as jest.Mocked<typeof execModule>;

type Capture = { command: string; rc: number; stderr: string };
const DIR = path.join(__dirname, 'fixtures', 'bench');
const manifest = JSON.parse(readFileSync(path.join(DIR, 'manifest.json'), 'utf8')) as Record<string, Capture>;
const stdout = (name: string) => readFileSync(path.join(DIR, `${name}.stdout`), 'utf8');

function serve(state: string): void {
  mockedExec.execute_argv.mockImplementation(async (file, args) => {
    if (file === 'ip' && args.includes('route')) return ok(stdout(`${state}.ip-route-200.json`));
    if (file === 'ip' && args.includes('rule')) return ok(stdout(`${state}.ip-rule.json`));
    throw new Error(`unexpected ${file} ${args.join(' ')}`);
  });
  mockedExec.execute_argv_input.mockResolvedValue(ok());
}

describe('bench captures (nmcli 1.52.1)', () => {
  it('every capture is listed with its command and exit code', () => {
    for (const [name, capture] of Object.entries(manifest)) {
      expect(capture.command).toMatch(/^(ip|nmcli) /);
      expect(Number.isInteger(capture.rc)).toBe(true);
      expect(() => stdout(name)).not.toThrow();
    }
  });

  it('a healthy activated tunnel passes the health checks', async () => {
    serve('active');
    await expect(checkTunnelHealth(DEFAULT_GUEST_VPN_CONFIG, ['10.20.128.1'])).resolves.toBeUndefined();
  });

  it('an inactive profile (empty table 200, no rules) fails on the route check', async () => {
    serve('inactive-off');
    await expect(checkTunnelHealth(DEFAULT_GUEST_VPN_CONFIG, ['10.20.128.1']))
      .resolves.toMatch(/no default route via nvguest0 in table 200/);
  });

  it('C1 leak (NM activated, OpenVPN reopened the tun, table 200 empty) fails the health checks', async () => {
    expect(stdout('c1-after-reconnect.nmcli-status-no-vpnstate')).toContain('GENERAL.STATE:activated');
    serve('c1-after-reconnect');
    await expect(checkTunnelHealth(DEFAULT_GUEST_VPN_CONFIG, ['10.20.128.1']))
      .resolves.toMatch(/no default route via nvguest0 in table 200/);
  });

  // Mismatches with the code under test, found on the bench; the fixes are dispatched separately.
  it.todo('guestVpnStatus: `-f ...,VPN.VPN-STATE,...` exits 2 on nmcli 1.52 (active and inactive): '
    + 'see active.nmcli-status and inactive-off.nmcli-status');
  it.todo('nmGuestVpn.up: `nmcli connection up uuid <u> ifname publicBridge` exits 0 in ~20 ms '
    + '("controller waiting for ports") even on AUTH_FAILED, so RetryBackoff never sees a failure');
  it.todo('nmProfiles.keyfileOf: `-g GENERAL.FILENAME` prints nothing when inactive and exits 2 when active: '
    + 'see *.nmcli-filename; the list form `-g UUID,FILENAME connection show` works');
});
