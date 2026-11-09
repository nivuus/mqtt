/**
 * Asks the DNS server the tunnel pushed for the root NS records, from a UDP socket bound to
 * the tun device (SO_BINDTODEVICE). Any answer carrying the query's id, whatever its RCODE,
 * proves the tunnel carries traffic both ways; silence means the provider side is dead.
 *
 * Why a device-bound socket, and why Python:
 * - Bound to the device, the packet can only leave through `nvguest0`. When the FIB has no
 *   route for a device-bound socket, Linux assumes the destination is on-link for that device
 *   (ip_route_output_key_hash_rcu), and the tun is point-to-point: the probe tests the tunnel
 *   whether or not table 200 is intact. Table 200 and its rule are checked separately
 *   (tunnelHealth.ts), so each failure has its own message, and the probe never leaks out of
 *   the uplink.
 * - `dig -b` / `drill -I` (both on the host) bind a source address, not a device: with table
 *   200 broken the query would follow the main table to the uplink (a false failure that also
 *   leaks the query). `host` and `nslookup` cannot bind at all, Node's dgram has no
 *   SO_BINDTODEVICE, and curl's DNS options need a c-ares build Debian does not ship.
 *   python3 sets the option in one call; the package depends on it.
 *
 * The query asks for the root zone: it names no guest and no host.
 */
import { execute_argv_input } from '../../utils/exec';

export const DNS_PROBE_TIMEOUT_S = 3;
// The script's own socket timeout fires first; this only bounds a python3 that hangs.
const DNS_PROBE_KILL_MS = (DNS_PROBE_TIMEOUT_S + 5) * 1000;

const PROBE_SCRIPT = `
import os, socket, struct, sys
dev, server, timeout, port = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4])
qid = struct.unpack(">H", os.urandom(2))[0]
query = struct.pack(">HHHHHH", qid, 0x0100, 1, 0, 0, 0) + b"\\x00" + struct.pack(">HH", 2, 1)
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, getattr(socket, "SO_BINDTODEVICE", 25), dev.encode())
    s.settimeout(timeout)
    s.sendto(query, (server, port))
    while True:
        data, peer = s.recvfrom(4096)
        if peer[0] == server and len(data) >= 12 and struct.unpack(">H", data[:2])[0] == qid and data[2] & 0x80:
            sys.exit(0)
except OSError as e:
    print("no answer from %s through %s: %s" % (server, dev, e), file=sys.stderr)
    sys.exit(1)
`;

/**
 * Undefined when `server` answered through `device`; otherwise why not. The script goes on
 * stdin (`python3 -I -`), which exec never logs, so log lines carry only the parameters.
 */
export async function probeDns(device: string, server: string, port = 53): Promise<string | undefined> {
  const args = ['-I', '-', device, server, String(DNS_PROBE_TIMEOUT_S), String(port)];
  const result = await execute_argv_input('python3', args, PROBE_SCRIPT, { timeoutMs: DNS_PROBE_KILL_MS, quiet: true });
  if (result.spawnError !== undefined) return `could not run python3: ${result.spawnError}`;
  if (result.exitCode === 0) return undefined;
  return result.stderr.trim() || `python3 exited with ${result.exitCode}`;
}
