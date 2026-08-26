// src/features/gpu/GpuMonitoring.ts

import { BaseFeature } from '../../core/BaseFeature';
import { MqttClient, HaDiscoveryPayload } from '../../core/types';
import { createWinRMClient } from '../../utils/winrm';
import { isWindowsVmRunning } from '../../utils/vmState';
import logger from '../../utils/logger';

interface GpuMetrics {
  temperature: number;
  utilization: number;
  powerDraw: number;
  clockGraphics: number;
  clockMemory: number;
  fanSpeed: number;
  pstate: string;
}

/**
 * GPU Monitoring feature using nvidia-smi via WinRM (winvm)
 * GPU is passthrough to Windows VM via VFIO
 */
export class GpuMonitoring extends BaseFeature {
  private metrics: GpuMetrics | null = null;
  private winrmClient = createWinRMClient();

  async publishDiscovery(): Promise<void> {
    const entities = [
      {
        id: 'gpu_temperature',
        name: 'VM GPU Temperature Sensor',
        unit: '°C',
        icon: 'mdi:thermometer',
        deviceClass: 'temperature',
      },
      {
        id: 'gpu_utilization',
        name: 'VM GPU Utilization Sensor',
        unit: '%',
        icon: 'mdi:chip',
        deviceClass: 'power_factor',
      },
      {
        id: 'gpu_power',
        name: 'VM GPU Power Draw Sensor',
        unit: 'W',
        icon: 'mdi:lightning-bolt',
        deviceClass: 'power',
      },
      {
        id: 'gpu_clock_graphics',
        name: 'VM GPU Graphics Clock Sensor',
        unit: 'MHz',
        icon: 'mdi:speedometer',
      },
      {
        id: 'gpu_clock_memory',
        name: 'VM GPU Memory Clock Sensor',
        unit: 'MHz',
        icon: 'mdi:memory',
      },
      {
        id: 'gpu_fan_speed',
        name: 'VM GPU Fan Speed Sensor',
        unit: '%',
        icon: 'mdi:fan',
      },
      {
        id: 'gpu_pstate',
        name: 'VM GPU Performance State Sensor',
        icon: 'mdi:state-machine',
      },
    ];

    for (const entity of entities) {
      const payload: HaDiscoveryPayload = {
        unique_id: `${this.deviceInfo.identifiers[0]}_${entity.id}`,
        name: `${entity.name}`,
        state_topic: this.prefixTopic(`${this.featureName}/${entity.id}/state`),
        availability_topic: this.availabilityTopic,
        payload_available: this.payloadAvailable,
        payload_not_available: this.payloadNotAvailable,
        device: this.deviceInfo,
        icon: entity.icon,
        entity_category: 'diagnostic',
      };

      if (entity.unit) {
        payload.unit_of_measurement = entity.unit;
      }
      if (entity.deviceClass) {
        payload.device_class = entity.deviceClass;
      }

      const discoveryTopic = `homeassistant/sensor/${this.deviceInfo.identifiers[0]}/${payload.unique_id}/config`;
      await this.mqttClient.publish(discoveryTopic, JSON.stringify(payload), { qos: 1, retain: true });
    }
  }

  async update(): Promise<void> {
    if (!await isWindowsVmRunning()) {
      logger.debug(`[${this.featureName}] Windows VM not running, skipping`);
      return;
    }
    try {
      // Query GPU via WinRM directly - no child_process spawning!
      logger.debug('Querying GPU metrics via WinRM...');
      const result = await this.winrmClient.getNvidiaStats();

      if (!result || result.trim().length === 0) {
        logger.error('Failed to query GPU metrics via WinRM: empty response');
        return;
      }

      // Parse CSV output: temp, util, power, clock_gfx, clock_mem, fan, pstate
      const values = result.trim().split(',').map(v => v.trim());

      if (values.length !== 7) {
        logger.error(`Unexpected nvidia-smi output format: got ${values.length} values instead of 7`);
        logger.debug(`Raw output: ${result}`);
        return;
      }

      this.metrics = {
        temperature: parseFloat(values[0]),
        utilization: parseFloat(values[1]),
        powerDraw: parseFloat(values[2]),
        clockGraphics: parseFloat(values[3]),
        clockMemory: parseFloat(values[4]),
        fanSpeed: parseFloat(values[5]),
        pstate: values[6],
      };

      logger.debug(`GPU metrics: ${this.metrics.temperature}°C, ${this.metrics.utilization}%, ${this.metrics.powerDraw}W`);

      // Publish metrics
      await this.publishMetrics();
    } catch (error) {
      logger.error('Error updating GPU metrics:', error);
    }
  }

  private async publishMetrics(): Promise<void> {
    if (!this.metrics) {
      return;
    }

    const metrics = [
      { id: 'gpu_temperature', value: this.metrics.temperature.toFixed(1) },
      { id: 'gpu_utilization', value: this.metrics.utilization.toFixed(0) },
      { id: 'gpu_power', value: this.metrics.powerDraw.toFixed(2) },
      { id: 'gpu_clock_graphics', value: this.metrics.clockGraphics.toFixed(0) },
      { id: 'gpu_clock_memory', value: this.metrics.clockMemory.toFixed(0) },
      { id: 'gpu_fan_speed', value: this.metrics.fanSpeed.toFixed(0) },
      { id: 'gpu_pstate', value: this.metrics.pstate },
    ];

    for (const metric of metrics) {
      await this.mqttClient.publish(
        this.prefixTopic(`${this.featureName}/${metric.id}/state`),
        metric.value,
        { qos: 0, retain: true }
      );
    }
  }

  async setup(): Promise<void> {
    // No setup needed for GPU monitoring
  }

  async cleanup(): Promise<void> {
    // No cleanup needed
  }
}
