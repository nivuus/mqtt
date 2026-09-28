// src/utils/__tests__/exec.test.ts

import { execute_argv, execute_command } from '../exec';
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
