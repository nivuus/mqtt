// src/websocket/wizard/vmHandlers.ts

import { FeatureHandlers, ActionHandler } from '../types';
import { execute_argv } from '../../utils/exec';
import { Validators } from '../../utils/validators';

/** Read and validate the wizard-controlled VM name before it reaches virsh. */
function requireVmName(params: Record<string, unknown>): string {
  const { vmName } = params as { vmName: string };
  if (!vmName) throw new Error('Missing vmName parameter');
  if (!Validators.isVmName(vmName)) throw new Error('Invalid vmName parameter');
  return vmName;
}

/** A lifecycle action: one `virsh <subcommand> <vm>` call. */
function virshAction(subcommand: string, action: string): ActionHandler {
  return async (params) => {
    const vmName = requireVmName(params);
    await execute_argv('virsh', [subcommand, vmName]);
    return { success: true, vmName, action };
  };
}

async function listVms(): Promise<unknown> {
  const result = await execute_argv('virsh', ['list', '--all']);
  if (result.exitCode !== 0) throw new Error('Failed to list VMs');

  const lines = result.stdout.split('\n').slice(2); // Skip header
  const vms: Array<{
    name: string;
    state: string;
    cpu_count?: number;
    memory_mb?: number;
    disk_gb?: number;
    os_type?: string;
    autostart?: boolean;
  }> = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      const name = parts[1];
      const state = parts.slice(2).join(' ') || 'unknown';
      if (!name) continue;
      // name comes from virsh output; validate before it is passed back to virsh.
      if (!Validators.isVmName(name)) continue;

      // Get VM details via argv, parsing the previously piped grep/awk in JS.
      const [vcpuResult, dominfoResult, xmlResult] = await Promise.all([
        execute_argv('virsh', ['vcpucount', name, '--current']),
        execute_argv('virsh', ['dominfo', name]),
        execute_argv('virsh', ['dumpxml', name]),
      ]);

      const cpuCount = parseInt(vcpuResult.stdout.trim()) || 0;
      const memMatch = dominfoResult.stdout.match(/^Max memory:\s*(\d+)/m);
      const memKb = memMatch ? parseInt(memMatch[1]) : 0;
      const autostartMatch = dominfoResult.stdout.match(/^Autostart:\s*(\S+)/m);
      const autostart = (autostartMatch?.[1] || '').toLowerCase() === 'enable';

      // Try to get OS type from domain XML
      const osMatch = xmlResult.stdout.match(/<os_type>([^<]+)<\/os_type>/);
      const osType = osMatch ? osMatch[1].trim() : undefined;

      vms.push({
        name,
        state,
        cpu_count: cpuCount > 0 ? cpuCount : undefined,
        memory_mb: memKb > 0 ? Math.round(memKb / 1024) : undefined,
        os_type: osType,
        autostart,
      });
    }
  }

  return vms;
}

export function createVmHandlers(): FeatureHandlers {
  return {
    list_vms: listVms,

    get_state: async (params) => {
      const vmName = requireVmName(params);
      const result = await execute_argv('virsh', ['domstate', vmName]);
      return { vmName, state: result.stdout.trim() };
    },

    start_vm: virshAction('start', 'start'),
    stop_vm: virshAction('shutdown', 'stop'),
    restart_vm: virshAction('reboot', 'restart'),
    force_stop_vm: virshAction('destroy', 'force_stop'),
    pause_vm: virshAction('suspend', 'pause'),
    resume_vm: virshAction('resume', 'resume'),
  };
}
