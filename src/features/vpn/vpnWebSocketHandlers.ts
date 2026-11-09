/**
 * WebSocket API of the guest VPN: `vpn.import_profile` and `vpn.get_status`.
 * Params carry the VPN password and the `.ovpn` text, so errors name the offending
 * field only, never its value.
 */
import { BaseFeature } from '../../core/BaseFeature';
import { FeatureHandlers } from '../../websocket/types';
import { WizardHandler } from '../../websocket/WizardHandler';
import { GuestVpn } from './GuestVpn';
import { GuestVpnStatus } from './guestVpnStatus';
import { ProfileInput } from './nmGuestVpn';

/** What the handlers need from the feature. */
export interface GuestVpnApi {
  importProfile(input: ProfileInput): Promise<GuestVpnStatus>;
  getStatus(): Promise<GuestVpnStatus>;
}

function requiredString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== 'string') throw new Error(`Invalid ${key} parameter: a string is required`);
  return value;
}

function parseProfileParams(params: Record<string, unknown>): ProfileInput {
  const input: ProfileInput = {
    ovpn: requiredString(params, 'ovpn'),
    username: requiredString(params, 'username'),
    password: requiredString(params, 'password'),
  };
  if (params.ca !== undefined) input.ca = requiredString(params, 'ca');
  return input;
}

export function createVpnHandlers(vpn: GuestVpnApi): FeatureHandlers {
  return {
    import_profile: async (params) => vpn.importProfile(parseProfileParams(params)),
    get_status: async () => vpn.getStatus(),
  };
}

/** Registers the `vpn` feature when the agent runs a GuestVpn; otherwise does nothing. */
export function registerGuestVpnHandlers(wizard: WizardHandler | null, features: BaseFeature[]): void {
  const vpn = features.find((f): f is GuestVpn => f instanceof GuestVpn);
  if (wizard && vpn) wizard.registerFeature('vpn', createVpnHandlers(vpn));
}
