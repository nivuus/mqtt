// src/websocket/wizard/__tests__/fakeHost.ts
//
// An in-memory host for the wizard handlers: `cat`, `sudo cp|mv|cat` and `systemctl`
// act on a map of files instead of the real system, and temp files written with
// fs.writeFileSync land in the same map. Nothing touches the disk.

export interface FakeHost {
  files: Map<string, string>;
  calls: Array<{ command: string; args: string[] }>;
  /** Exit code returned for a given argv (joined with spaces), when set. */
  exitCodes: Map<string, number>;
  exec(command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  writeFileSync(path: string, content: string): void;
}

export function createFakeHost(initial: Record<string, string>): FakeHost {
  const files = new Map(Object.entries(initial));
  const calls: FakeHost['calls'] = [];
  const exitCodes = new Map<string, number>();

  const ok = (stdout = '') => ({ stdout, stderr: '', exitCode: 0 });
  const fail = (exitCode: number, stderr: string) => ({ stdout: '', stderr, exitCode });

  async function run(argv: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const forced = exitCodes.get(argv.join(' '));
    if (forced !== undefined && forced !== 0) return fail(forced, `forced failure of ${argv.join(' ')}`);
    const [command, ...args] = argv;
    if (command === 'sudo') return run(args);
    if (command === 'cat') {
      const content = files.get(args[0]);
      return content === undefined ? fail(1, `cat: ${args[0]}: No such file or directory`) : ok(content);
    }
    if (command === 'cp' || command === 'mv') {
      const content = files.get(args[0]);
      if (content === undefined) return fail(1, `${command}: cannot stat ${args[0]}`);
      files.set(args[1], content);
      if (command === 'mv') files.delete(args[0]);
      return ok();
    }
    if (command === 'systemctl' && args[0] === 'is-active') return ok('active\n');
    if (command === 'systemctl' || command === 'nmcli' || command === 'chmod') return ok();
    throw new Error(`unexpected command ${argv.join(' ')}`);
  }

  return {
    files,
    calls,
    exitCodes,
    exec: async (command, args) => {
      calls.push({ command, args });
      return run([command, ...args]);
    },
    writeFileSync: (path, content) => { files.set(path, String(content)); },
  };
}
