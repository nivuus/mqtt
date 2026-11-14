import { promises as fsp } from 'fs';
import * as path from 'path';
import { MacVendorLookupService } from '..';
import { IeeeRegistry, parseCsvLine } from '../ieeeRegistry';

const FIXTURES = path.join(__dirname, 'fixtures');

describe('offline IEEE registry lookup', () => {
  afterEach(() => jest.restoreAllMocks());

  it('resolves a known OUI from the CSV, whatever the MAC notation', async () => {
    const lookup = new MacVendorLookupService(new IeeeRegistry(FIXTURES));
    expect(await lookup.lookupVendor('00:1a:11:aa:bb:cc')).toEqual({ vendor: 'Google, Inc.' });
    expect(await lookup.lookupVendor('00-1A-11-AA-BB-CC')).toEqual({ vendor: 'Google, Inc.' });
    expect(await lookup.lookupVendor('3c:5a:b4:00:00:01')).toEqual({ vendor: 'Example "Quoted" Co.' });
  });

  it('prefers the longest assigned block (MA-S inside an MA-L)', async () => {
    const lookup = new MacVendorLookupService(new IeeeRegistry(FIXTURES));
    expect(await lookup.lookupVendor('70:b3:d5:f2:a0:01')).toEqual({ vendor: 'Small Block Owner GmbH' });
    expect(await lookup.lookupVendor('70:b3:d5:11:00:01')).toEqual({ vendor: 'IEEE Registration Authority' });
  });

  it('reads the registry once for a whole batch, and leaves unknown blocks out', async () => {
    const readFile = jest.spyOn(fsp, 'readFile');
    const lookup = new MacVendorLookupService(new IeeeRegistry(FIXTURES));
    const results = await lookup.batchLookup(['00:1a:11:00:00:01', '00:1a:11:00:00:02', '00:00:01:00:00:01']);
    expect([...results.keys()]).toEqual(['00:1a:11:00:00:01', '00:1a:11:00:00:02']);
    expect(readFile).toHaveBeenCalledTimes(4);
  });

  it('answers "unknown" without throwing when the registry is not installed', async () => {
    const lookup = new MacVendorLookupService(new IeeeRegistry(path.join(FIXTURES, 'absent')));
    await expect(lookup.lookupVendor('00:1a:11:aa:bb:cc')).resolves.toEqual({});
    await expect(lookup.batchLookup(['00:1a:11:aa:bb:cc'])).resolves.toEqual(new Map());
  });

  it('ignores what is not a MAC address', async () => {
    const lookup = new MacVendorLookupService(new IeeeRegistry(FIXTURES));
    expect(await lookup.lookupVendor('not-a-mac')).toEqual({});
  });

  it('parses RFC 4180 quoting on one line', () => {
    expect(parseCsvLine('MA-L,ABCDEF,"A, ""B""",')).toEqual(['MA-L', 'ABCDEF', 'A, "B"', '']);
  });
});
