import { runCommand } from 'winrm-client';
import { WinRMClient } from '../winrm';
import logger from '../logger';

jest.mock('winrm-client', () => ({ runCommand: jest.fn() }));
const mockedRun = runCommand as jest.MockedFunction<typeof runCommand>;
const client = new WinRMClient({ hostname: '192.0.2.1', username: 'u', password: 'p', port: 5985 });

beforeEach(() => jest.spyOn(logger, 'error').mockImplementation(() => logger));
afterEach(() => jest.restoreAllMocks());

describe('WinRMClient', () => {
  it('runs the command line through cmd.exe and returns its output', async () => {
    mockedRun.mockResolvedValue('C: 42');
    await expect(client.executeCommand('smartctl -j -a /dev/sda')).resolves.toBe('C: 42');
    expect(mockedRun).toHaveBeenCalledWith('smartctl -j -a /dev/sda', '192.0.2.1', 'u', 'p', 5985);
  });

  it('rejects when the VM cannot be reached, so no caller parses an error as output', async () => {
    mockedRun.mockRejectedValue(new Error('connect EHOSTUNREACH 192.0.2.1:5985'));
    await expect(client.executeCommand('hostname')).rejects.toThrow('EHOSTUNREACH');
    await expect(client.isProcessRunning('sunshine.exe')).resolves.toBe(false);
  });
});
