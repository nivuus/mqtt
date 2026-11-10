import * as execModule from '../../../utils/exec';
import { zoneMasquerade } from '../firewallQueries';

jest.mock('../../../utils/exec');
const mockedExec = execModule as jest.Mocked<typeof execModule>;

function answer(exitCode: number, stderr = '') {
  mockedExec.execute_argv.mockResolvedValue({ stdout: '', stderr, exitCode });
}

describe('zoneMasquerade', () => {
  it('reads exit code 0 as yes and 1 as no, declaring 1 as an answer', async () => {
    answer(0);
    await expect(zoneMasquerade('external')).resolves.toBe(true);
    answer(1);
    await expect(zoneMasquerade('trusted')).resolves.toBe(false);
    expect(mockedExec.execute_argv).toHaveBeenCalledWith(
      'firewall-cmd', ['--zone=trusted', '--query-masquerade'], { answerExitCodes: [1] });
  });

  it('fails instead of answering "no" when firewalld cannot answer', async () => {
    answer(252, 'FirewallD is not running');
    await expect(zoneMasquerade('home')).rejects.toThrow(/exit 252.*not running/);
  });
});
