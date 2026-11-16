import * as path from 'path';
import { cleanHostname, parseDnsmasqLeases, readBridgeLeases } from '../dnsmasqLeases';

const FIXTURES = path.join(__dirname, 'fixtures');

describe('dnsmasq leases', () => {
  it('parses the five-field lines and skips the duid line, IPv6 leases and garbage', () => {
    const text = [
      '0 AA:BB:CC:00:00:10 192.168.0.40 printer *',
      '1794700000 aa:bb:cc:00:00:11 192.168.0.41 * 01:aa',
      'duid 00:01:00:01',
      '1794700000 1234 2001:db8::5 host6 00:01',
      'junk',
    ].join('\n');
    expect(parseDnsmasqLeases(text)).toEqual([
      { mac: 'aa:bb:cc:00:00:10', ip: '192.168.0.40', hostname: 'printer', expires: undefined },
      { mac: 'aa:bb:cc:00:00:11', ip: '192.168.0.41', hostname: undefined, expires: new Date(1794700000 * 1000).toISOString() },
    ]);
  });

  it('reads only the file of the requested bridge', async () => {
    const guests = await readBridgeLeases(FIXTURES, 'publicBridge');
    expect(guests.map(l => l.hostname)).toEqual(['guest-phone']);
  });

  it('returns no lease for a bridge without a lease file, and refuses a path as a bridge name', async () => {
    await expect(readBridgeLeases(FIXTURES, 'internalBridge')).resolves.toEqual([]);
    await expect(readBridgeLeases(FIXTURES, '../fixtures/x')).rejects.toThrow(/invalid bridge name/);
  });

  it('cleans host names without dropping letters of any script', () => {
    expect(cleanHostname('имя-устройства')).toBe('имя-устройства');
    expect(cleanHostname('设备\u0007名‏')).toBe('设备名');
    expect(cleanHostname('‮')).toBeUndefined();
    const long = 'é'.repeat(200);
    expect(Buffer.byteLength(cleanHostname(long)!, 'utf8')).toBe(252);
  });
});
