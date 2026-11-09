import { promises as fs } from 'fs';
import * as execModule from '../../../utils/exec';
import { NmGuestVpn } from '../nmGuestVpn';
import { writeDesiredEnabled } from '../desiredState';
import { FakeNm, fail } from './fakeNmcli';

jest.mock('../../../utils/exec');
const mockedExec = execModule as jest.Mocked<typeof execModule>;

const OVPN = ['client', 'remote vpn.example.com 1194', 'auth-user-pass', '<ca>', 'X', '</ca>'].join('\n');
const ID = 'nivuus-guest-vpn';
const SETTINGS = (a: string[]) => a[1] === 'modify' && a.includes('ipv4.route-table');

describe('NmGuestVpn.importProfile: replacing the live profile', () => {
  let nm: FakeNm;
  beforeEach(async () => { nm = new FakeNm(); await nm.install(mockedExec); });
  afterEach(async () => { await nm.remove(); });

  const vpn = () => new NmGuestVpn(nm.cfg, nm.env);
  const importIt = (v = vpn()) => v.importProfile({ ovpn: OVPN, username: 'u', password: 'p' });

  it('a rejected import keeps the live profile, its keyfile and its certificates', async () => {
    const live = await nm.addProfile(ID, 'nivuus-guest-vpn_a', true);
    nm.override = a => (SETTINGS(a) ? fail('Error: invalid property') : undefined);
    await expect(importIt()).rejects.toThrow(/invalid property/);
    expect([...nm.profiles.keys()]).toEqual([live.uuid]);
    expect(nm.ids()).toEqual([ID]);
    await expect(fs.stat(live.keyfile)).resolves.toBeDefined();
    expect(await nm.certs()).toEqual(['nivuus-guest-vpn_a-ca.pem']);
    expect(nm.active.has(live.uuid)).toBe(true);
    expect(nm.find(a => a[1] === 'down')).toHaveLength(0);
  });

  it('a failed rename keeps the live profile and discards the staging one', async () => {
    const live = await nm.addProfile(ID, 'nivuus-guest-vpn_a');
    nm.override = a => (a.includes('connection.id') ? fail('Error: rename refused') : undefined);
    await expect(importIt()).rejects.toThrow(/rename refused/);
    expect([...nm.profiles.keys()]).toEqual([live.uuid]);
    expect(await nm.certs()).toEqual(['nivuus-guest-vpn_a-ca.pem']);
  });

  it('reports both errors when removing the staging profile fails too', async () => {
    nm.override = a => (SETTINGS(a) ? fail('Error: invalid property')
      : a[1] === 'delete' ? fail('Error: NetworkManager is not running.') : undefined);
    await expect(importIt()).rejects.toThrow(/invalid property.*not running/);
  });

  it('renames the new profile first, then deletes the old one by UUID with its certificates', async () => {
    const old = await nm.addProfile(ID, 'nivuus-guest-vpn_a');
    await expect(importIt()).resolves.toEqual({ activation: 'skipped' });
    const [fresh] = nm.uuidsOf(ID);
    expect(fresh).not.toBe(old.uuid);
    expect(nm.ids()).toEqual([ID]);
    expect(nm.keyfileBase(ID)).toBe('nivuus-guest-vpn_b');
    await expect(fs.stat(old.keyfile)).rejects.toThrow();
    expect(await nm.certs()).toEqual(['nivuus-guest-vpn_b-ca.pem']);
    const rename = nm.calls.findIndex(c => c.args.includes('connection.id'));
    const del = nm.calls.findIndex(c => c.args[1] === 'delete');
    expect(nm.calls[rename].args).toEqual(['connection', 'modify', 'uuid', fresh, 'connection.id', ID]);
    expect(nm.calls[del].args).toEqual(['connection', 'delete', 'uuid', old.uuid]);
    expect(rename).toBeLessThan(del);
    expect(nm.verbs().indexOf('connection load')).toBeLessThan(rename);
  });

  it('a failed delete of the old profile throws with both UUIDs and keeps the new one live', async () => {
    const old = await nm.addProfile(ID, 'nivuus-guest-vpn_a');
    await writeDesiredEnabled(nm.cfg.stateFile, true);
    nm.override = a => (a[1] === 'delete' && a.includes(old.uuid) ? fail('Error: permission denied') : undefined);
    const v = vpn();
    const err = await importIt(v).catch((e: Error) => e);
    const fresh = nm.uuidsOf(ID).find(u => u !== old.uuid) as string;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain(fresh);
    expect((err as Error).message).toContain(old.uuid);
    expect((err as Error).message).toMatch(/permission denied/);
    expect(await nm.certs()).toEqual(['nivuus-guest-vpn_a-ca.pem', 'nivuus-guest-vpn_b-ca.pem']);
    // Both share the id now; the instance resolves to the one it staged and reports the duplicate.
    await v.up();
    expect(nm.find(a => a[1] === 'up').map(c => c.args[3])).toEqual([fresh]);
    expect(v.duplicateProfileError()).toMatch(new RegExp(`2 profiles named ${ID}.*${old.uuid}`));
  });

  it('staging basenames alternate so a new import never overwrites live certificate files', async () => {
    const bases: string[] = [];
    for (let i = 0; i < 3; i++) {
      await importIt();
      bases.push(nm.keyfileBase(ID));
    }
    expect(bases).toEqual(['nivuus-guest-vpn_a', 'nivuus-guest-vpn_b', 'nivuus-guest-vpn_a']);
    expect(await nm.certs()).toEqual(['nivuus-guest-vpn_a-ca.pem']);
  });

  it('a profile from an older import (named after the id) is replaced and its certificates removed', async () => {
    await nm.addProfile(ID, ID);
    await importIt();
    expect(nm.keyfileBase(ID)).toBe('nivuus-guest-vpn_a');
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
    expect(nm.ids()).toEqual([ID]);
  });

  it('takes an active live profile down and waits for the tun device to go before activating', async () => {
    const old = await nm.addProfile(ID, 'nivuus-guest-vpn_a', true);
    await writeDesiredEnabled(nm.cfg.stateFile, true);
    nm.downRemovesDevice = false;
    let polls = 0;
    nm.env.sleep = async () => { if (++polls === 3) await fs.rm(nm.device(), { recursive: true }); };
    await expect(importIt()).resolves.toEqual({ activation: 'activated' });
    expect(polls).toBe(3);
    const [fresh] = nm.uuidsOf(ID);
    const order = nm.verbs();
    expect(nm.find(a => a[1] === 'down')[0].args).toEqual(['connection', 'down', 'uuid', old.uuid]);
    expect(order.indexOf('connection down')).toBeLessThan(order.indexOf('connection delete'));
    expect(order.lastIndexOf('connection up')).toBeGreaterThan(order.indexOf('connection delete'));
    expect(nm.find(a => a[1] === 'up')[0].args).toEqual(['connection', 'up', 'uuid', fresh, 'ifname', 'publicBridge']);
  });

  it('calls onLiveTunnelDown once the old tunnel is gone, before the rename and any activation', async () => {
    await nm.addProfile(ID, 'nivuus-guest-vpn_a', true);
    await writeDesiredEnabled(nm.cfg.stateFile, true);
    const seen: string[][] = [];
    await vpn().importProfile({ ovpn: OVPN, username: 'u', password: 'p' }, async () => { seen.push(nm.verbs()); });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('connection down');
    expect(seen[0]).not.toContain('connection up');
    expect(seen[0].filter(v => v === 'connection modify')).toHaveLength(1); // settings only, not the rename
  });

  it('calls onLiveTunnelDown even when no tunnel was up (the table may still hold a DNAT)', async () => {
    await nm.addProfile(ID, 'nivuus-guest-vpn_a');
    const onDown = jest.fn(async () => undefined);
    await vpn().importProfile({ ovpn: OVPN, username: 'u', password: 'p' }, onDown);
    expect(onDown).toHaveBeenCalledTimes(1);
  });

  it('a failing onLiveTunnelDown fails the import and keeps the old profile', async () => {
    const old = await nm.addProfile(ID, 'nivuus-guest-vpn_a', true);
    await expect(vpn().importProfile({ ovpn: OVPN, username: 'u', password: 'p' },
      async () => { throw new Error('nft could not apply'); })).rejects.toThrow(/nft could not apply/);
    expect([...nm.profiles.keys()]).toEqual([old.uuid]);
    expect(nm.find(a => a[1] === 'up')).toHaveLength(0);
  });

  it('fails the import when the tun device outlives the bounded wait, keeping the old profile', async () => {
    const old = await nm.addProfile(ID, 'nivuus-guest-vpn_a', true);
    nm.downRemovesDevice = false;
    await expect(importIt()).rejects.toThrow(/nvguest0 still present/);
    expect([...nm.profiles.keys()]).toEqual([old.uuid]);
    expect(nm.ids()).toEqual([ID]);
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
    expect(nm.keyfileBase(ID)).toBe('nivuus-guest-vpn_b');
  });
});
