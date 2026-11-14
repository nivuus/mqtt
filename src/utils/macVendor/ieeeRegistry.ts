/**
 * The IEEE MAC address registry as Debian's `ieee-data` package ships it, read offline:
 * `/usr/share/ieee-data/{oui,mam,oui36,iab}.csv`, CRLF lines of
 * `Registry,Assignment,Organization Name,Organization Address` (RFC 4180 quoting). The
 * assignment is the block prefix in hex: 6 digits for MA-L, 7 for MA-M, 9 for MA-S and IAB.
 * A lookup takes the longest matching prefix, so a small block inside a large one (MA-L
 * blocks owned by "IEEE Registration Authority" and sub-assigned) names its real owner.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import logger from '../logger';

export const DEFAULT_IEEE_DATA_DIR = '/usr/share/ieee-data';
const REGISTRY_FILES = ['oui.csv', 'mam.csv', 'oui36.csv', 'iab.csv'];
const PREFIX_LENGTHS = [9, 7, 6];

/** The fields of one RFC 4180 record held on a single line. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { fields.push(field); field = ''; }
    else field += c;
  }
  fields.push(field);
  return fields;
}

export class IeeeRegistry {
  private prefixes?: Promise<Map<string, string>>;

  constructor(private readonly dir: string = DEFAULT_IEEE_DATA_DIR) {}

  /** The organisation the address block of `hexMac` (12 upper-case hex digits) is assigned to. */
  async organisationOf(hexMac: string): Promise<string | undefined> {
    const prefixes = await (this.prefixes ??= this.load());
    for (const length of PREFIX_LENGTHS) {
      const owner = prefixes.get(hexMac.slice(0, length));
      if (owner) return owner;
    }
    return undefined;
  }

  /** Loaded once; a missing file (package not installed) leaves its blocks unknown. */
  private async load(): Promise<Map<string, string>> {
    const prefixes = new Map<string, string>();
    for (const name of REGISTRY_FILES) {
      const file = path.join(this.dir, name);
      let text: string;
      try {
        text = await fs.readFile(file, 'utf8');
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') logger.warn(`MAC vendor registry ${file} is absent (package ieee-data): its vendors stay unknown`);
        else logger.error(`Cannot read the MAC vendor registry ${file}: ${(err as Error).message}`);
        continue;
      }
      for (const line of text.split(/\r?\n/).slice(1)) {
        const [, assignment, organisation] = parseCsvLine(line);
        if (assignment && organisation && /^[0-9A-F]+$/i.test(assignment)) {
          prefixes.set(assignment.toUpperCase(), organisation.trim());
        }
      }
    }
    return prefixes;
  }
}
