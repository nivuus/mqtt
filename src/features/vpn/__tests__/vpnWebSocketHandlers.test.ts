import { randomBytes } from 'crypto';
import { createVpnHandlers, GuestVpnApi } from '../vpnWebSocketHandlers';
import { WizardHandler } from '../../../websocket/WizardHandler';
import { WizardCommand } from '../../../websocket/types';
import { handleClientMessage } from '../../../websocket/sessionProtocol';
import logger from '../../../utils/logger';

jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), setLevel: jest.fn() },
}));

const status = { state: 'connected' as const, dns: [] as string[] };
// Built at runtime so secret scanners do not flag a literal.
const SECRET = `secret-${randomBytes(8).toString('hex')}`;
const OVPN = 'client\nremote vpn.example 1194\n';

function fakeVpn(): jest.Mocked<GuestVpnApi> {
  return { importProfile: jest.fn().mockResolvedValue(status), getStatus: jest.fn().mockResolvedValue(status) };
}

describe('vpn WebSocket handlers', () => {
  it.each([
    [{ username: 'u', password: 'p' }, 'ovpn'],
    [{ ovpn: OVPN, password: 'p' }, 'username'],
    [{ ovpn: OVPN, username: 'u' }, 'password'],
    [{ ovpn: 42, username: 'u', password: 'p' }, 'ovpn'],
    [{ ovpn: OVPN, username: ['u'], password: 'p' }, 'username'],
    [{ ovpn: OVPN, username: 'u', password: { secret: SECRET } }, 'password'],
    [{ ovpn: OVPN, username: 'u', password: 'p', ca: 7 }, 'ca'],
  ])('import_profile rejects missing or non-string params %#', async (params, field) => {
    const vpn = fakeVpn();
    const call = createVpnHandlers(vpn).import_profile(params as Record<string, unknown>);
    await expect(call).rejects.toThrow(`Invalid ${field} parameter`);
    expect(vpn.importProfile).not.toHaveBeenCalled();
  });

  it('import_profile forwards to GuestVpn.importProfile and returns its status', async () => {
    const vpn = fakeVpn();
    const input = { ovpn: OVPN, ca: 'CA', username: 'üser-名前', password: SECRET };
    await expect(createVpnHandlers(vpn).import_profile({ ...input })).resolves.toBe(status);
    expect(vpn.importProfile).toHaveBeenCalledWith(input);
  });

  it('import_profile omits ca when absent', async () => {
    const vpn = fakeVpn();
    await createVpnHandlers(vpn).import_profile({ ovpn: OVPN, username: 'u', password: 'p' });
    expect(vpn.importProfile).toHaveBeenCalledWith({ ovpn: OVPN, username: 'u', password: 'p' });
  });

  it('get_status returns the feature status', async () => {
    const vpn = fakeVpn();
    await expect(createVpnHandlers(vpn).get_status({})).resolves.toBe(status);
  });

  it('registered handlers keep the own-property action guard', async () => {
    const wizard = new WizardHandler();
    wizard.registerFeature('vpn', createVpnHandlers(fakeVpn()));
    const cmd = (action: string): WizardCommand => ({ id: '1', type: 'action', feature: 'vpn', action, params: {} });
    await expect(wizard.handleCommand(cmd('toString'))).rejects.toThrow('Unknown action');
    await expect(wizard.handleCommand(cmd('get_status'))).resolves.toBe(status);
  });

  it('registerFeature refuses a name that is already registered', () => {
    const wizard = new WizardHandler();
    expect(() => wizard.registerFeature('network', {})).toThrow('Feature network is already registered');
    wizard.registerFeature('vpn', createVpnHandlers(fakeVpn()));
    expect(() => wizard.registerFeature('vpn', {})).toThrow('Feature vpn is already registered');
  });

  it('never logs the params of vpn commands, on success or failure', async () => {
    const wizard = new WizardHandler();
    const vpn = fakeVpn();
    wizard.registerFeature('vpn', createVpnHandlers(vpn));
    const ws = { readyState: 1, send: jest.fn() } as any;
    const client = { id: 'c1', authenticated: true } as any;
    const send = (params: object) => handleClientMessage(ws, client, Buffer.from(JSON.stringify(
      { id: '1', type: 'action', feature: 'vpn', action: 'import_profile', params })), 't', wizard);
    await send({ ovpn: OVPN, username: 'u', password: SECRET });
    vpn.importProfile.mockRejectedValueOnce(new Error('profile refused'));
    await send({ ovpn: OVPN, username: 'u', password: SECRET });
    await send({ ovpn: OVPN, username: 'u', password: 12345 });
    const logged = JSON.stringify(Object.values(logger).flatMap(f => (f as jest.Mock).mock.calls));
    expect(logged).toContain('vpn.import_profile');
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain('vpn.example');
    expect(JSON.stringify(ws.send.mock.calls)).not.toContain(SECRET);
  });
});
