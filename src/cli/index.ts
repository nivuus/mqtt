import { EventSender } from './EventSender';

/**
 * Dispatch CLI commands for alerts and events
 */
export async function runCli(command: string, args: any): Promise<void> {
  if (command === 'event') {
    return EventSender.send(args);
  }
  throw new Error(`Unknown CLI command: ${command}. Only 'event' is supported.`);
}