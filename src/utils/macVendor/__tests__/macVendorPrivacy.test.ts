import { promises as fsp } from 'fs';
import * as fs from 'fs';
import * as path from 'path';
import https from 'https';
import { MacVendorLookup } from '..';

const LOOKUP_DIR = path.join(__dirname, '..');

/** Every non-test source file of the lookup, whatever the import path that reaches it. */
function lookupSources(): string[] {
  const files = fs.readdirSync(LOOKUP_DIR).filter(f => f.endsWith('.ts')).map(f => path.join(LOOKUP_DIR, f));
  const sibling = path.join(LOOKUP_DIR, '..', 'macVendor.ts');
  return fs.existsSync(sibling) ? [...files, sibling] : files;
}

describe('MAC vendor lookup privacy', () => {
  afterEach(() => jest.restoreAllMocks());

  it('has no module that can reach the network', () => {
    const offenders = lookupSources().filter(file => {
      const text = fs.readFileSync(file, 'utf8');
      return /from ['"](node:)?(https?|net|dns|undici)['"]|require\(['"](node:)?(https?|net|dns|undici)['"]\)|\bfetch\(/.test(text);
    });
    expect(offenders.map(f => path.basename(f))).toEqual([]);
  });

  it('answers a locally administered (randomised) address without any lookup', async () => {
    // Never let a request out, even against code that would send one.
    const request = jest.spyOn(https, 'request').mockImplementation(() => { throw new Error('network call in a test'); });
    const readFile = jest.spyOn(fsp, 'readFile');
    const result = await MacVendorLookup.lookupVendor('da:a1:19:12:34:56');
    expect(request).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(result.vendor).toBe('Randomised or virtual address');
  });
});
