// Hardware side of the model: CPU, memory, GPU, sensors, power, storage.

import { naturalCompare } from './lookup.js';

export function cpu(q) {
  const cores = new Map();
  for (const { match, entityId } of q.all('cpu_load_core_(\\d+)_load')) {
    cores.set(match[1], { n: Number(match[1]), load: entityId });
  }
  for (const { match, entityId } of q.all('cpu_temperature_core_(\\d+)_temp')) {
    const core = cores.get(match[1]) ?? { n: Number(match[1]) };
    core.temp = entityId;
    cores.set(match[1], core);
  }
  return {
    load: q.id('cpu_load_avg_load'),
    temp: q.id('cpu_temperature_main_temp'),
    socket: q.id('cpu_socket_temperature'),
    cores: [...cores.values()].sort((a, b) => a.n - b.n),
    machineChecks: q.id('cpu_machine_checks'),
    thermalEvents: q.id('cpu_thermal_events'),
  };
}

export function memory(q) {
  return {
    usage: q.id('memory_usage_usage_percent'),
    available: q.id('memory_usage_available_mb'),
    errors: q.id('memory_errors'),
  };
}

export function gpu(q) {
  return {
    temp: q.id('gpu_temperature'),
    utilization: q.id('gpu_utilization'),
    power: q.id('gpu_power'),
    graphicsClock: q.id('gpu_clock_graphics'),
    memoryClock: q.id('gpu_clock_memory'),
    pstate: q.id('gpu_pstate'),
    fan: q.id('gpu_fan_speed'),
  };
}

export function board(q) {
  return {
    temps: [
      { key: 'nvme', entity: q.id('nvme_temperature') },
      { key: 'pch', entity: q.id('pch_temperature') },
      { key: 'system', entity: q.id('system_temperature') },
    ].filter((s) => s.entity),
    fans: q.all('chassis_fan(\\d+)')
      .sort((a, b) => naturalCompare(a.match[1], b.match[1]))
      .map((r) => r.entityId),
    vcore: q.id('vcore'),
    rails: [
      { key: '12v', entity: q.id('psu_12v') },
      { key: '5v', entity: q.id('psu_5v') },
    ].filter((s) => s.entity),
    railDrift: q.id('max_rail_drift'),
  };
}

export function ups(q) {
  return {
    status: q.id('ups_monitor_status'),
    powerSource: q.id('ups_monitor_power_source'),
    battery: q.id('ups_monitor_battery_level'),
    runtime: q.id('ups_monitor_runtime'),
    load: q.id('ups_monitor_load'),
    inputVoltage: q.id('ups_monitor_input_voltage'),
    consumption: q.id('ups_monitor_power_consumption'),
    testResult: q.id('ups_monitor_test_result'),
    testButton: q.id('ups_monitor_battery_test'),
  };
}

/**
 * Mounted filesystems. The label is the mount point the agent reports, never
 * the entity name: on the reference host the entity named "media data" is
 * mounted on /media/backup and vice versa.
 */
export function filesystems(q) {
  return q.all('disk_usage_(.+)_usage_percent')
    .map(({ match, entityId }) => ({
      key: match[1],
      usage: entityId,
      available: q.id(`disk_usage_${match[1]}_available_gb`),
      mount: q.attr(entityId, 'mount_point') ?? match[1],
      totalGb: q.attr(entityId, 'total_gb'),
    }))
    .sort((a, b) => naturalCompare(a.mount, b.mount));
}

const NO_DATA = new Set([undefined, 'unknown', 'unavailable', 'UNKNOWN']);

/**
 * Block devices with SMART data. Devices that never produced any (network
 * block devices, card readers) are left out: they have no health, no
 * counters, nothing a card could show.
 */
export function disks(q) {
  return q.all('smart_status_(.+)_smart_health')
    .map(({ match, entityId }) => {
      const name = match[1];
      return {
        name,
        health: entityId,
        read: q.id(`smart_status_${name}_read_speed`),
        write: q.id(`smart_status_${name}_write_speed`),
        totalRead: q.id(`smart_status_${name}_lbas_read`),
        totalWritten: q.id(`smart_status_${name}_lbas_written`),
      };
    })
    .filter((d) => {
      const health = q.state(d.health)?.state;
      const total = q.state(d.totalRead)?.state;
      return !(NO_DATA.has(health) && NO_DATA.has(total));
    })
    .sort((a, b) => naturalCompare(a.name, b.name));
}

export function storage(q) {
  return {
    filesystems: filesystems(q),
    disks: disks(q),
    hardwareErrors: q.id('disk_errors'),
    windowsDisk: {
      usage: q.id('windows_disk_usage_windows_disk_c_usage_percent'),
      available: q.id('windows_disk_usage_windows_disk_c_available_gb'),
      read: q.id('windows_disk_usage_windows_disk_c_read_speed'),
      write: q.id('windows_disk_usage_windows_disk_c_write_speed'),
    },
  };
}
