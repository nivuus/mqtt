import { MqttMessageSender } from './MqttMessageSender';

/**
 * Sender for alert CLI command.
 */
export class AlertSender {
  static async send(args: any): Promise<void> {
    const message = args.message || args._[1];
    if (!message) {
      throw new Error('Alert message is required. Use --message "<message>" or positional argument.');
    }
    const alert: Record<string, any> = {
      level: args.level || args.severity || 'info',
      message,
      timestamp: new Date().toISOString(),
    };
    if (args.id) alert.id = args.id;
    await MqttMessageSender.send('alert', alert);
    console.log('Alert sent:', alert);
  }
}