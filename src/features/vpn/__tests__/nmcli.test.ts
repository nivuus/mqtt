import * as execModule from '../../../utils/exec';
import { nmcli } from '../nmcli';

jest.mock('../../../utils/exec');
const mockedExec = execModule as jest.Mocked<typeof execModule>;

describe('nmcli', () => {
  beforeEach(() => {
    mockedExec.execute_argv.mockReset();
    mockedExec.execute_argv.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
  });
  const optsOfLastCall = () => mockedExec.execute_argv.mock.calls.at(-1)![2];

  it('runs read-only "connection show" queries quietly (they run on every tick)', async () => {
    await nmcli(['-g', 'NAME,UUID', 'connection', 'show']);
    expect(optsOfLastCall()).toMatchObject({ quiet: true });
    await nmcli(['-t', '-f', 'GENERAL.STATE', 'connection', 'show', 'uuid', 'u']);
    expect(optsOfLastCall()).toMatchObject({ quiet: true });
  });

  it('logs every command that changes NetworkManager at the default level', async () => {
    await nmcli(['connection', 'up', 'uuid', 'u', 'ifname', 'publicBridge'], 120000);
    expect(optsOfLastCall()).toEqual({ timeoutMs: 120000, quiet: false });
    await nmcli(['connection', 'down', 'uuid', 'u']);
    expect(optsOfLastCall()).toMatchObject({ quiet: false });
  });
});
