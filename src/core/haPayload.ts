// src/core/haPayload.ts

/**
 * The state payload Home Assistant's MQTT sensor, switch and binary_sensor map to the
 * `unknown` state (`PAYLOAD_NONE` in homeassistant/components/mqtt/const.py).
 *
 * Any other placeholder is taken literally: a sensor with a unit or device class then
 * rejects it as a non-numeric value and logs an error on every publish, which is what
 * `'unknown'` on the chassis fan did ~150 times a day.
 */
export const HA_PAYLOAD_NONE = 'None';

/**
 * State payload of a numeric sensor: the reading, or {@link HA_PAYLOAD_NONE} when there is
 * none. Zero is a reading.
 */
export function numericState(value: number | null | undefined, fractionDigits?: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return HA_PAYLOAD_NONE;
  return fractionDigits === undefined ? String(value) : value.toFixed(fractionDigits);
}
