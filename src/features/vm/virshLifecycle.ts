// src/features/vm/virshLifecycle.ts
//
// The one place that turns a VM lifecycle action into a `virsh` call, shared by the MQTT
// VmManager and the wizard's vm handlers so the two can never drift apart again.

import { CommandResult, execute_argv } from '../../utils/exec';

export type VmAction = 'start' | 'stop' | 'restart' | 'force_stop' | 'pause' | 'resume';

// NOTE: "--mode acpi" is mandatory for stop/restart. On libvirt 11.x the default
// shutdown/reboot mode does NOT deliver the ACPI power-button event to a Windows guest
// without a qemu-guest-agent (it reports "in progress" then nothing happens). "--mode acpi"
// maps to QMP system_powerdown, which the guest honours (verified 2026-07-17). Guests with
// qemu-ga could also use "--mode agent"; this VM has no agent channel, so ACPI is the
// reliable path. `destroy` is the forceful power-off.
const SUBCOMMANDS: Record<VmAction, readonly string[]> = {
  start: ['start'],
  stop: ['shutdown', '--mode', 'acpi'],
  restart: ['reboot', '--mode', 'acpi'],
  force_stop: ['destroy'],
  pause: ['suspend'],
  resume: ['resume'],
};

/** The full virsh argv for `action` on `vmName` (the name must already be validated). */
export function virshLifecycleArgv(action: VmAction, vmName: string): string[] {
  return ['-c', 'qemu:///system', ...SUBCOMMANDS[action], vmName];
}

/**
 * Run `action` on `vmName` and throw when virsh fails: execute_argv resolves with the exit
 * code instead of rejecting, so a failed call must never be reported as a success.
 */
export async function runVmAction(action: VmAction, vmName: string): Promise<CommandResult> {
  const argv = virshLifecycleArgv(action, vmName);
  const result = await execute_argv('virsh', argv);
  if (result.exitCode !== 0) {
    const reason = result.stderr.trim() || result.spawnError || `exit code ${result.exitCode}`;
    throw new Error(`virsh ${argv.slice(2).join(' ')} failed: ${reason}`);
  }
  return result;
}
