// utils/winrm.ts
import { runCommand } from 'winrm-client';
import logger from './logger';
import { getConfigManager } from '../config';

interface WinRMConfig {
  hostname: string;
  username: string;
  password: string;
  port: number;
}

export const WINRM_PASSWORD_ENV_VAR = 'WINDOWS_ADMIN_PASSWORD';

/**
 * A password that can be sent: not empty, and not a public placeholder of the
 * repository (CHANGE_ME*, any case) or an unresolved `${VAR}` reference, the
 * rule serverConfig.ts applies to the wizard token.
 */
function isUsablePassword(password: string): boolean {
  return password !== '' && !password.toUpperCase().startsWith('CHANGE_ME') && !/^\$\{.*\}$/.test(password);
}

/**
 * WinRM Client for executing commands on Windows machines
 * Uses winrm-client (the maintained fork of nodejs-winrm) for direct WinRM
 * protocol communication, which avoids child_process issues when bundled with pkg.
 * nodejs-winrm resolved its failures as Error objects instead of rejecting, so
 * callers parsed an Error as output ("undefined is not a function" on .trim()).
 */
export class WinRMClient {
  private config: WinRMConfig;

  constructor(config: WinRMConfig) {
    this.config = config;
  }

  /**
   * Execute a command on the remote Windows machine
   * @param command The command to execute
   * @returns Promise resolving to the command output
   */
  async executeCommand(command: string): Promise<string> {
    if (!isUsablePassword(this.config.password)) {
      throw new Error(`WinRM password is not set: put ${WINRM_PASSWORD_ENV_VAR} in /etc/mqtt-system-agent.env`);
    }
    logger.debug(`[WinRM] Executing command: ${command}`);
    // Run through cmd.exe: callers pass complete command lines, PowerShell ones included.
    const output = await runCommand(
      command,
      this.config.hostname,
      this.config.username,
      this.config.password,
      this.config.port
    );
    logger.debug(`[WinRM] Command completed successfully`);
    return output;
  }

  /**
   * Get NVIDIA GPU statistics via nvidia-smi
   * @returns CSV string with GPU metrics
   */
  async getNvidiaStats(): Promise<string> {
    const command = 'nvidia-smi --query-gpu=temperature.gpu,utilization.gpu,power.draw,clocks.current.graphics,clocks.current.memory,fan.speed,pstate --format=csv,noheader,nounits';
    return this.executeCommand(command);
  }

  /**
   * Check if a Windows process is running
   * @param processName The name of the process (e.g., "sunshine.exe")
   * @returns Promise resolving to tasklist output
   */
  async getTasklist(processName: string): Promise<string> {
    // Use findstr instead of /FI filter for better compatibility with localized Windows
    const command = `tasklist /NH | findstr /i ${processName}`;
    return this.executeCommand(command);
  }

  /**
   * Check if a process is running
   * @param processName The name of the process
   * @returns True if process is running
   */
  async isProcessRunning(processName: string): Promise<boolean> {
    try {
      const output = await this.getTasklist(processName);
      return output.includes(processName);
    } catch (error) {
      logger.error(`[WinRM] Error checking process ${processName}:`, error);
      return false;
    }
  }
}

/**
 * Factory function to create a configured WinRMClient
 * Reads configuration from agent.yaml windows_vm section
 * Falls back to environment variables if not found in config, except for the
 * password: WINDOWS_ADMIN_PASSWORD wins over the YAML, whose shipped
 * placeholder each package upgrade puts back, as for the agent's other secrets.
 */
export function createWinRMClient(): WinRMClient {
  const configManager = getConfigManager();
  const windowsVmConfig = configManager.config.windows_vm;

  const config: WinRMConfig = {
    hostname: windowsVmConfig?.hostname || process.env.WINDOWS_HOSTNAME || '192.168.3.2',
    username: windowsVmConfig?.username || process.env.WINDOWS_ADMIN_USERNAME || 'Administrateur',
    password: process.env[WINRM_PASSWORD_ENV_VAR] || windowsVmConfig?.password || '',
    port: windowsVmConfig?.port || parseInt(process.env.WINDOWS_PORT || '5985', 10)
  };

  logger.info(`[WinRM] Creating client for ${config.hostname}:${config.port} as ${config.username}`);
  if (!isUsablePassword(config.password)) {
    logger.error(`[WinRM] No usable password (missing or placeholder): set ${WINRM_PASSWORD_ENV_VAR}; WinRM commands are refused until then.`);
  }

  return new WinRMClient(config);
}
