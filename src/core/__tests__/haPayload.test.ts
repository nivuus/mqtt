import { HA_PAYLOAD_NONE, numericState } from '../haPayload';

describe('numericState', () => {
  it('is the payload HA maps to the unknown state', () => {
    // homeassistant/components/mqtt/const.py: PAYLOAD_NONE = "None"
    expect(HA_PAYLOAD_NONE).toBe('None');
  });

  it('publishes None for a missing reading, never a word HA must parse as a number', () => {
    expect(numericState(null)).toBe('None');
    expect(numericState(undefined)).toBe('None');
    expect(numericState(Number.NaN, 1)).toBe('None');
    expect(numericState(Number.POSITIVE_INFINITY)).toBe('None');
  });

  it('formats a reading, zero included', () => {
    expect(numericState(0, 1)).toBe('0.0');
    expect(numericState(1019, 1)).toBe('1019.0');
    expect(numericState(11.904, 2)).toBe('11.90');
    expect(numericState(42)).toBe('42');
  });
});
