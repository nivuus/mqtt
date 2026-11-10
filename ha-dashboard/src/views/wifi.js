// "Wi-Fi": the access point, a table of networks, one edit form per network
// and the add form.
//
// Typing in a field only stages the value on the agent; nothing reaches
// hostapd until Apply (or Add) is pressed. The confirmations say what the
// press costs the clients, as the agent documents it.

import { list, row, buttonRow, table, pressAction, section, view } from '../cards.js';

export function wifi(m, t) {
  const w = m.wifi;
  const hostapd = m.services.find((s) => s.name === 'hostapd');
  return view('wifi', t('view.wifi'), [
    section([networks(w, t)], { column_span: 2 }),
    section([
      list(t('section.accessPoint'), 'mdi:access-point', [
        row(hostapd?.status, t('name.hostapd')),
        row(w.summary, t('name.networks')),
        row(w.lastAction, t('name.lastAction')),
        buttonRow(w.reload, t('action.reloadHostapd'), 'mdi:reload', t('action.reload'), t('confirm.wifiReload')),
        buttonRow(hostapd?.restart, t('action.restartHostapd'), 'mdi:restart', t('action.restartShort'), t('confirm.wifiRestart')),
      ]),
      addNetwork(w.newNetwork, t),
    ]),
    section(w.networks.map((n) => edit(n, t))),
  ], { max_columns: 2 });
}

function networks(w, t) {
  const rows = w.networks.map((n) => ({
    entity: n.status,
    cells: {
      ssid: { entity: n.ssid },
      bridge: { text: n.bridge ? t.bridge(n.bridge) : '—' },
      security: { entity: n.security },
      // The agent reports "Active (2.4+5GHz)" and friends.
      status: { entity: n.status, dot: true, tonePrefixes: { Active: 'ok' } },
    },
    actions: [pressAction(n.delete, t('action.delete'), 'mdi:delete', t('confirm.wifiDelete', { ssid: n.label ?? '' }))].filter(Boolean),
  }));
  return table(t('section.networks'), 'mdi:wifi', [
    { key: 'ssid', label: t('name.ssid'), sortable: true },
    { key: 'bridge', label: t('col.network'), sortable: true },
    { key: 'security', label: t('name.security') },
    { key: 'status', label: t('col.state') },
    { key: 'action', label: '', align: 'end' },
  ], rows);
}

function edit(n, t) {
  return list(t('section.editNetwork', { ssid: n.label ?? t('name.network', { n: n.n }) }), 'mdi:pencil', [
    row(n.ssid, t('name.ssid')),
    row(n.password, t('name.password')),
    row(n.security, t('name.security')),
    buttonRow(n.apply, t('action.applyChanges'), 'mdi:check-circle', t('action.apply'), t('confirm.wifiApply')),
  ]);
}

function addNetwork(f, t) {
  return list(t('section.addNetwork'), 'mdi:wifi-plus', [
    row(f.ssid, t('name.ssid')),
    row(f.password, t('name.password')),
    row(f.security, t('name.security')),
    row(f.bridge, t('name.bridge')),
    buttonRow(f.add, t('action.addNetwork'), 'mdi:wifi-plus', t('action.add'), t('confirm.wifiAdd')),
  ]);
}
