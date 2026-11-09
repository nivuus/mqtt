// src/features/events/clamavDetection.ts
//
// Parsing and de-duplication of ClamAV detections as clamd writes them to
// syslog/journald. clamd is the single place every detection goes through:
// on-demand scans (clamdscan, the full-system scan) and on-access scans
// (clamonacc hands each file to clamd), so watching it covers both, where
// clamonacc.log only ever saw the on-access ones.

export interface ClamdDetection {
  file: string;
  virus_name: string;
}

// clamd line, syslog or journald prefix in front of it:
//   clamd[3283275]: /root/x.txt: Eicar-Test-Signature(44d88612fea8a8f36de82e1278abb02f:68) FOUND
// The "(hash:size)" suffix only appears with ExtendedDetectionInfo. The file
// part is greedy up to the LAST ": " so paths containing ": " stay whole.
const CLAMD_FOUND = /\bclamd\[\d+\]:\s+(.+):\s+(\S+?)(?:\([0-9a-f]+:\d+\))?\s+FOUND\s*$/;

export function parseClamdDetection(line: string): ClamdDetection | null {
  const match = line.match(CLAMD_FOUND);
  if (!match) return null;
  return { file: match[1], virus_name: match[2] };
}

// clamd logs every detection twice within the same second (once per log
// sink). Without this, one infected file would fire two alerts.
export class DetectionDeduper {
  private readonly seen = new Map<string, number>();

  constructor(private readonly windowMs: number = 5000) {}

  isDuplicate(detection: ClamdDetection, now: number = Date.now()): boolean {
    for (const [key, at] of this.seen) {
      if (now - at > this.windowMs) this.seen.delete(key);
    }
    const key = `${detection.file}\u0000${detection.virus_name}`;
    const last = this.seen.get(key);
    this.seen.set(key, now);
    return last !== undefined && now - last <= this.windowMs;
  }
}
