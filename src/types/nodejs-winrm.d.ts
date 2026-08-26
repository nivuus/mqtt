// Type definitions for nodejs-winrm
// Based on the nodejs-winrm library implementation

declare module 'nodejs-winrm' {
  interface WinRMParams {
    host: string;
    port: number;
    path: string;
    auth: string;
    shellId?: string;
    command?: string;
    commandId?: string;
  }

  interface WinRMNamespace {
    shell: {
      doCreateShell(params: WinRMParams): Promise<string>;
      doDeleteShell(params: WinRMParams): Promise<void>;
    };
    command: {
      doExecuteCommand(params: WinRMParams): Promise<string>;
      doReceiveOutput(params: WinRMParams): Promise<string>;
    };
  }

  /**
   * Execute a command on a remote Windows machine using WinRM
   * @param command The command to execute
   * @param host The hostname or IP address
   * @param username The username for authentication
   * @param password The password for authentication
   * @param port The WinRM port (default 5985 for HTTP)
   * @param returnStdout Whether to return stdout (default false)
   * @returns Promise resolving to command output if returnStdout is true
   */
  export function runCommand(
    command: string,
    host: string,
    username: string,
    password: string,
    port?: number,
    returnStdout?: boolean
  ): Promise<string>;

  export const shell: WinRMNamespace['shell'];
  export const command: WinRMNamespace['command'];
}
