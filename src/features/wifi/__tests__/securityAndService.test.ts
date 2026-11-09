// src/features/wifi/__tests__/securityAndService.test.ts

import { validateNetworkConfig } from '../securityProfiles';
import { applyToHostapd } from '../hostapdService';
import { execute_argv } from '../../../utils/exec';

jest.mock('../../../utils/exec', () => ({ execute_argv: jest.fn() }));
const mockedExec = execute_argv as jest.MockedFunction<typeof execute_argv>;

describe('validateNetworkConfig', () => {
  it('counts the SSID limit in bytes, as 802.11 does', () => {
    expect(validateNetworkConfig('a'.repeat(32), 'password1', 'WPA2-PSK')).toBeNull();
    // 11 CJK characters are 33 UTF-8 bytes: over the 32-octet limit.
    expect(validateNetworkConfig('无线网络无线网络无线网', 'password1', 'WPA2-PSK')).toMatch(/bytes/);
    expect(validateNetworkConfig('Café Wi-Fi', 'password1', 'WPA2-PSK')).toBeNull();
  });

  it('accepts an SAE password in any script but keeps WPA2 passphrases ASCII', () => {
    expect(validateNetworkConfig('net', 'пароль-сети', 'WPA3-SAE')).toBeNull();
    expect(validateNetworkConfig('net', 'пароль-сети', 'WPA2-PSK')).toMatch(/ASCII/);
    expect(validateNetworkConfig('net', 'пароль-сети', 'WPA2/WPA3-Mixed')).toMatch(/ASCII/);
  });

  it('rejects line breaks and unknown types', () => {
    expect(validateNetworkConfig('net\nwpa=0', 'password1', 'WPA2-PSK')).toMatch(/invalid/);
    expect(validateNetworkConfig('net', 'pass\nword1', 'WPA3-SAE')).toMatch(/control/);
    expect(validateNetworkConfig('net', 'password1', 'WEP')).toMatch(/Unknown/);
  });

  it('needs no password for an open network', () => {
    expect(validateNetworkConfig('open', '', 'Open')).toBeNull();
  });
});

describe('applyToHostapd', () => {
  beforeEach(() => mockedExec.mockReset());

  it('reports success only when systemctl exits 0', async () => {
    mockedExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    await expect(applyToHostapd('reload')).resolves.toEqual({ ok: true, detail: 'hostapd reloaded' });
    expect(mockedExec).toHaveBeenCalledWith('sudo', ['systemctl', 'reload', 'hostapd'], expect.any(Object));
  });

  it('reports the failure systemctl gave, never success', async () => {
    mockedExec.mockResolvedValue({
      stdout: '', stderr: 'Failed to reload hostapd.service: Job type reload is not applicable for unit hostapd.service.', exitCode: 1,
    });
    const result = await applyToHostapd('reload');
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/not applicable/);
  });
});
