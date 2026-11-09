// src/utils/__tests__/exec.test.ts

import { execute_argv, execute_argv_input, execute_command } from "../exec";
import logger from '../logger';

beforeEach(() => {
  // Pristine test output: every log line goes to a silent spy.
  jest.spyOn(logger, 'debug').mockImplementation(() => {});
  jest.spyOn(logger, 'info').mockImplementation(() => {});
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('execute_argv — shell metacharacters are inert', () => {
  it('passes ";" and a chained command as a single literal argument', async () => {
    // Under a shell, `echo hello; whoami` would ALSO run `whoami`. With execFile
    // there is no shell, so the whole string is one literal argv element.
    const result = await execute_argv('echo', ['hello; whoami']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello; whoami');
  });

  it('does not perform command substitution $(...)', async () => {
    const result = await execute_argv('echo', ['$(whoami)']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('$(whoami)');
  });

  it('does not interpret a pipe', async () => {
    const result = await execute_argv('echo', ['a | b']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('a | b');
  });

  it('does not interpret backticks', async () => {
    const result = await execute_argv('echo', ['`whoami`']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('`whoami`');
  });

  it('propagates a non-zero exit code', async () => {
    const result = await execute_argv('false', []);
    expect(result.exitCode).toBe(1);
  });

  it('returns exit code 1 when the program does not exist (ENOENT)', async () => {
    const result = await execute_argv('this-binary-does-not-exist-xyz', []);
    expect(result.exitCode).toBe(1);
  });

  it('mirrors the CommandResult shape of execute_command', async () => {
    const result = await execute_argv('echo', ['ok']);
    expect(result).toHaveProperty('stdout');
    expect(result).toHaveProperty('stderr');
    expect(result).toHaveProperty('exitCode');
  });
});

describe('force-kill of a child that outlives its timeout', () => {
  // A shell that ignores the SIGTERM sent at the timeout, so only the SIGKILL
  // fallback (armed for timeout + 5 s) can end it before its loop does. The
  // loop is bounded at 20 s, past the test timeout: a regression fails the
  // test without leaving a process behind for long.
  const IGNORES_SIGTERM = 'trap "" TERM; i=0; while [ "$i" -lt 20 ]; do sleep 1; i=$((i + 1)); done';
  const TEST_TIMEOUT_MS = 15000;

  it('execute_argv kills the child itself and resolves', async () => {
    const result = await execute_argv('sh', ['-c', IGNORES_SIGTERM], { timeoutMs: 300 });

    expect(result.exitCode).toBe(1);
  }, TEST_TIMEOUT_MS);

  it('execute_command kills the shell itself and resolves', async () => {
    // A whitelisted prefix, then the same script run by the spawned shell.
    const result = await execute_command(`cat /dev/null; ${IGNORES_SIGTERM}`, false, 300);

    expect(result.exitCode).not.toBe(0);
  }, TEST_TIMEOUT_MS);
});

describe("execute_argv_input — stdin is fed, never logged", () => {
  it("feeds the input on stdin", async () => {
    const result = await execute_argv_input("cat", [], "table inet t\n");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("table inet t\n");
  });

  it("propagates a non-zero exit code", async () => {
    const result = await execute_argv_input("sh", ["-c", "cat >/dev/null; exit 3"], "x");
    expect(result.exitCode).toBe(3);
  });

  it("never logs the input", async () => {
    const secret = "do-not-log-this-input";
    await execute_argv_input("sh", ["-c", "cat >/dev/null; exit 2"], secret);
    const logged = [logger.debug, logger.info, logger.warn, logger.error]
      .flatMap(fn => (fn as jest.Mock).mock.calls.flat().map(String));
    expect(logged.some(line => line.includes(secret))).toBe(false);
  });

  const logged = () => [logger.debug, logger.info, logger.warn, logger.error]
    .flatMap(fn => (fn as jest.Mock).mock.calls.flat().map(String));

  it("never logs input a failing child echoes on stderr, but returns it", async () => {
    const secret = "secret-echoed-on-stderr";
    const result = await execute_argv_input("sh", ["-c", "cat >&2; exit 1"], secret);
    expect(result).toEqual({ stdout: "", stderr: secret, exitCode: 1 });
    expect(logged().some(line => line.includes(secret))).toBe(false);
  });

  it("never logs input a succeeding child echoes on stdout, but returns it", async () => {
    const secret = "secret-echoed-on-stdout";
    const result = await execute_argv_input("cat", [], secret);
    expect(result.stdout).toBe(secret);
    expect(logged().some(line => line.includes(secret))).toBe(false);
  });
});

describe("quiet option — routine read-only calls log at debug", () => {
  const attempted = (spy: jest.SpyInstance) =>
    spy.mock.calls.filter(args => String(args[0]).startsWith("Attempting to execute"));

  it("logs the attempt at info by default", async () => {
    await execute_argv("true", []);
    expect(attempted(logger.info as unknown as jest.SpyInstance)).toHaveLength(1);
    expect(attempted(logger.debug as unknown as jest.SpyInstance)).toHaveLength(0);
  });

  it("logs the attempt at debug only when quiet", async () => {
    await execute_argv("true", [], { quiet: true });
    expect(attempted(logger.info as unknown as jest.SpyInstance)).toHaveLength(0);
    expect(attempted(logger.debug as unknown as jest.SpyInstance)).toHaveLength(1);
  });

  it("still warns about a failure when quiet", async () => {
    await execute_argv("false", [], { quiet: true });
    expect(logger.warn).toHaveBeenCalled();
  });
});
