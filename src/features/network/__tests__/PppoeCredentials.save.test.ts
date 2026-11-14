import { promises as fs } from 'fs';
import * as execModule from '../../../utils/exec';
import { makePppoeHarness, PppoeHarness, PROFILE_UUID, TOPIC } from './pppoeHarness';

jest.mock('../../../utils/exec');
jest.mock('../../../config', () => ({
  getConfigManager: () => ({ config: require('./pppoeHarness').mockAgentConfig }),
}));

const mockedExec = execModule as jest.Mocked<typeof execModule>;

describe('PppoeCredentials save', () => {
  let h: PppoeHarness;
  beforeEach(async () => {
    h = await makePppoeHarness(mockedExec);
    await h.feature.start();
  });
  afterEach(async () => {
    await h.feature.stop();
    await h.cleanup();
  });

  const typeAndSave = async (username: string, password: string) => {
    expect(await h.mqtt.deliver(TOPIC('username_input/set'), username)).toBe(true);
    expect(await h.mqtt.deliver(TOPIC('password_input/set'), password)).toBe(true);
    expect(await h.mqtt.deliver(TOPIC('command/save_credentials'), 'SAVE_CREDENTIALS')).toBe(true);
  };

  it('receives the form fields through a subscription that matches their set topics', async () => {
    expect(await h.mqtt.deliver(TOPIC('username_input/set'), 'new-user@isp.example')).toBe(true);
    expect(h.mqtt.payloadsOn(TOPIC('username_input/state')).pop()).toBe('{"value":"new-user@isp.example"}');
  });

  it('writes the typed credentials into the keyfile, 0600, and keeps the other keys', async () => {
    await typeAndSave('new-user@isp.example', 'new-secret');
    const text = await fs.readFile(h.keyfile, 'utf8');
    expect(text).toContain('\nusername=new-user@isp.example\n');
    expect(text).toContain('\npassword=new-secret\n');
    expect(text).toContain('parent=eth0.835');
    expect(text).toContain(`uuid=${PROFILE_UUID}`);
    expect((await fs.stat(h.keyfile)).mode & 0o777).toBe(0o600);
    expect(h.calls.find(c => c[0] === 'nmcli' && c.includes('load'))).toEqual(
      ['nmcli', 'connection', 'load', h.keyfile]);
  });

  it('escapes a backslash as the GLib key-file format requires', async () => {
    await typeAndSave('user', 'pa\\ss');
    expect(await fs.readFile(h.keyfile, 'utf8')).toContain('\npassword=pa\\\\ss\n');
  });

  it('never brings an inactive profile up, nor down', async () => {
    h.active = false;
    await typeAndSave('new-user', 'new-secret');
    expect(h.nmcliVerbs()).not.toContain('up');
    expect(h.nmcliVerbs()).not.toContain('down');
    expect(h.lastAction()).toMatch(/^Credentials saved; the connection is inactive and was left down/);
  });

  it('re-activates a profile that was active before the save, by UUID, without a separate down', async () => {
    h.active = true;
    await typeAndSave('new-user', 'new-secret');
    expect(h.calls.filter(c => c[0] === 'nmcli' && c.includes('up'))).toEqual(
      [['nmcli', 'connection', 'up', 'uuid', PROFILE_UUID]]);
    expect(h.nmcliVerbs()).not.toContain('down');
    expect(h.lastAction()).toBe('Credentials saved; connection restarted');
  });

  it('reports a failed reload as an error, and does not touch the link', async () => {
    h.active = true;
    h.failing.add('load');
    await typeAndSave('new-user', 'new-secret');
    expect(h.lastAction()).toMatch(/^Error: /);
    expect(h.lastAction()).not.toMatch(/saved/i);
    expect(h.nmcliVerbs()).not.toContain('up');
  });

  it('reports a failed re-activation as an error', async () => {
    h.active = true;
    h.failing.add('up');
    await typeAndSave('new-user', 'new-secret');
    expect(h.lastAction()).toMatch(/^Error: .*saved.*activation failed/);
  });

  it('refuses to save when NetworkManager cannot say whether the profile is active', async () => {
    h.failing.add('show');
    await typeAndSave('new-user', 'new-secret');
    expect(h.lastAction()).toMatch(/^Error: /);
    expect(await fs.readFile(h.keyfile, 'utf8')).toContain('username=old-user@isp.example');
  });

  it('checks the connection with a NetworkManager status read, never pppd', async () => {
    h.active = true;
    expect(await h.mqtt.deliver(TOPIC('command/test_connection'), 'TEST_CONNECTION')).toBe(true);
    expect(h.calls.some(c => c.includes('pppd'))).toBe(false);
    expect(h.lastAction()).toBe('Connection active');
    h.active = false;
    await h.mqtt.deliver(TOPIC('command/test_connection'), 'TEST_CONNECTION');
    expect(h.lastAction()).toBe('Connection inactive');
  });
});
