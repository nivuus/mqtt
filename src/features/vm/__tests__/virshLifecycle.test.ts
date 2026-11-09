import * as execModule from '../../../utils/exec';
import { runVmAction, virshLifecycleArgv } from '../virshLifecycle';
import { createVmHandlers } from '../../../websocket/wizard/vmHandlers';

const ok = { stdout: 'Domain is being shutdown\n', stderr: '', exitCode: 0 };
const failed = { stdout: '', stderr: "error: failed to get domain 'Windows'\n", exitCode: 1 };

describe('virshLifecycle', () => {
  let exec: jest.SpyInstance;

  beforeEach(() => {
    exec = jest.spyOn(execModule, 'execute_argv').mockResolvedValue(ok);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['stop', ['shutdown', '--mode', 'acpi']],
    ['restart', ['reboot', '--mode', 'acpi']],
    ['start', ['start']],
    ['force_stop', ['destroy']],
    ['pause', ['suspend']],
    ['resume', ['resume']],
  ] as const)('maps %s to virsh %j on the system connection', (action, sub) => {
    expect(virshLifecycleArgv(action, 'Windows')).toEqual(['-c', 'qemu:///system', ...sub, 'Windows']);
  });

  it('throws with virsh stderr when the call fails', async () => {
    exec.mockResolvedValue(failed);
    await expect(runVmAction('stop', 'Windows')).rejects.toThrow(
      "virsh shutdown --mode acpi Windows failed: error: failed to get domain 'Windows'",
    );
  });

  it('names the spawn error when virsh cannot run', async () => {
    exec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 1, spawnError: 'ENOENT' });
    await expect(runVmAction('start', 'Windows')).rejects.toThrow('failed: ENOENT');
  });

  describe('wizard vm handlers', () => {
    const handlers = createVmHandlers();

    it.each([
      ['stop_vm', 'shutdown'],
      ['restart_vm', 'reboot'],
    ])('%s sends the ACPI mode', async (name, sub) => {
      await expect(handlers[name]({ vmName: 'Windows' })).resolves.toMatchObject({ success: true });
      expect(exec).toHaveBeenCalledWith('virsh', ['-c', 'qemu:///system', sub, '--mode', 'acpi', 'Windows']);
    });

    it('rejects instead of reporting success when virsh fails', async () => {
      exec.mockResolvedValue(failed);
      await expect(handlers.stop_vm({ vmName: 'Windows' })).rejects.toThrow('failed to get domain');
    });

    it('get_state rejects when virsh fails', async () => {
      exec.mockResolvedValue(failed);
      await expect(handlers.get_state({ vmName: 'Windows' })).rejects.toThrow('virsh domstate failed');
    });
  });
});
