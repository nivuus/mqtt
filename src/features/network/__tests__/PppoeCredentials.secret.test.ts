import { promises as fs } from 'fs';
import * as execModule from '../../../utils/exec';
import { makePppoeHarness, OLD_SECRET, PppoeHarness, TOPIC } from './pppoeHarness';

jest.mock('../../../utils/exec');
jest.mock('../../../config', () => ({
  getConfigManager: () => ({ config: require('./pppoeHarness').mockAgentConfig }),
}));

const mockedExec = execModule as jest.Mocked<typeof execModule>;

describe('PppoeCredentials never publishes the ISP password', () => {
  let h: PppoeHarness;
  beforeEach(async () => {
    h = await makePppoeHarness(mockedExec);
    await h.feature.start();
  });
  afterEach(async () => {
    await h.feature.stop();
    await h.cleanup();
  });

  it('publishes nothing that contains the stored secret, and overwrites the retained password state', async () => {
    expect(h.mqtt.allPayloads().filter(p => p.includes(OLD_SECRET))).toEqual([]);
    const passwordStates = h.mqtt.publishedMessages.filter(m => m.topic === TOPIC('password_input/state'));
    expect(passwordStates.map(m => [String(m.message), m.options?.retain])).toEqual([['{"value":""}', true]]);
    expect(h.mqtt.payloadsOn(TOPIC('username_input/state'))).toEqual(['{"value":"old-user@isp.example"}']);
  });

  it('does not echo a newly typed password, and says it is staged', async () => {
    await h.send('password_input/set', 'typed-secret-91');
    expect(h.mqtt.allPayloads().filter(p => p.includes('typed-secret-91'))).toEqual([]);
    expect(h.lastAction()).toBe('New password staged; press Save to apply it');
  });

  it('keeps the stored password when only the username is changed', async () => {
    await h.send('username_input/set', 'renamed@isp.example');
    await h.send('command/save_credentials', 'SAVE_CREDENTIALS');
    const text = await fs.readFile(h.keyfile, 'utf8');
    expect(text).toContain('\nusername=renamed@isp.example\n');
    expect(text).toContain(`\npassword=${OLD_SECRET}\n`);
    expect(h.lastAction()).toMatch(/^Credentials saved/);
  });

  it('forgets a staged password once it is saved', async () => {
    await h.send('password_input/set', 'typed-secret-91');
    await h.send('command/save_credentials', 'SAVE_CREDENTIALS');
    await fs.writeFile(h.keyfile, (await fs.readFile(h.keyfile, 'utf8')).replace('typed-secret-91', 'rotated-elsewhere'));
    await h.send('command/save_credentials', 'SAVE_CREDENTIALS');
    expect(await fs.readFile(h.keyfile, 'utf8')).toContain('\npassword=rotated-elsewhere\n');
  });
});
