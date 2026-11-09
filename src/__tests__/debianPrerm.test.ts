/**
 * Runs debian/prerm.sh with systemctl, nmcli and nft replaced by stubs that only log their
 * argv: nothing touches the host. PATH holds the stub directory first, and the test checks
 * that every command the script calls was a stub.
 */
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

const SCRIPT = path.join(__dirname, '..', '..', 'debian', 'prerm.sh');
const STUBBED = ['systemctl', 'nmcli', 'nft'];

describe('debian/prerm.sh', () => {
  let dir: string;
  let log: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'prerm-'));
    log = path.join(dir, 'calls.log');
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  /** Installs the stubs; `failing` ones exit 1 after logging. */
  async function run(arg: string, failing: string[] = []): Promise<{ status: number; calls: string[] }> {
    for (const name of STUBBED) {
      const exit = failing.includes(name) ? 1 : 0;
      await fs.writeFile(path.join(dir, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\nexit ${exit}\n`, { mode: 0o755 });
    }
    let status = 0;
    try {
      execFileSync('/bin/sh', [SCRIPT, arg], { env: { PATH: `${dir}:/usr/bin:/bin` }, stdio: 'pipe' });
    } catch (err) {
      status = (err as { status: number }).status;
    }
    const calls = (await fs.readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean);
    expect(calls.every(c => STUBBED.includes(c.split(' ')[0]))).toBe(true);
    return { status, calls };
  }

  it('remove: stops the agent, then takes the guest VPN down and deletes its nft table', async () => {
    const { status, calls } = await run('remove');
    expect(status).toBe(0);
    expect(calls).toEqual([
      'systemctl stop mqtt-system-agent.service',
      'systemctl disable mqtt-system-agent.service',
      'nmcli connection down id nivuus-guest-vpn',
      'nft delete table inet nivuus_guest_vpn',
    ]);
  });

  it('remove never fails because the VPN was not up or the table did not exist', async () => {
    const { status, calls } = await run('remove', ['nmcli', 'nft']);
    expect(status).toBe(0);
    expect(calls).toContain('nft delete table inet nivuus_guest_vpn');
  });

  it.each(['upgrade', 'failed-upgrade', 'deconfigure'])('%s leaves the guest VPN and its table alone', async arg => {
    const { status, calls } = await run(arg);
    expect(status).toBe(0);
    expect(calls.some(c => c.startsWith('nmcli') || c.startsWith('nft'))).toBe(false);
  });
});
