/**
 * Reverse DNS through Node's own resolver (c-ares, the host's resolv.conf servers): no
 * subprocess, a bounded wait, answers cached for an hour, misses included.
 */
import { promises as dns } from 'dns';

const CACHE_TTL_MS = 3_600_000;
const resolver = new dns.Resolver({ timeout: 2000, tries: 1 });
const cache = new Map<string, { name: string | undefined; at: number }>();

/** The first PTR name of `ip`, or undefined when there is none or the lookup fails. */
export async function reverseLookup(ip: string): Promise<string | undefined> {
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.name;
  let name: string | undefined;
  try {
    [name] = await resolver.reverse(ip);
  } catch {
    // NOTFOUND, NODATA, a timeout or a refused query all mean "no name to show"; the device is
    // still published, under its address.
    name = undefined;
  }
  cache.set(ip, { name, at: Date.now() });
  return name;
}
