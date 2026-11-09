// src/features/wifi/hostapdService.ts
//
// Reads and writes the hostapd files and makes hostapd use them. Every outcome
// is returned as it really happened: a failed command is never reported as done.

import * as fs from 'fs';
import { execute_argv } from '../../utils/exec';
import logger from '../../utils/logger';

/**
 * How a change reaches hostapd.
 * - reload (SIGHUP): re-reads the files without re-initialising the radios; every client
 *   re-associates (measured 2026-11-09: all 31 back within 25 s). Enough for SSID and
 *   security changes.
 * - restart: needed to create or remove a BSS (a new virtual interface). ~10-20 s outage.
 */
export type ApplyMode = 'reload' | 'restart';

export interface ApplyResult {
  ok: boolean;
  detail: string;
}

export async function readHostapdConfig(filePath: string): Promise<string> {
  const result = await execute_argv('cat', [filePath], { quiet: true });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to read ${filePath}: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
  }
  return result.stdout;
}

export async function writeHostapdConfig(filePath: string, content: string): Promise<void> {
  // KNOWN ISSUE (wifi audit 2026-11-09, point 1, recorded in docs/claude/wifi-known-issues.md,
  // deliberately left as is): the temp file is created under the agent's umask 0022 in /tmp,
  // so the moved file ends up world-readable with the passphrases in it, and /tmp -> /etc
  // is a copy, not an atomic rename.
  const steps: Array<[string, string[]]> = [['cp', [filePath, `${filePath}.backup`]]];
  const tempFile = `/tmp/hostapd_${Date.now()}.conf`;
  fs.writeFileSync(tempFile, content);
  steps.push(['mv', [tempFile, filePath]]);
  for (const [command, args] of steps) {
    const result = await execute_argv('sudo', [command, ...args]);
    if (result.exitCode !== 0) {
      throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
    }
  }
}

export async function applyToHostapd(mode: ApplyMode): Promise<ApplyResult> {
  const result = await execute_argv('sudo', ['systemctl', mode, 'hostapd'], { timeoutMs: 90000 });
  if (result.exitCode === 0) {
    return { ok: true, detail: mode === 'reload' ? 'hostapd reloaded' : 'hostapd restarted' };
  }
  const why = result.stderr.trim() || result.spawnError || `exit ${result.exitCode}`;
  logger.error(`systemctl ${mode} hostapd failed: ${why}`);
  return { ok: false, detail: `systemctl ${mode} hostapd failed: ${why}` };
}
