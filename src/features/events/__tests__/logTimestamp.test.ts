import { parseLogTimestamp } from '../logTimestamp';

describe('parseLogTimestamp', () => {
  const now = new Date(2026, 10, 10, 9, 30, 0); // 10 Nov 2026, 09:30 local

  it('reads a BSD syslog line in local time, this year', () => {
    const line = 'Nov 10 09:27:08 nivuus usbhid-ups[3790390]: error';
    expect(parseLogTimestamp(line, now)).toBe(new Date(2026, 10, 10, 9, 27, 8).toISOString());
  });

  it('pads single-digit days the way syslog does', () => {
    const line = 'Nov  8 15:30:45 nivuus kernel: critical';
    expect(parseLogTimestamp(line, now)).toBe(new Date(2026, 10, 8, 15, 30, 45).toISOString());
  });

  it('puts a December line read in early January in the previous year', () => {
    const january = new Date(2027, 0, 2, 8, 0, 0);
    const line = 'Dec 31 23:59:01 nivuus cron: error';
    expect(parseLogTimestamp(line, january)).toBe(new Date(2026, 11, 31, 23, 59, 1).toISOString());
  });

  it('reads a fail2ban line with milliseconds', () => {
    const line = '2026-11-10 08:01:46,722 fail2ban.actions [1234]: NOTICE [sshd] Ban 203.0.113.9';
    expect(parseLogTimestamp(line, now)).toBe(new Date(2026, 10, 10, 8, 1, 46, 722).toISOString());
  });

  it('reads RFC 3339 and journalctl offsets', () => {
    expect(parseLogTimestamp('2026-11-10T09:27:08.123456+01:00 nivuus x: error', now))
      .toBe('2026-11-10T08:27:08.123Z');
    expect(parseLogTimestamp('2025-11-08T15:30:45+0100 nivuus sshd[1]: Accepted', now))
      .toBe('2025-11-08T14:30:45.000Z');
  });

  it('returns null rather than inventing a time', () => {
    expect(parseLogTimestamp('no timestamp here', now)).toBeNull();
    expect(parseLogTimestamp('Foo 10 09:27:08 host x', now)).toBeNull();
  });
});
