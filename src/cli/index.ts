import { EventSender } from './EventSender';

/**
 * One-shot CLI commands. `event` is the only one: an `alert` command was
 * routed here for years but never handled (its sender published to the event
 * topic anyway). Alerts come from the features themselves (UPS, split lock),
 * on `<base_topic>/<id>/alert`.
 */
export const CLI_COMMANDS = ['event'] as const;

/**
 * Any positional command runs the CLI, which rejects the unknown ones: only a
 * bare invocation (systemd passes `--config` alone) starts the agent, so a
 * mistyped or retired command fails instead of starting a second agent.
 */
export function selectMode(command: string | undefined): 'agent' | 'cli' {
  return command === undefined ? 'agent' : 'cli';
}

export async function runCli(command: string, args: any): Promise<void> {
  if (command === 'event') {
    return EventSender.send(args);
  }
  throw new Error(`Unknown CLI command: ${command}. Supported: ${CLI_COMMANDS.join(', ')}.`);
}
