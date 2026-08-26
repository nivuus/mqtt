import { MqttMessageSender } from './MqttMessageSender';

/**
 * Sender for event CLI command.
 */
export class EventSender {
  static async send(args: any): Promise<void> {
    const eventType = args.type || args._[1];
    if (!eventType) {
      throw new Error('Event type is required. Use --type "<type>" or positional argument.');
    }
    // Parse payload JSON and flatten into top-level event fields
    const parsedPayload = args.payload ? JSON.parse(args.payload) : {};
    const event: Record<string, any> = {
      type: eventType,
      timestamp: new Date().toISOString(),
      ...parsedPayload,
    };
    if (args.id) event.id = args.id;
    if (args.severity) event.severity = args.severity;
    await MqttMessageSender.send('event', event);
    console.log('Event sent:', event);
  }
}