// src/features/events/logTimestamp.ts
//
// When a log line was written, read from the line itself. The "last event"
// sensors used to publish the time of the agent's poll instead, so Home
// Assistant showed the last syslog error and the last fail2ban ban as having
// happened "just now", forever.

// syslog writes English month abbreviations whatever the system locale.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 2026-11-10T09:27:08.123456+01:00 (rsyslog RFC 3339) or 2025-11-08T15:30:45+0100 (journalctl).
const ISO = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))/;
// 2026-11-10 09:27:27,038 (fail2ban, host local time).
const FAIL2BAN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:,(\d{3}))?/;
// Nov 10 09:27:08 (BSD syslog, host local time, no year).
const BSD = /^([A-Z][a-z]{2})\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2})/;

/**
 * ISO 8601 instant of the line, or null when the line carries no timestamp
 * this parser knows. `now` resolves the year a BSD syslog line leaves out:
 * a date that would lie in the future belongs to the previous year.
 */
export function parseLogTimestamp(line: string, now: Date = new Date()): string | null {
  const iso = line.match(ISO);
  if (iso) {
    // journalctl writes +0100; Date.parse needs +01:00.
    const normalised = iso[1].replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    const t = Date.parse(normalised);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }

  const f2b = line.match(FAIL2BAN);
  if (f2b) {
    const [, y, mo, d, h, mi, s, ms] = f2b;
    return new Date(+y, +mo - 1, +d, +h, +mi, +s, ms ? +ms : 0).toISOString();
  }

  const bsd = line.match(BSD);
  if (bsd) {
    const month = MONTHS.indexOf(bsd[1]);
    if (month < 0) return null;
    const [day, h, mi, s] = [bsd[2], bsd[3], bsd[4], bsd[5]].map(Number);
    let date = new Date(now.getFullYear(), month, day, h, mi, s);
    // Clocks drift a little; only a clear jump ahead means last year.
    if (date.getTime() - now.getTime() > 24 * 3600 * 1000) {
      date = new Date(now.getFullYear() - 1, month, day, h, mi, s);
    }
    return date.toISOString();
  }

  return null;
}
