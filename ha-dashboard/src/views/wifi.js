// "Wi-Fi": the access point, a table of networks, the add form and one edit
// form per network (edit/form-card.js).
//
// Values stay in the form until Save (or Add); then the fields are written and
// the agent's button pressed. The confirmations say what that costs the
// clients, as the agent documents it.

import { list, row, buttonRow, table, formCard, section, view } from '../cards.js';

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
    ]),
    section([addNetwork(w, t)]),
    ...w.networks.map((n) => section([edit(n, w, t)])),
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
  }));
  return table(t('section.networks'), 'mdi:wifi', [
    { key: 'ssid', label: t('name.ssid'), sortable: true },
    { key: 'bridge', label: t('col.network'), sortable: true },
    { key: 'security', label: t('name.security') },
    { key: 'status', label: t('col.state') },
  ], rows);
}

function edit(n, w, t) {
  return formCard(t('section.editNetwork', { ssid: n.label ?? t('name.network', { n: n.n }) }), 'mdi:wifi-cog', {
    mode: 'edit',
    fields: [
      { entity: n.ssid, label: t('name.ssid'), required: true },
      { entity: n.password, label: t('name.password') },
      { entity: n.security, label: t('name.security') },
    ],
    submit: { entity: n.apply, label: t('action.save'), icon: 'mdi:content-save', confirm: t('confirm.wifiApply') },
    remove: { entity: n.delete, label: t('action.delete'), confirm: t('confirm.wifiDelete', { ssid: n.label ?? '' }) },
    status: w.lastAction,
  });
}

function addNetwork(w, t) {
  const f = w.newNetwork;
  return formCard(t('section.addNetwork'), 'mdi:wifi-plus', {
    mode: 'add',
    fields: [
      { entity: f.ssid, label: t('name.ssid'), required: true },
      { entity: f.password, label: t('name.password') },
      { entity: f.security, label: t('name.security') },
      { entity: f.bridge, label: t('name.bridge') },
    ],
    submit: { entity: f.add, label: t('action.add'), icon: 'mdi:plus', confirm: t('confirm.wifiAdd') },
    status: w.lastAction,
  });
}
