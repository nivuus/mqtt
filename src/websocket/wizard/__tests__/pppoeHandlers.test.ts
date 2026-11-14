// src/websocket/wizard/__tests__/pppoeHandlers.test.ts
//
// The wizard's PPPoE actions on an in-memory host: credentials are written byte for
// byte, nothing is written when the profile cannot be read, and every failure of the
// write or of nmcli reaches the caller.

import { createPppoeHandlers } from '../pppoeHandlers';
import { createFakeHost, FakeHost } from './fakeHost';
import { execute_argv } from '../../../utils/exec';
import { writeFileAtomic0600 } from '../../../features/vpn/atomicFile';

jest.mock('../../../utils/exec', () => ({ execute_argv: jest.fn(), execute_command: jest.fn() }));
jest.mock('../../../features/vpn/atomicFile', () => ({ writeFileAtomic0600: jest.fn() }));
jest.mock('fs', () => ({ ...jest.requireActual('fs'), writeFileSync: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockedFs = require('fs') as { writeFileSync: jest.Mock };
const mockedExec = execute_argv as jest.MockedFunction<typeof execute_argv>;
const mockedAtomic = writeFileAtomic0600 as jest.MockedFunction<typeof writeFileAtomic0600>;

const PROFILE = '/etc/NetworkManager/system-connections/pppoe-enp6s0.835.nmconnection';
const CONNECTION = 'pppoe-enp6s0.835';
const ORIGINAL = [
  '[connection]',
  `id=${CONNECTION}`,
  'type=pppoe',
  '',
  '[pppoe]',
  'parent=enp6s0.835',
  'password=old-secret',
  'username=old-user',
  '',
  '[ipv4]',
  'method=auto',
  '',
].join('\n');

let host: FakeHost;
let pppoe: ReturnType<typeof createPppoeHandlers>;

beforeEach(() => {
  host = createFakeHost({ [PROFILE]: ORIGINAL });
  mockedExec.mockImplementation((command, args) => host.exec(command, args) as never);
  mockedFs.writeFileSync.mockImplementation((path: string, content: string) => host.writeFileSync(path, content));
  mockedAtomic.mockImplementation(async (path, content) => { host.files.set(path, content); });
  pppoe = createPppoeHandlers();
});

const pppoeSection = (content: string) => content.split('[pppoe]\n')[1].split('\n\n')[0].split('\n').sort();

describe('pppoe.set_credentials writes the values byte for byte', () => {
  it.each([
    ["a$$b$&c$'d$1"],
    ['пароль-日本語-كلمة'],
  ])('%s', async (password) => {
    await expect(pppoe.set_credentials({ username: 'user$&', password })).resolves.toEqual({ success: true });
    const written = host.files.get(PROFILE)!;
    expect(pppoeSection(written)).toEqual(['parent=enp6s0.835', `password=${password}`, 'username=user$&']);
    // Everything outside the [pppoe] section is unchanged.
    expect(written.split('[pppoe]')[0]).toBe(ORIGINAL.split('[pppoe]')[0]);
    expect(written.split('[ipv4]')[1]).toBe(ORIGINAL.split('[ipv4]')[1]);
  });
});

describe('pppoe.set_credentials reports failures', () => {
  const profileWrites = () => [...host.calls.filter((c) => c.args[0] === 'mv' && c.args[2] === PROFILE),
    ...mockedAtomic.mock.calls.filter(([path]) => path === PROFILE)];

  it('rejects and writes nothing when the profile cannot be read', async () => {
    host.exitCodes.set(`sudo cat ${PROFILE}`, 1);
    await expect(pppoe.set_credentials({ username: 'u', password: 'p' })).rejects.toThrow(/read/);
    expect(profileWrites()).toEqual([]);
    expect(host.files.has(`${PROFILE}.backup`)).toBe(false);
    expect(host.files.get(PROFILE)).toBe(ORIGINAL);
  });

  it('rejects and writes nothing when the profile has no [pppoe] section', async () => {
    host.files.set(PROFILE, '[connection]\nid=x\n');
    await expect(pppoe.set_credentials({ username: 'u', password: 'p' })).rejects.toThrow(/\[pppoe\]/);
    expect(profileWrites()).toEqual([]);
  });

  it('rejects when the file cannot be replaced', async () => {
    // Whatever the write path is (a moved temp file or an atomic rename), its failure must surface.
    mockedExec.mockImplementation(async (command, args) => {
      if (command === 'sudo' && (args[0] === 'mv' || args[0] === 'cp')) return { stdout: '', stderr: 'denied', exitCode: 1 };
      return host.exec(command, args) as never;
    });
    mockedAtomic.mockRejectedValue(new Error('EACCES: rename failed'));
    await expect(pppoe.set_credentials({ username: 'u', password: 'p' })).rejects.toThrow();
  });
});

describe('pppoe.restart reports failures', () => {
  const nmcli = () => host.calls.filter((c) => c.args[0] === 'nmcli').map((c) => c.args.slice(1).join(' '));

  it('takes an active link down, then up, and succeeds only then', async () => {
    mockedExec.mockImplementation(async (command, args) => {
      if (args.includes('--active')) {
        host.calls.push({ command, args });
        return { stdout: `lo\n${CONNECTION}\n`, stderr: '', exitCode: 0 };
      }
      return host.exec(command, args) as never;
    });
    await expect(pppoe.restart({})).resolves.toEqual({ success: true });
    expect(nmcli()).toEqual([
      'connection reload', '-g NAME connection show --active',
      `connection down ${CONNECTION}`, `connection up ${CONNECTION}`,
    ]);
  });

  it('rejects when nmcli cannot take the active link down', async () => {
    mockedExec.mockImplementation(async (command, args) => {
      if (args.includes('--active')) return { stdout: `${CONNECTION}\n`, stderr: '', exitCode: 0 };
      if (args.includes('down')) return { stdout: '', stderr: 'deactivation failed', exitCode: 5 };
      return host.exec(command, args) as never;
    });
    await expect(pppoe.restart({})).rejects.toThrow(/down/);
  });

  it('rejects when nmcli cannot bring the connection up', async () => {
    host.exitCodes.set(`sudo nmcli connection up ${CONNECTION}`, 4);
    await expect(pppoe.restart({})).rejects.toThrow(/up/);
  });

  it('rejects when nmcli cannot reload the profiles, without touching the link', async () => {
    host.exitCodes.set('sudo nmcli connection reload', 1);
    await expect(pppoe.restart({})).rejects.toThrow(/reload/);
    expect(nmcli()).toEqual(['connection reload']);
  });
});
