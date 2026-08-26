// src/utils/exec_stream.ts
import { spawn, ChildProcess } from 'child_process';
import logger from './logger';

/**
 * Executes a command and provides access to its output streams.
 * Suitable for long-running commands that continuously produce output (e.g., tail -F).
 * @param command The command string to execute (e.g., "tail").
 * @param args An array of string arguments for the command (e.g., ["-F", "/var/log/syslog"]).
 * @returns The spawned ChildProcess instance.
 */
export function execute_stream_command(command: string, args: string[]): ChildProcess {
  logger.info(`Spawning stream command: ${command} ${args.join(' ')}`);
  
  // By default, spawn will use the system shell if { shell: true } is passed.
  // For commands like 'tail', it's often better to execute directly.
  // However, if complex shell features are needed in the command string, shell: true might be required.
  // For `tail -F`, direct execution is fine.
  const childProcess = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'], // stdin, stdout, stderr
    detached: false, // Typically false unless you need to detach
  });

  childProcess.on('error', (error) => {
    logger.error(`Error spawning command "${command} ${args.join(' ')}": ${error.message}`);
  });

  // Optional: Log when the process exits, for debugging.
  childProcess.on('exit', (code, signal) => {
    logger.debug(`Command "${command} ${args.join(' ')}" exited with code ${code} and signal ${signal}`);
  });

  return childProcess;
}
