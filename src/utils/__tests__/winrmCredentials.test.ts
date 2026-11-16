// src/utils/__tests__/winrmCredentials.test.ts
//
// The WinRM password follows the rule of every other secret of the agent:
// the environment file wins (it survives package upgrades, which overwrite
// agent.yaml with its placeholder), and a placeholder is never sent.

import { runCommand } from 'winrm-client';
import { createWinRMClient } from '../winrm';
import logger from '../logger';

jest.mock('winrm-client', () => ({ runCommand: jest.fn() }));
const mockedRun = runCommand as jest.MockedFunction<typeof runCommand>;

const windowsVm: { hostname: string; port: number; username?: string; password?: string } = {
  hostname: '192.0.2.1', port: 5985, username: 'Administrator', password: 'CHANGE_ME_PASSWORD',
};
jest.mock('../../config', () => ({
  getConfigManager: jest.fn(() => ({ config: { windows_vm: windowsVm } })),
}));

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {});
  }
  mockedRun.mockResolvedValue('ok');
  windowsVm.password = 'CHANGE_ME_PASSWORD';
  windowsVm.username = 'Administrator';
});

afterEach(() => {
  delete process.env.WINDOWS_ADMIN_PASSWORD;
  delete process.env.WINDOWS_ADMIN_USERNAME;
  jest.restoreAllMocks();
  mockedRun.mockReset();
});

describe('createWinRMClient password', () => {
  it('takes WINDOWS_ADMIN_PASSWORD over the YAML placeholder', async () => {
    process.env.WINDOWS_ADMIN_PASSWORD = 'from-environment';
    await createWinRMClient().executeCommand('hostname');
    expect(mockedRun).toHaveBeenCalledWith('hostname', '192.0.2.1', 'Administrator', 'from-environment', 5985);
  });

  it('takes WINDOWS_ADMIN_PASSWORD over a real YAML value', async () => {
    process.env.WINDOWS_ADMIN_PASSWORD = 'from-environment';
    windowsVm.password = 'from-yaml';
    await createWinRMClient().executeCommand('hostname');
    expect(mockedRun).toHaveBeenCalledWith('hostname', '192.0.2.1', 'Administrator', 'from-environment', 5985);
  });

  it('uses a real YAML password when the environment sets none', async () => {
    windowsVm.password = 'from-yaml';
    await createWinRMClient().executeCommand('hostname');
    expect(mockedRun).toHaveBeenCalledWith('hostname', '192.0.2.1', 'Administrator', 'from-yaml', 5985);
  });

  it.each([['the placeholder', 'CHANGE_ME_PASSWORD'], ['no password', undefined]])(
    'refuses to connect with %s alone', async (_label, password) => {
      windowsVm.password = password;
      await expect(createWinRMClient().executeCommand('hostname')).rejects.toThrow(/WINDOWS_ADMIN_PASSWORD/);
      expect(mockedRun).not.toHaveBeenCalled();
    });
});

// installer's console guest creates the en-US built-in "Administrator"
// (console/guest/autounattend.py); the agent defaulted to the French
// "Administrateur", so WinRM failed against a guest it provisioned.
describe('createWinRMClient username', () => {
  beforeEach(() => { windowsVm.password = 'from-yaml'; });

  it('defaults to the account the console installer creates', async () => {
    delete windowsVm.username;
    await createWinRMClient().executeCommand('hostname');
    expect(mockedRun).toHaveBeenCalledWith('hostname', '192.0.2.1', 'Administrator', 'from-yaml', 5985);
  });

  it('uses the configured account, in any language', async () => {
    windowsVm.username = 'Администратор';
    await createWinRMClient().executeCommand('hostname');
    expect(mockedRun).toHaveBeenCalledWith('hostname', '192.0.2.1', 'Администратор', 'from-yaml', 5985);
  });

  it('takes WINDOWS_ADMIN_USERNAME when the YAML names no account', async () => {
    delete windowsVm.username;
    process.env.WINDOWS_ADMIN_USERNAME = 'nivuus';
    await createWinRMClient().executeCommand('hostname');
    expect(mockedRun).toHaveBeenCalledWith('hostname', '192.0.2.1', 'nivuus', 'from-yaml', 5985);
  });
});
