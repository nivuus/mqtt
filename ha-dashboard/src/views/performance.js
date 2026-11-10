// "Performance": CPU, memory, GPU, board sensors and power.

import {
  heading, tile, trendTile, gaugeTile, pressTile, history, section, view,
} from '../cards.js';
import { CORE_CARD_TYPE } from '../cpu-cores-card.js';

export function performance(m, t) {
  return view('performance', t('view.performance'), 'mdi:chart-line', [
    cpu(m, t),
    memory(m, t),
    gpu(m, t),
    board(m, t),
    ups(m, t),
  ]);
}

function cpu(m, t) {
  return section([
    heading(t('section.cpu'), 'mdi:cpu-64-bit'),
    history([m.cpu.load], { title: t('name.cpuLoad24h') }),
    m.cpu.cores.length && {
      type: CORE_CARD_TYPE,
      title: t('name.cores'),
      cores: m.cpu.cores,
      grid_options: { columns: 'full' },
    },
    trendTile(m.cpu.temp, { name: t('name.cpuTemp') }),
    tile(m.cpu.socket, { name: t('name.cpuSocket') }),
    tile(m.cpu.machineChecks, { name: t('name.machineChecks') }),
    tile(m.cpu.thermalEvents, { name: t('name.thermalEvents') }),
  ], { column_span: 2 });
}

function memory(m, t) {
  return section([
    heading(t('section.memory'), 'mdi:memory'),
    history([m.memory.usage], { title: t('name.memory24h') }),
    gaugeTile(m.memory.usage, { name: t('name.memory') }),
    tile(m.memory.available, { name: t('name.memoryAvailable') }),
    tile(m.memory.errors, { name: t('name.memoryErrors') }),
  ], { column_span: 2 });
}

function gpu(m, t) {
  return section([
    heading(t('section.gpu'), 'mdi:expansion-card'),
    trendTile(m.gpu.utilization, { name: t('name.gpuLoad') }),
    trendTile(m.gpu.temp, { name: t('name.gpuTemp') }),
    trendTile(m.gpu.power, { name: t('name.gpuPower') }),
    tile(m.gpu.pstate, { name: t('name.gpuPstate') }),
    tile(m.gpu.graphicsClock, { name: t('name.gpuClock') }),
    tile(m.gpu.memoryClock, { name: t('name.gpuMemClock') }),
    tile(m.gpu.fan, { name: t('name.gpuFan') }),
  ]);
}

function board(m, t) {
  return section([
    heading(t('section.board'), 'mdi:thermometer'),
    ...m.board.temps.map((s) => trendTile(s.entity, { name: t(`name.temp.${s.key}`) })),
    ...m.board.fans.map((e, i) => trendTile(e, { name: t('name.fan', { n: i + 1 }) })),
    tile(m.board.vcore, { name: t('name.vcore') }),
    ...m.board.rails.map((s) => tile(s.entity, { name: t(`name.rail.${s.key}`) })),
    tile(m.board.railDrift, { name: t('name.railDrift') }),
  ]);
}

function ups(m, t) {
  const u = m.ups;
  return section([
    heading(t('section.ups'), 'mdi:battery-charging'),
    tile(u.powerSource, { name: t('name.mains') }),
    tile(u.status, { name: t('name.upsStatus') }),
    gaugeTile(u.battery, { name: t('name.upsBattery') }),
    tile(u.runtime, { name: t('name.upsRuntime') }),
    gaugeTile(u.load, { name: t('name.upsLoad') }),
    trendTile(u.consumption, { name: t('name.consumption') }),
    trendTile(u.inputVoltage, { name: t('name.inputVoltage') }),
    tile(u.testResult, { name: t('name.upsTestResult') }),
    pressTile(u.testButton, t('action.upsTest'), 'mdi:battery-sync', t('confirm.upsTest')),
  ]);
}
