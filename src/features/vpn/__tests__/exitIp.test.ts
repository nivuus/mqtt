import * as execModule from '../../../utils/exec';
import { EXIT_IP_SERVICE, measureExitIp } from '../exitIp';
import { fail, ok } from './fakeNmcli';

jest.mock('../../../utils/exec');
const mockedExec = execModule as jest.Mocked<typeof execModule>;

describe('measureExitIp', () => {
  beforeEach(() => mockedExec.execute_argv.mockReset());
  const call = () => mockedExec.execute_argv.mock.calls[0];

  it('runs curl --interface <tun> --max-time 10 against ipify, quietly', async () => {
    mockedExec.execute_argv.mockResolvedValue(ok('5.255.103.96\n'));
    await expect(measureExitIp('nvguest0')).resolves.toEqual({ exitIp: '5.255.103.96' });
    const [file, args, opts] = call();
    expect(file).toBe('curl');
    expect(args[args.indexOf('--interface') + 1]).toBe('nvguest0');
    expect(args[args.indexOf('--max-time') + 1]).toBe('10');
    expect(args).toContain(EXIT_IP_SERVICE);
    expect(EXIT_IP_SERVICE).toBe('https://api.ipify.org');
    expect(opts?.timeoutMs).toBeGreaterThan(10000);
    expect(opts?.quiet).toBe(true);
  });

  it('a curl failure is returned as an error, never thrown', async () => {
    mockedExec.execute_argv.mockResolvedValue(fail('curl: (28) Connection timed out after 10001 milliseconds'));
    await expect(measureExitIp('nvguest0')).resolves.toEqual({
      error: 'no exit IP measured through nvguest0: curl: (28) Connection timed out after 10001 milliseconds',
    });
  });

  it('a body that is not an IP address is an error', async () => {
    mockedExec.execute_argv.mockResolvedValue(ok('<html>captive portal</html>'));
    await expect(measureExitIp('nvguest0')).resolves.toEqual({
      error: `no exit IP measured through nvguest0: ${EXIT_IP_SERVICE} returned no IP address`,
    });
  });
});
