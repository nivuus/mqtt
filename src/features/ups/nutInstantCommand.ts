// src/features/ups/nutInstantCommand.ts
//
// Runs an authenticated NUT instant command by talking to upsd directly, with
// the NUT network protocol (RFC 9271): USERNAME, PASSWORD, INSTCMD, LOGOUT,
// one line each, each answered by one line ("OK..." or "ERR <reason>").
//
// `upscmd -u <user> -p <password>` put the password on a command line,
// readable by every local user in /proc/<pid>/cmdline and `ps` for as long as
// upscmd ran, and NUT 2.8.1 (Debian 13) has no other non-interactive way to
// hand it over (it prompts on a terminal; nutauth.conf only came later).
//
// Not the nut-client npm package (1.0.0): a command sent before its socket is
// up is queued, and when the connection then fails (upsd stopped, ECONNREFUSED)
// that command's promise never settles, so the battery test would hang forever.

import { createConnection, Socket } from 'net';
import { createInterface } from 'readline';
import type { NutCredentials } from './nutCommands';

export const NUT_DEFAULT_PORT = 3493;
const DEFAULT_TIMEOUT_MS = 10000;

export interface NutUpsAddress {
  ups: string;
  host: string;
  port: number;
}

/** Parses the NUT UPS name syntax `<ups>[@<host>[:<port>]]`, as upsc and upscmd take it. */
export function parseUpsAddress(name: string): NutUpsAddress {
  const at = name.indexOf('@');
  const ups = at === -1 ? name : name.slice(0, at);
  const location = at === -1 ? 'localhost' : name.slice(at + 1);
  const colon = location.lastIndexOf(':');
  const port = colon === -1 ? NaN : Number(location.slice(colon + 1));
  const host = colon === -1 || !Number.isInteger(port) ? location : location.slice(0, colon);
  if (!ups || !host) throw new Error(`Invalid NUT UPS name: ${name}`);
  return { ups, host, port: Number.isInteger(port) && port > 0 ? port : NUT_DEFAULT_PORT };
}

/** One protocol line: every argument double-quoted, `\` and `"` escaped (RFC 9271, 3.2). */
export function nutCommandLine(words: string[]): string {
  if (words.some((word) => /[\r\n]/.test(word))) throw new Error('NUT command arguments cannot contain a line break');
  return `${words.map((word) => `"${word.replace(/["\\]/g, '\\$&')}"`).join(' ')}\n`;
}

/**
 * Logs in to upsd and runs `command` on the UPS. Rejects with upsd's own
 * answer ("ERR ACCESS-DENIED", "ERR CMD-NOT-SUPPORTED"...), a socket error,
 * or a timeout; the connection is closed in every case.
 */
export async function runNutInstantCommand(
  upsName: string,
  command: string,
  credentials: NutCredentials,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const { ups, host, port } = parseUpsAddress(upsName);
  const socket = createConnection({ host, port });
  try {
    await converse(socket, timeoutMs, [
      ['USERNAME', credentials.username],
      ['PASSWORD', credentials.password],
      ['INSTCMD', ups, command],
    ]);
  } catch (error) {
    socket.destroy();
    throw error;
  }
  // Polite close: upsd answers LOGOUT and closes its side.
  socket.end(nutCommandLine(['LOGOUT']));
}

/** Sends each request after the previous one was answered "OK"; rejects on anything else. */
function converse(socket: Socket, timeoutMs: number, requests: string[][]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let next = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      lines.close();
      if (error) reject(error); else resolve();
    };
    const send = () => socket.write(nutCommandLine(requests[next]));

    const lines = createInterface({ input: socket, crlfDelay: Infinity });
    lines.on('line', (line: string) => {
      const verb = requests[next][0];
      if (!/^OK\b/.test(line)) {
        finish(new Error(`upsd refused ${verb}: ${line.trim()}`));
        return;
      }
      next += 1;
      if (next === requests.length) finish();
      else send();
    });
    socket.setTimeout(timeoutMs, () => finish(new Error(`upsd did not answer within ${timeoutMs} ms`)));
    // readline re-emits the socket's errors: an 'error' event nobody listens
    // to would throw out of the socket's own error handling.
    lines.on('error', (error: Error) => finish(error));
    // Kept for the socket's whole life: an error after the answer (upsd
    // resetting the connection during LOGOUT) must not go unhandled.
    socket.on('error', (error) => finish(error));
    socket.once('close', () => finish(new Error('upsd closed the connection')));
    socket.once('connect', send);
  });
}
