import { parseClamdDetection, DetectionDeduper } from '../clamavDetection';

describe('parseClamdDetection', () => {
  it('reads a classic syslog line with extended detection info', () => {
    const line = 'Nov  9 09:26:26 nivuus clamd[3283275]: /root/eicar-ondemand-TEST.txt: Eicar-Test-Signature(44d88612fea8a8f36de82e1278abb02f:68) FOUND';
    expect(parseClamdDetection(line)).toEqual({ file: '/root/eicar-ondemand-TEST.txt', virus_name: 'Eicar-Test-Signature' });
  });

  it('reads a journalctl short-iso line without extended info', () => {
    const line = '2026-11-09T09:26:53+01:00 nivuus clamd[3283275]: /media/data/Downloads/a.zip: Win.Trojan.Agent-123 FOUND';
    expect(parseClamdDetection(line)).toEqual({ file: '/media/data/Downloads/a.zip', virus_name: 'Win.Trojan.Agent-123' });
  });

  it('keeps a file path that itself contains ": "', () => {
    const line = 'Nov  9 09:26:26 nivuus clamd[1]: /data/Films: le retour/x.exe: Win.Test(abc123:9) FOUND';
    expect(parseClamdDetection(line)).toEqual({ file: '/data/Films: le retour/x.exe', virus_name: 'Win.Test' });
  });

  it('ignores clamd lines that are not detections', () => {
    expect(parseClamdDetection('Nov  9 09:22:30 nivuus clamd[3278854]: Database correctly reloaded (3628258 signatures)')).toBeNull();
    expect(parseClamdDetection('Nov  9 09:20:01 nivuus clamd[1]: /etc/hostname: Access denied. ERROR')).toBeNull();
  });

  it('ignores FOUND lines from other programs, the agent itself included', () => {
    expect(parseClamdDetection('Nov  9 09:26:26 nivuus mqtt-system-agent[967908]: /x: Eicar FOUND')).toBeNull();
    expect(parseClamdDetection('Nov  9 09:26:26 nivuus clamonacc[12]: /x: Eicar FOUND')).toBeNull();
  });
});

describe('DetectionDeduper', () => {
  const eicar = { file: '/root/x.txt', virus_name: 'Eicar-Test-Signature' };

  it('drops the second identical line clamd writes in the same second', () => {
    const dedup = new DetectionDeduper(5000);
    expect(dedup.isDuplicate(eicar, 1000)).toBe(false);
    expect(dedup.isDuplicate(eicar, 1200)).toBe(true);
  });

  it('reports the same file again once the window has passed', () => {
    const dedup = new DetectionDeduper(5000);
    expect(dedup.isDuplicate(eicar, 1000)).toBe(false);
    expect(dedup.isDuplicate(eicar, 7000)).toBe(false);
  });

  it('treats a different file or virus as a new detection', () => {
    const dedup = new DetectionDeduper(5000);
    expect(dedup.isDuplicate(eicar, 1000)).toBe(false);
    expect(dedup.isDuplicate({ ...eicar, file: '/root/y.txt' }, 1100)).toBe(false);
    expect(dedup.isDuplicate({ ...eicar, virus_name: 'Other' }, 1200)).toBe(false);
  });
});
