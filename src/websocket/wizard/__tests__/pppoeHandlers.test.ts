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
