// "Firewall": status, where each interface sits, each zone's rules, the forms.

import {
  heading, tile, pressTile, entities, row, markdown, section, view,
} from '../cards.js';
import { zoneTile } from './network.js';
import { zoneRules } from './templates.js';

export function firewall(m, t) {
  const f = m.firewall;
  const firewalld = m.services.find((s) => s.name === 'firewalld');
  // Zones holding no interface and no rule are firewalld's stock ones: noise.
  const zones = f.zones.filter((z) => z.interfaces.length || z.ruleCount);
  return view('firewall', t('view.firewall'), 'mdi:shield-half-full', [
    section([
      heading(t('section.firewall'), 'mdi:shield-check'),
      tile(firewalld?.status, { name: t('name.firewalld') }),
      tile(f.activeZones, { name: t('name.activeZones') }),
      tile(f.lastAction, { name: t('name.lastAction') }),
      pressTile(firewalld?.restart, t('action.restartFirewalld'), 'mdi:restart', t('confirm.firewallRestart')),
    ]),
    section([
      heading(t('section.interfaces'), 'mdi:ethernet'),
      markdown(t('help.zoneChange')),
      ...f.interfaces.map((i) => zoneTile(i.zoneSelect, t, t.iface(i.name))),
    ]),
    ...zones.map((z) => zone(z, t)),
    portForm(f.portForm, t),
    forwardForm(f.forwardForm, t),
  ]);
}

function zone(z, t) {
  return section([
    heading(t('name.zone', { zone: z.name }), 'mdi:shield-outline', z.masquerade && {
      badges: [{ type: 'entity', entity: z.masquerade, name: t('name.masquerade'), show_name: true, show_state: true }],
    }),
    z.interfaces.length && markdown(z.interfaces.map((i) => `\`${t.iface(i)}\``).join(' ')),
    markdown(zoneRules(z, t)),
  ]);
}

function portForm(p, t) {
  return section([
    heading(t('section.portsServices'), 'mdi:door-open'),
    markdown(t('help.portForm')),
    entities([
      row(p.port, t('name.port')),
      row(p.service, t('name.service')),
      row(p.protocol, t('name.protocol')),
      row(p.zone, t('name.zoneField')),
    ]),
    pressTile(p.addPort, t('action.openPort'), 'mdi:door-open', t('confirm.firewallChange')),
    pressTile(p.removePort, t('action.closePort'), 'mdi:door-closed', t('confirm.firewallChange')),
    pressTile(p.addService, t('action.allowService'), 'mdi:plus-circle', t('confirm.firewallChange')),
    pressTile(p.removeService, t('action.removeService'), 'mdi:minus-circle', t('confirm.firewallChange')),
  ]);
}

function forwardForm(f, t) {
  return section([
    heading(t('section.forwards'), 'mdi:arrow-right-bold'),
    entities([
      row(f.port, t('name.sourcePort')),
      row(f.toAddress, t('name.toAddress')),
      row(f.toPort, t('name.toPort')),
      row(f.protocol, t('name.protocol')),
      row(f.zone, t('name.zoneField')),
    ]),
    pressTile(f.add, t('action.addForward'), 'mdi:plus', t('confirm.firewallChange')),
    pressTile(f.remove, t('action.removeForward'), 'mdi:minus', t('confirm.firewallChange')),
  ]);
}
