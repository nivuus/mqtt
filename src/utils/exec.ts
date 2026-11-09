// src/utils/exec.ts
import { exec, execFile, ChildProcess } from 'child_process';
import logger from './logger';
import { isCommandAllowed } from './commandWhitelist';

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

interface ExecArgvOptions {
  timeoutMs?: number;
}

// How long a child that timed out gets to exit on the SIGTERM sent at its
// timeout before it is sent SIGKILL.
const FORCE_KILL_GRACE_MS = 5000;

/**
 * Executes a shell command.
 * @param command The command string to execute.
 * @param _requiresApproval This parameter is a hint for AI-driven execution and not used here.
 *                          Actual sudo permissions must be handled by the system/user.
 * @returns A promise that resolves with the command's output.
 */
export function execute_command(command: string, _requiresApproval: boolean, timeoutMs: number = 60000): Promise<CommandResult> {
  // Validate command against whitelist
  if (!isCommandAllowed(command)) {
    const errorMessage = `Command rejected by security whitelist: ${command}`;
    logger.error(errorMessage);
    return Promise.resolve({
      stdout: '',
      stderr: errorMessage,
      exitCode: 126 // Permission denied exit code
    });
  }

  logger.info(`Attempting to execute system command: ${command}`);

  return new Promise((resolve) => {
    const childProcess = exec(command, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024, // 1MB buffer
      killSignal: 'SIGTERM',
      env: { ...process.env, LC_ALL: 'C.utf8' }
    }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed) {
          logger.warn(`Command "${command}" timed out after ${timeoutMs / 1000}s and was killed`);
        } else {
          logger.warn(`Error executing command "${command}": ${error.message}. Exit code: ${error.code}. Stderr: ${stderr}`);
        }
        resolve({ stdout, stderr, exitCode: error.code === undefined ? 1 : error.code });
        return;
      }
      logger.debug(`Command "${command}" executed successfully. Stdout: ${stdout}`);
      resolve({ stdout, stderr, exitCode: 0 });
    });

    armForceKill(childProcess, timeoutMs);
  });
}

/**
 * Executes a program directly via execFile (NO shell involved).
 *
 * Because no shell is spawned, arguments are passed to the program verbatim as
 * a single argv vector: shell metacharacters (`;`, `|`, `$()`, backticks, `&&`,
 * redirections, glob/tilde expansion, word-splitting) have NO special meaning
 * and cannot inject additional commands. This is the injection-safe primitive
 * that MUST be used for any command interpolating externally-controlled input.
 *
 * The return contract and timeout/force-kill handling mirror `execute_command`.
 *
 * @param file The program to run (a fixed literal, never externally controlled).
 * @param args Argument vector — each element is passed literally as one argv entry.
 * @param opts Optional settings (timeoutMs, default 60000).
 */
export function execute_argv(file: string, args: string[], opts: ExecArgvOptions = {}): Promise<CommandResult> {
  return runFile(file, args, undefined, opts.timeoutMs ?? 60000);
}

/**
 * `execute_argv` with `input` written to the child's stdin (e.g. `nft -f -`). The input is
 * never logged, so it may carry what argv must not.
 */
export function execute_argv_input(file: string, args: string[], input: string, opts: ExecArgvOptions = {}): Promise<CommandResult> {
  return runFile(file, args, input, opts.timeoutMs ?? 60000);
}

function runFile(file: string, args: string[], input: string | undefined, timeoutMs: number): Promise<CommandResult> {
  const label = `${file} ${args.join(' ')}`;
  // A child fed input may echo it (`nft -f -` quotes the failing line on stderr), and execFile
  // copies stderr into error.message: with input, outputs are logged by length only.
  const shown = (text: string) => (input === undefined ? text : `<${text.length} chars>`);
  logger.info(`Attempting to execute argv command: ${label}`);

  return new Promise((resolve) => {
    const childProcess = execFile(file, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024, // 1MB buffer
      killSignal: 'SIGTERM',
      env: { ...process.env, LC_ALL: 'C.utf8' }
    }, (error, stdout, stderr) => {
      if (error) {
        const anyError = error as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
        if (anyError.killed) {
          logger.warn(`Command "${label}" timed out after ${timeoutMs / 1000}s and was killed`);
        } else {
          const message = input === undefined ? `${error.message}. ` : '';
          logger.warn(`Error executing command "${label}": ${message}Exit code: ${anyError.code}. Stderr: ${shown(stderr)}`);
        }
        // execFile reports the exit code in error.code (number). A string code
        // (e.g. 'ENOENT') means the program could not be spawned → treat as 1.
        const exitCode = typeof anyError.code === 'number' ? anyError.code : 1;
        resolve({ stdout, stderr, exitCode });
        return;
      }
      logger.debug(`Command "${label}" executed successfully. Stdout: ${shown(stdout)}`);
      resolve({ stdout, stderr, exitCode: 0 });
    });
    // A child that exits before reading its whole input fails the write with EPIPE; its
    // exit code, resolved above, is the outcome that matters.
    if (input !== undefined) {
      childProcess.stdin?.on('error', (err) => logger.debug(`stdin of "${label}" closed early: ${err.message}`));
      childProcess.stdin?.end(input);
    }

    armForceKill(childProcess, timeoutMs);
  });
}

/**
 * Sends SIGKILL to a child still alive FORCE_KILL_GRACE_MS after its
 * timeout, i.e. one that survived the SIGTERM exec/execFile send when the
 * timeout expires. Until it exits, its caller's promise stays pending, and
 * a caller queued behind it (the update features' shared FIFO) waits
 * forever.
 *
 * The child itself is signalled. It is not spawned detached, so it does not
 * lead a process group: the previous `process.kill(-pid, 'SIGKILL')` failed
 * with ESRCH (swallowed) and never reached it.
 */
function armForceKill(childProcess: ChildProcess, timeoutMs: number): void {
  // A child that failed to spawn (e.g. ENOENT) has no pid and never exits.
  if (!childProcess.pid) return;

  const forceKillTimer = setTimeout(() => {
    childProcess.kill('SIGKILL');
  }, timeoutMs + FORCE_KILL_GRACE_MS);

  childProcess.on('exit', () => {
    clearTimeout(forceKillTimer);
  });
}
