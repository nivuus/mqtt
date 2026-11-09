import { promises as fs } from 'fs';
import * as path from 'path';
import * as execModule from '../../../utils/exec';
import { NmGuestVpn } from '../nmGuestVpn';
import { writeDesiredEnabled } from '../desiredState';
import { FakeNm, fail } from './fakeNmcli';

jest.mock('../../../utils/exec');
const mockedExec = execModule as jest.Mocked<typeof execModule>;

const OVPN = ['client', 'remote vpn.example.com 1194', 'auth-user-pass', '<ca>', 'X', '</ca>'].join('\n');
const ID = 'nivuus-guest-vpn';

describe('NmGuestVpn.importProfile: replacing the live profile', () => {
  let nm: FakeNm;
  beforeEach(async () => { nm = new FakeNm(); await nm.install(mockedExec); });
  afterEach(async () => { await nm.remove(); });

  const vpn = () => new NmGuestVpn(nm.cfg, nm.env);
  const importIt = (v = vpn()) => v.importProfile({ ovpn: OVPN, username: 'u', password: 'p' });
  const keyfileBase = (id: string) => path.basename(nm.profiles.get(id) as string, '.nmconnection');

  it('a rejected import keeps the live profile, its keyfile and its certificates', async () => {
    const liveKeyfile = await nm.addProfile(ID, 'nivuus-guest-vpn_a', true);
    nm.override = a => (a[1] === 'modify' && a.includes('ipv4.route-table') ? fail('Error: invalid property') : undefined);
    await expect(importIt()).rejects.toThrow(/invalid property/);
    expect([...nm.profiles.keys()]).toEqual([ID]);
    expect(nm.profiles.get(ID)).toBe(liveKeyfile);
    await expect(fs.stat(liveKeyfile)).resolves.toBeDefined();
    expect(await nm.certs()).toEqual(['nivuus-guest-vpn_a-ca.pem']);
    expect(nm.active.has(ID)).toBe(true);
    expect(nm.find(a => a[1] === 'delete').map(c => c.args[3])).toEqual(['nivuus-guest-vpn_b']);
    expect(nm.find(a => a[1] === 'down')).toHaveLength(0);
  });

  it('reports both errors when removing the staging profile fails too', async () => {
    nm.override = a => (a[1] === 'modify' && a.includes('ipv4.route-table') ? fail('Error: invalid property')
      : a[1] === 'delete' ? fail('Error: NetworkManager is not running.') : undefined);
    await expect(importIt()).rejects.toThrow(/invalid property.*not running/);
  });

  it('a successful replace swaps the staging profile in and removes the old one and its certificates', async () => {
    const oldKeyfile = await nm.addProfile(ID, 'nivuus-guest-vpn_a');
    await expect(importIt()).resolves.toEqual({ activation: 'skipped' });
    expect([...nm.profiles.keys()]).toEqual([ID]);
    expect(keyfileBase(ID)).toBe('nivuus-guest-vpn_b');
    await expect(fs.stat(oldKeyfile)).rejects.toThrow();
    expect(await nm.certs()).toEqual(['nivuus-guest-vpn_b-ca.pem']);
    const order = nm.verbs();
    expect(order.indexOf('connection load')).toBeLessThan(order.indexOf('connection delete'));
    expect(nm.find(a => a.includes('connection.id'))[0].args)
      .toEqual(['connection', 'modify', 'id', 'nivuus-guest-vpn_b', 'connection.id', ID]);
  });

  it('staging basenames alternate so a new import never overwrites live certificate files', async () => {
    const bases: string[] = [];
    for (let i = 0; i < 3; i++) {
      await importIt();
      bases.push(keyfileBase(ID));
    }
    expect(bases).toEqual(['nivuus-guest-vpn_a', 'nivuus-guest-vpn_b', 'nivuus-guest-vpn_a']);
    expect(await nm.certs()).toEqual(['nivuus-guest-vpn_a-ca.pem']);
  });

  it('a profile from an older import (named after the id) is replaced and its certificates removed', async () => {
    await nm.addProfile(ID, ID);
    await importIt();
    expect(keyfileBase(ID)).toBe('nivuus-guest-vpn_a');
    expect(await nm.certs()).toEqual(['nivuus-guest-vpn_a-ca.pem']);
  });

  it('never deletes certificate files of a live profile under a name the agent did not choose', async () => {
    await nm.addProfile(ID, 'alkmaar');
    await importIt();
    expect(await nm.certs()).toEqual(['alkmaar-ca.pem', 'nivuus-guest-vpn_a-ca.pem']);
  });

  it('removes a staging profile left by an interrupted import before importing', async () => {
    await nm.addProfile(ID, 'nivuus-guest-vpn_b');
    await nm.addProfile('nivuus-guest-vpn_a', 'nivuus-guest-vpn_a');
    await importIt();
    expect(nm.verbs().indexOf('connection delete')).toBeLessThan(nm.verbs().indexOf('connection import'));
    expect([...nm.profiles.keys()]).toEqual([ID]);
  });

  it('takes an active live profile down and waits for the tun device to go before activating', async () => {
    await nm.addProfile(ID, 'nivuus-guest-vpn_a', true);
    await writeDesiredEnabled(nm.cfg.stateFile, true);
    nm.downRemovesDevice = false;
    let polls = 0;
    nm.env.sleep = async () => { if (++polls === 3) await fs.rm(nm.device(), { recursive: true }); };
    await expect(importIt()).resolves.toEqual({ activation: 'activated' });
    expect(polls).toBe(3);
    const order = nm.verbs();
    expect(order.indexOf('connection down')).toBeLessThan(order.indexOf('connection delete'));
    expect(order.lastIndexOf('connection up')).toBeGreaterThan(order.lastIndexOf('connection modify'));
    expect(nm.find(a => a[1] === 'up')[0].args).toEqual(['connection', 'up', 'id', ID, 'ifname', 'publicBridge']);
  });

  it('fails the import when the tun device outlives the bounded wait, keeping the old profile', async () => {
    await nm.addProfile(ID, 'nivuus-guest-vpn_a', true);
    nm.downRemovesDevice = false;
    await expect(importIt()).rejects.toThrow(/nvguest0 still present/);
    expect([...nm.profiles.keys()]).toEqual([ID]);
    expect(keyfileBase(ID)).toBe('nivuus-guest-vpn_a');
  });

  it('reports an activation failure separately: the profile was still replaced', async () => {
    await nm.addProfile(ID, 'nivuus-guest-vpn_a');
    await writeDesiredEnabled(nm.cfg.stateFile, true);
    nm.override = a => (a[1] === 'up' ? fail('Error: Connection activation failed: auth failed\n') : undefined);
    const v = vpn();
    await expect(importIt(v)).resolves.toEqual({
      activation: 'failed', error: 'Error: Connection activation failed: auth failed',
    });
    expect(v.lastActivationError()).toBe('Error: Connection activation failed: auth failed');
    expect(keyfileBase(ID)).toBe('nivuus-guest-vpn_b');
  });
});
