/**
 * Replays the bench captures (`fixtures/bench/`, nmcli 1.52.1) as `execute_argv` results.
 *
 * A command is answered only by a capture of that exact command (the profile UUID written as
 * `<u>`), with the captured stdout, exit code and stderr; anything else throws. Code that
 * builds an argv nmcli 1.52 rejects therefore gets nmcli's real rc 2, not a mock's opinion.
 */
import { readFileSync } from 'fs';
import * as path from 'path';
import * as execModule from '../../../utils/exec';
import { Result } from './fakeNmcli';

export type Capture = { state: string; command: string; rc: number; stderr: string };

const DIR = path.join(__dirname, 'fixtures', 'bench');
export const manifest = JSON.parse(readFileSync(path.join(DIR, 'manifest.json'), 'utf8')) as Record<string, Capture>;
export const stdout = (name: string): string => readFileSync(path.join(DIR, `${name}.stdout`), 'utf8');

export const LIVE_ID = 'nivuus-guest-vpn';

/** The guest VPN profile's UUID in a capture state, read from its full listing. */
export function uuidOf(state: string): string {
  const line = stdout(`${state}.nmcli-show-full`).split('\n').find(l => l.startsWith('connection.uuid:'));
  if (!line) throw new Error(`no connection.uuid in ${state}.nmcli-show-full`);
  return line.slice('connection.uuid:'.length);
}

function captured(name: string): Result {
  const capture = manifest[name];
  return { stdout: stdout(name), stderr: capture.stderr, exitCode: capture.rc };
}

/**
 * Serves the captures of `states`, first match wins. `sequences` maps a command to the
 * captures it returns on successive calls (the last one repeats), for state that moves on
 * between two reads such as an activation. `extra` answers commands no capture holds.
 */
export function replay(
  exec: jest.Mocked<typeof execModule>,
  uuid: string,
  states: string[],
  opts: { sequences?: Record<string, string[]>; extra?: (file: string, args: string[]) => Result | undefined } = {},
): string[] {
  const commands: string[] = [];
  const served = new Map<string, number>();
  exec.execute_argv.mockImplementation(async (file, args) => {
    const command = [file, ...args.map(a => (a === uuid ? '<u>' : a))].join(' ');
    commands.push(command);
    const fromExtra = opts.extra?.(file, args);
    if (fromExtra) return fromExtra;
    const sequence = opts.sequences?.[command];
    if (sequence) {
      const n = served.get(command) ?? 0;
      served.set(command, n + 1);
      return captured(sequence[Math.min(n, sequence.length - 1)]);
    }
    for (const state of states) {
      const name = Object.keys(manifest).find(k => k.startsWith(`${state}.`) && manifest[k].command === command);
      if (name) return captured(name);
    }
    for (const [name, capture] of Object.entries(manifest)) {
      // A command captured in another state only: nmcli rejects or accepts it the same way.
      if (capture.command === command && capture.rc !== 0) return captured(name);
    }
    throw new Error(`no bench capture for: ${command}`);
  });
  exec.execute_argv_input.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
  return commands;
}

/** `nmcli -g NAME,UUID connection show` as it would list the captured profile. */
export function namesListing(uuid: string): Result {
  return { stdout: `bridge-publicBridge:6a4a63db-cc49-443f-91f8-e31575763de8\n${LIVE_ID}:${uuid}\n`, stderr: '', exitCode: 0 };
}
