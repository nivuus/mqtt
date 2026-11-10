// "Performance": history first, then one list per component.

import { list, row, buttonRow, history, section, view } from '../cards.js';
import { CORE_CARD_TYPE } from '../cpu-cores-card.js';

export function performance(m, t) {
  const u = m.ups;
  return view('performance', t('view.performance'), [
    section([
      history([m.cpu.load, m.memory.usage], { title: t('name.load24h') }),
      m.cpu.cores.length && {
        type: CORE_CARD_TYPE, title: t('name.cores'), cores: m.cpu.cores, grid_options: { columns: 'full' },
      },
      history([m.cpu.temp, m.gpu.temp, ...m.board.temps.map((s) => s.entity)], { title: t('name.temps24h') }),
    ], { column_span: 2 }),
    section([
      list(t('section.cpu'), 'mdi:cpu-64-bit', [
        row(m.cpu.load, t('name.cpu')),
        row(m.cpu.temp, t('name.cpuTemp')),
        row(m.cpu.socket, t('name.cpuSocket')),
        row(m.cpu.machineChecks, t('name.machineChecks')),
        row(m.cpu.thermalEvents, t('name.thermalEvents')),
      ]),
      list(t('section.memory'), 'mdi:memory', [
        row(m.memory.usage, t('name.memory')),
        row(m.memory.available, t('name.memoryAvailable')),
        row(m.memory.errors, t('name.memoryErrors')),
      ]),
      list(t('section.gpu'), 'mdi:expansion-card', [
        row(m.gpu.utilization, t('name.gpuLoad')),
        row(m.gpu.temp, t('name.gpuTemp')),
        row(m.gpu.power, t('name.gpuPower')),
        row(m.gpu.pstate, t('name.gpuPstate')),
        row(m.gpu.graphicsClock, t('name.gpuClock')),
        row(m.gpu.memoryClock, t('name.gpuMemClock')),
        row(m.gpu.fan, t('name.gpuFan')),
      ]),
    ]),
    section([
      list(t('section.board'), 'mdi:thermometer', [
        ...m.board.temps.map((s) => row(s.entity, t(`name.temp.${s.key}`))),
        ...m.board.fans.map((e, i) => row(e, t('name.fan', { n: i + 1 }))),
        row(m.board.vcore, t('name.vcore')),
        ...m.board.rails.map((s) => row(s.entity, t(`name.rail.${s.key}`))),
        row(m.board.railDrift, t('name.railDrift')),
      ]),
      list(t('section.ups'), 'mdi:battery-charging', [
        row(u.powerSource, t('name.mains')),
        row(u.status, t('name.upsStatus')),
        row(u.battery, t('name.upsBattery')),
        row(u.runtime, t('name.upsRuntime')),
        row(u.load, t('name.upsLoad')),
        row(u.consumption, t('name.consumption')),
        row(u.inputVoltage, t('name.inputVoltage')),
        row(u.testResult, t('name.upsTestResult')),
        buttonRow(u.testButton, t('action.upsTest'), 'mdi:battery-sync', t('action.run'), t('confirm.upsTest')),
      ]),
    ]),
  ], { max_columns: 2 });
}
