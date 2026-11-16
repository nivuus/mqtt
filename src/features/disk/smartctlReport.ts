// src/features/disk/smartctlReport.ts
//
// Reading `smartctl -j -a` output: overall health, the attribute table (SATA)
// or health log (NVMe), and the totals of data read and written. Pure: the
// same JSON comes from a local disk and from the Windows VM over WinRM.

import logger from '../../utils/logger';

export interface SmartAttribute {
  id: number;
  name: string;
  value: number;
  worst: number;
  thresh: number;
  type: string;
  updated: string;
  when_failed: string;
  raw_value: string | number;
  parsed_value_gb?: number; // For specific attributes like LBAs written/read
}

/** One attribute as published in the health sensor's attributes. */
export interface PublishedSmartAttribute {
  id: number;
  name: string;
  value: number;
  raw: string | number;
  failed: boolean;
}

const LBA_SIZE_BYTES = 512; // Standard LBA size
const BYTES_PER_GB = 1024 * 1024 * 1024;

export function parseSmartOverallHealth(jsonData: any): string {
  if (!jsonData || !jsonData.smart_status) {
    return 'UNKNOWN';
  }
  return jsonData.smart_status.passed ? 'PASSED' : 'FAILED';
}

export function isNvmeReport(jsonData: any): boolean {
  return Boolean(jsonData?.device && jsonData.device.type === 'nvme');
}

export function parseSmartAttributes(jsonData: any, isNvme: boolean = false): SmartAttribute[] {
  if (!jsonData) return [];
  return isNvme ? parseNvmeHealthLog(jsonData) : parseAtaAttributes(jsonData);
}

// NVMe attributes are in `nvme_smart_health_information_log`.
function parseNvmeHealthLog(jsonData: any): SmartAttribute[] {
  const attributes: SmartAttribute[] = [];
  const nvmeLog = jsonData.nvme_smart_health_information_log;
  if (!nvmeLog) return attributes;

  const nvmeAttrMap: { [key: string]: string } = {
    critical_warning: "critical_warning",
    temperature: "temperature_celsius",
    available_spare: "available_spare_percent",
    available_spare_threshold: "available_spare_threshold_percent",
    percentage_used: "percentage_used",
    data_units_read: "data_units_read", // This is in 512,000 byte units, not LBAs
    data_units_written: "data_units_written", // This is in 512,000 byte units, not LBAs
    host_read_commands: "host_read_commands",
    host_write_commands: "host_write_commands",
    controller_busy_time: "controller_busy_time_minutes",
    power_cycles: "power_cycles",
    power_on_hours: "power_on_hours",
    unsafe_shutdowns: "unsafe_shutdowns",
    media_errors: "media_data_integrity_errors", // Renamed from media_and_data_integrity_errors
    num_err_log_entries: "error_log_entries",
  };

  // Handle temperature sensors if they exist
  for (let i = 1; i <= 8; i++) { // smartctl supports up to 8 temperature sensors
    if (nvmeLog[`temperature_sensor_${i}`] !== undefined) {
      nvmeAttrMap[`temperature_sensor_${i}`] = `temperature_sensor_${i}_celsius`;
    }
  }

  for (const key in nvmeLog) {
    if (!Object.prototype.hasOwnProperty.call(nvmeLog, key)) continue;
    const attributeName = nvmeAttrMap[key] || key.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/gi, '');
    let numericValue = parseFloat(nvmeLog[key]);
    if (isNaN(numericValue)) {
      // If it's an object like { value: X, units: "Y" }, try to get value
      if (typeof nvmeLog[key] === 'object' && nvmeLog[key] !== null && nvmeLog[key].value !== undefined) {
        numericValue = parseFloat(nvmeLog[key].value);
      }
      if (isNaN(numericValue)) numericValue = 0; // Default if still not a number
    }

    const attributeEntry: SmartAttribute = {
      id: 0, // NVMe attributes don't have standard IDs
      name: attributeName,
      value: numericValue,
      worst: 0, // Not applicable for NVMe in the same way as SATA
      thresh: 0, // Not applicable
      type: 'NVMe',
      updated: 'Always', // Assumed
      when_failed: '-', // Not applicable
      raw_value: String(nvmeLog[key].value !== undefined ? nvmeLog[key].value : nvmeLog[key]), // Store the original value as string
    };

    // smartctl JSON reports data units in 1000s of 512-byte blocks: the value
    // is kept as reported, and converted to GB beside it.
    if (attributeName === 'data_units_read' || attributeName === 'data_units_written') {
      attributeEntry.parsed_value_gb = (numericValue * 1000 * 512) / BYTES_PER_GB;
    }
    attributes.push(attributeEntry);
  }
  return attributes;
}

// SATA/SAS attributes are in `ata_smart_attributes.table`.
function parseAtaAttributes(jsonData: any): SmartAttribute[] {
  const attributes: SmartAttribute[] = [];
  const ataAttributes = jsonData.ata_smart_attributes?.table;
  if (!ataAttributes || !Array.isArray(ataAttributes)) return attributes;

  for (const item of ataAttributes) {
    try {
      const attribute: SmartAttribute = {
        id: item.id,
        name: item.name,
        value: item.value,
        worst: item.worst,
        thresh: item.thresh,
        type: item.flags?.prefailure ? 'Pre-fail' : (item.flags?.old_age ? 'Old_age' : 'Unknown'),
        updated: item.flags?.updated_online ? 'Online' : 'Offline', // Simplified
        when_failed: item.when_failed || '-',
        raw_value: item.raw?.string || String(item.raw?.value) || '0',
      };

      if (attribute.name === 'Total_LBAs_Written' || attribute.name === 'Total_LBAs_Read') {
        const rawLbas = parseFloat(attribute.raw_value as string);
        if (!isNaN(rawLbas)) {
          attribute.parsed_value_gb = (rawLbas * LBA_SIZE_BYTES) / BYTES_PER_GB;
        }
      }
      attributes.push(attribute);
    } catch (e) {
      logger.warn(`Could not parse SATA SMART attribute from JSON: "${JSON.stringify(item)}"`, e);
    }
  }
  return attributes;
}

/**
 * The attribute list published with the health sensor, each with a failure
 * flag: for SATA, WHEN_FAILED set or the value at or below a meaningful
 * threshold; for NVMe (id 0), a critical warning, a media integrity error or
 * an error log entry.
 */
export function toPublishedAttributes(attributes: SmartAttribute[]): PublishedSmartAttribute[] {
  return attributes.map((attr) => {
    let isFailed = false;
    if (attr.id !== 0) {
      isFailed = Boolean((attr.when_failed && attr.when_failed !== '-') ||
                 (attr.thresh > 0 && attr.value <= attr.thresh));
    } else if (attr.name === 'critical_warning' && attr.value !== 0) { // 0x00 is no warning
      isFailed = true;
    } else if (attr.name === 'media_data_integrity_errors' && attr.value !== 0) {
      isFailed = true;
    } else if (attr.name === 'error_log_entries' && attr.value !== 0) {
      isFailed = true;
    }
    return { id: attr.id, name: attr.name, value: attr.value, raw: attr.raw_value, failed: isFailed };
  });
}

/** Total data written and read in GB, when the disk reports them. */
export function dataTotalsGb(attributes: SmartAttribute[]): { written?: number; read?: number } {
  const written = attributes.find((attr) => attr.name === 'Total_LBAs_Written' || attr.name === 'data_units_written');
  const read = attributes.find((attr) => attr.name === 'Total_LBAs_Read' || attr.name === 'data_units_read');
  return { written: written?.parsed_value_gb, read: read?.parsed_value_gb };
}
