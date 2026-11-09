// src/websocket/wizard/systemHandlers.ts
//
// NOTE: every command in this group is a fixed literal with NO wizard / MQTT
// input. Where a shell is still used (execute_command) it is only for pipes,
// redirections or `||` fallbacks — never with an interpolated external value.

import { FeatureHandlers } from '../types';
import { execute_command, execute_argv } from '../../utils/exec';
import { getConfigManager } from '../../config';

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let value = bytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function parseCpuStat(line: string): { idle: number; total: number } {
  const parts = line.split(/\s+/).slice(1).map(Number);
  const idle = parts[3] + (parts[4] || 0);
  const total = parts.reduce((a, b) => a + b, 0);
  return { idle, total };
}

function parseSensorTemperatures(json: string): Record<string, number> {
  const temperatures: Record<string, number> = {};
  try {
    const sensorsData = JSON.parse(json);
    for (const [, data] of Object.entries(sensorsData)) {
      if (typeof data === 'object' && data !== null) {
        for (const [sensor, values] of Object.entries(data as Record<string, any>)) {
          if (typeof values === 'object' && values !== null) {
            for (const [key, temp] of Object.entries(values)) {
              if (key.includes('input') && typeof temp === 'number') {
                const name = sensor.replace(/_/g, ' ').replace('temp', 'Core');
                temperatures[name] = Math.round(temp);
              }
            }
          }
        }
      }
    }
  } catch { /* Ignore parse errors */ }
  return temperatures;
}

async function getInfo(): Promise<unknown> {
  // Kept from the original handler: initialises the config singleton if the
  // entry point has not (its value is not used here).
  getConfigManager();
  const [hostname, uptime, kernel, osRelease, cpuInfo, memInfo] = await Promise.all([
    execute_argv('hostname', []),
    execute_argv('uptime', ['-p']),
    execute_argv('uname', ['-r']),
    execute_command('cat /etc/os-release 2>/dev/null || echo "ID=linux"', false),
    execute_argv('lscpu', []),
    execute_argv('free', ['-b']),
  ]);

  // Parse OS name
  const osMatch = osRelease.stdout.match(/PRETTY_NAME="?([^"\n]+)"?/);
  const os = osMatch ? osMatch[1] : 'Linux';

  // Parse CPU info
  const cpuModelMatch = cpuInfo.stdout.match(/Model name:\s*(.+)/);
  const cpuCoresMatch = cpuInfo.stdout.match(/CPU\(s\):\s*(\d+)/);

  // Parse memory
  const memLines = memInfo.stdout.split('\n');
  const memMatch = memLines[1]?.match(/\d+/g);
  const memTotal = memMatch ? parseInt(memMatch[0]) : 0;

  // Parse disk (pipe chain → shell; fixed literal, no external input)
  const diskResult = await execute_command("df -B1 / | tail -1 | awk '{print $2}'", false);
  const diskTotal = parseInt(diskResult.stdout.trim()) || 0;

  return {
    hostname: hostname.stdout.trim(),
    os,
    kernel: kernel.stdout.trim(),
    uptime: uptime.stdout.trim().replace('up ', ''),
    cpu_model: cpuModelMatch ? cpuModelMatch[1].trim() : 'Unknown',
    cpu_cores: cpuCoresMatch ? parseInt(cpuCoresMatch[1]) : 0,
    memory_total: formatBytes(memTotal),
    disk_total: formatBytes(diskTotal),
  };
}

async function getStatus(): Promise<unknown> {
  const [cpuStat1, memInfo, diskInfo, loadAvg, temps] = await Promise.all([
    execute_argv('head', ['-1', '/proc/stat']),
    execute_argv('free', ['-b']),
    execute_command("df -B1 / | tail -1", false), // pipe → shell; fixed literal
    execute_argv('cat', ['/proc/loadavg']),
    execute_command("sensors -j 2>/dev/null || echo '{}'", false), // || → shell; fixed literal
  ]);

  // Wait 100ms and get second CPU reading for accurate usage
  await new Promise(resolve => setTimeout(resolve, 100));
  const cpuStat2 = await execute_argv('head', ['-1', '/proc/stat']);

  // Calculate CPU usage
  const stat1 = parseCpuStat(cpuStat1.stdout);
  const stat2 = parseCpuStat(cpuStat2.stdout);
  const idleDiff = stat2.idle - stat1.idle;
  const totalDiff = stat2.total - stat1.total;
  const cpuUsage = totalDiff > 0 ? ((totalDiff - idleDiff) / totalDiff) * 100 : 0;

  // Parse memory
  const memLines = memInfo.stdout.split('\n');
  const memMatch = memLines[1]?.match(/\d+/g);
  const memTotal = memMatch ? parseInt(memMatch[0]) : 0;
  const memUsed = memMatch ? parseInt(memMatch[1]) : 0;

  // Parse disk
  const diskParts = diskInfo.stdout.trim().split(/\s+/);
  const diskTotal = parseInt(diskParts[1]) || 0;
  const diskUsed = parseInt(diskParts[2]) || 0;

  // Parse load average
  const loadParts = loadAvg.stdout.trim().split(/\s+/);
  const loadAverage = loadParts.slice(0, 3).map(parseFloat);

  return {
    cpu_usage: cpuUsage,
    memory_used: memUsed,
    memory_total: memTotal,
    disk_used: diskUsed,
    disk_total: diskTotal,
    load_average: loadAverage,
    temperatures: parseSensorTemperatures(temps.stdout),
  };
}

export function createSystemHandlers(): FeatureHandlers {
  return {
    get_info: getInfo,
    get_status: getStatus,

    check_updates: async () => {
      await execute_argv('sudo', ['apt-get', 'update']);
      // pipe + redirect → shell; fixed literal, no external input
      const result = await execute_command('apt list --upgradable 2>/dev/null | grep -v "^Listing"', false);
      const updates = result.stdout.trim().split('\n').filter(line => line.length > 0);
      return { count: updates.length, packages: updates };
    },

    apply_updates: async () => {
      await execute_argv('sudo', ['apt-get', 'upgrade', '-y']);
      return { success: true };
    },
  };
}
