/**
 * Runs debian/prerm.sh with systemctl, nmcli and nft replaced by stubs that only log their
 * argv: nothing touches the host. PATH holds the stub directory first, and the test checks
 * that every command the script calls was a stub.
 *
 * fpm does not ship prerm.sh as the maintainer script: it pastes it into a before_remove()
 * function, called WITHOUT arguments and only for `prerm remove` (read from a built package,
 * 2026-11-09). FPM_PRERM reproduces that template so the script runs as it does in the .deb.
 */
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

const SCRIPT = path.join(__dirname, '..', '..', 'debian', 'prerm.sh');
const STUBBED = ['systemctl', 'nmcli', 'nft'];

const FPM_PRERM = (body: string): string => `#!/bin/sh
before_remove() {
    :
${body}
}
if [ "\${1}" = "remove" -a -z "\${2}" ]
then
    before_remove
fi
`;

describe('debian/prerm.sh', () => {
  let dir: string;
  let log: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'prerm-'));
    log = path.join(dir, 'calls.log');
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  /** Installs the stubs and the fpm-wrapped script; `failing` stubs exit 1 after logging. */
  async function run(args: string[], failing: string[] = []): Promise<{ status: number; calls: string[] }> {
    for (const name of STUBBED) {
      const exit = failing.includes(name) ? 1 : 0;
      await fs.writeFile(path.join(dir, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\nexit ${exit}\n`, { mode: 0o755 });
    }
    const wrapped = path.join(dir, 'prerm');
    await fs.writeFile(wrapped, FPM_PRERM(await fs.readFile(SCRIPT, 'utf8')), { mode: 0o755 });
    let status = 0;
    try {
      execFileSync('/bin/sh', [wrapped, ...args], { env: { PATH: `${dir}:/usr/bin:/bin` }, stdio: 'pipe' });
    } catch (err) {
      status = (err as { status: number }).status;
    }
    const calls = (await fs.readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean);
    expect(calls.every(c => STUBBED.includes(c.split(' ')[0]))).toBe(true);
    return { status, calls };
  }

  it('remove: stops the agent, then takes the guest VPN down and deletes its nft table', async () => {
    const { status, calls } = await run(['remove']);
    expect(status).toBe(0);
    expect(calls).toEqual([
      'systemctl stop mqtt-system-agent.service',
      'systemctl disable mqtt-system-agent.service',
      'nmcli connection down id nivuus-guest-vpn',
      'nft delete table inet nivuus_guest_vpn',
    ]);
  });

  it('remove never fails because the VPN was not up or the table did not exist', async () => {
    const { status, calls } = await run(['remove'], ['nmcli', 'nft']);
    expect(status).toBe(0);
    expect(calls).toContain('nft delete table inet nivuus_guest_vpn');
  });

  it.each([['upgrade', '1.0.1'], ['failed-upgrade', '1.0.0'], ['deconfigure', 'in-favour']])(
    '%s runs nothing: the new agent keeps the tunnel', async (...args) => {
      const { status, calls } = await run(args);
      expect(status).toBe(0);
      expect(calls).toEqual([]);
    },
  );

  it('does not branch on $1, which is always empty inside before_remove()', async () => {
    const body = (await fs.readFile(SCRIPT, 'utf8')).split('\n').filter(l => !l.trimStart().startsWith('#'));
    expect(body.join('\n')).not.toMatch(/\$\{?1\b/);
  });
});
