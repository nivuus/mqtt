// "Wi-Fi": access point state, one section per network, the add form.
//
// Typing in a field only stages the value on the agent; nothing reaches
// hostapd until Apply (or Add) is pressed. The confirmations say what the
// press costs the clients, as the agent documents it.

import {
  heading, tile, pressTile, entities, row, markdown, section, view,
} from '../cards.js';

export function wifi(m, t) {
  const w = m.wifi;
  const hostapd = m.services.find((s) => s.name === 'hostapd');
  return view('wifi', t('view.wifi'), [
    section([
      heading(t('section.accessPoint'), 'mdi:access-point'),
      tile(hostapd?.status, { name: t('name.hostapd') }),
      tile(w.summary, { name: t('name.networks'), icon: 'mdi:wifi' }),
      tile(w.lastAction, { name: t('name.lastAction') }),
      pressTile(w.reload, t('action.reloadHostapd'), 'mdi:reload', t('confirm.wifiReload')),
      pressTile(hostapd?.restart, t('action.restartHostapd'), 'mdi:restart', t('confirm.wifiRestart')),
    ]),
    ...w.networks.map((n) => network(n, t)),
    addNetwork(w.newNetwork, t),
  ]);
}

function network(n, t) {
  return section([
    heading(n.label || t('name.network', { n: n.n }), 'mdi:wifi', n.status && {
      badges: [{ type: 'entity', entity: n.status, show_state: true, show_icon: false }],
    }),
    n.bridge && markdown(t('help.wifiBridge', { bridge: t.bridge(n.bridge) })),
    entities([
      row(n.ssid, t('name.ssid')),
      row(n.password, t('name.password')),
      row(n.security, t('name.security')),
    ]),
    pressTile(n.apply, t('action.apply'), 'mdi:check-circle', t('confirm.wifiApply')),
    pressTile(n.delete, t('action.delete'), 'mdi:delete', t('confirm.wifiDelete', { ssid: n.label ?? '' })),
  ]);
}

function addNetwork(f, t) {
  return section([
    heading(t('section.addNetwork'), 'mdi:wifi-plus'),
    markdown(t('help.addNetwork')),
    entities([
      row(f.ssid, t('name.ssid')),
      row(f.password, t('name.password')),
      row(f.security, t('name.security')),
      row(f.bridge, t('name.bridge')),
    ]),
    pressTile(f.add, t('action.addNetwork'), 'mdi:wifi-plus', t('confirm.wifiAdd')),
  ]);
}
