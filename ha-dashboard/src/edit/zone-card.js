// Editor of one firewalld zone: its interfaces, then its services, open ports
// and port forwards as lists with a Delete on each line, then an "Add a rule"
// form. Deleting asks for confirmation on the line itself.
//
// Changes go to the agent's JSON command topic (`mqtt.publish`), whose address
// the last-action sensor carries. The agent writes the permanent and runtime
// configuration without reloading firewalld, then answers on the same sensor
// with the command's id; the card words the answer in the user's language.
//
// Config: zone, interfaces: [name], otherInterfaces: count, services, ports, forwards, masquerade, lastAction (entity ids)

import { el, button, field, select, STYLE } from './dom.js';
import { makeTranslator, languageOf } from '../i18n/index.js';

export const ZONE_CARD_TYPE = 'custom:nivuus-zone-card';
const TAG = 'nivuus-zone-card';

// Same rules as the agent's validators; the agent checks again.
const PORT = '^[0-9]{1,5}(-[0-9]{1,5})?$';
const SERVICE = '^[A-Za-z0-9][A-Za-z0-9_.+\\-]*$';
const IPV4 = '^((25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])\\.){3}(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])$';
const PROTOCOLS = ['tcp', 'udp', 'sctp', 'dccp'];

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The rule a list line stands for, as the agent's command expects it. */
export function ruleOf(kind, item) {
  if (kind === 'service') return { kind, service: item };
  if (kind === 'port') {
    const [port, protocol] = String(item).split('/');
    return { kind, port, protocol };
  }
  return { kind, port: item.port, protocol: item.proto, toaddr: item.toaddr, toport: item.toport };
}

/** How a rule reads on screen: `ssh`, `445/tcp`, `80/tcp → 192.168.3.2:8080`. */
export function ruleText(rule) {
  if (rule.kind === 'service') return rule.service;
  if (rule.kind === 'port') return `${rule.port}/${rule.protocol}`;
  return `${rule.port}/${rule.protocol} → ${rule.toaddr}:${rule.toport}`;
}

function defineCard() {
  class ZoneCard extends HTMLElement {
    setConfig(config) {
      if (!config.zone) throw new Error('zone is required');
      this._config = config;
      this._kind = 'service';
      this._draft = { protocol: 'tcp' };
      this._confirm = null; // text of the line awaiting confirmation
      this._sent = null; // { id, rule, op }
      this._outcome = null;
      this._signature = undefined;
    }

    set hass(hass) {
      this._hass = hass;
      this._t = makeTranslator(languageOf(hass));
      const c = this._config;
      if (!this._card) this._build();
      const signature = [c.services, c.ports, c.forwards, c.masquerade].map((e) => hass.states[e]?.last_updated ?? '').join('|');
      if (signature !== this._signature) {
        this._signature = signature;
        this._renderLists();
      }
      this._readAnswer();
    }

    getCardSize() { return 6; }
    getGridOptions() { return { columns: 'full', rows: 'auto' }; }

    _attr(entity, name) {
      return this._hass.states[entity]?.attributes?.[name] ?? [];
    }

    _build() {
      const t = this._t;
      const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${STYLE}</style>`;
      this._card = el('ha-card');
      this._card.append(el('div', { className: 'header' }, [el('ha-icon', { icon: 'mdi:shield-outline' }),
        el('h2', { textContent: t('name.zone', { zone: this._config.zone }) })]));
      this._sub = el('div', { className: 'sub' });
      this._lists = el('div', { className: 'body' });
      this._add = el('div', { className: 'add' });
      this._status = el('div');
      this._card.append(this._sub, this._lists, this._add, this._status);
      root.append(this._card);
      this._renderAdd();
    }

    _renderLists() {
      const t = this._t;
      const c = this._config;
      const nat = this._hass.states[c.masquerade]?.state === 'on';
      this._sub.replaceChildren(
        ...(c.interfaces ?? []).map((i) => el('span', { className: 'chip', textContent: t.iface(i) })),
        ...(c.otherInterfaces ? [el('span', { className: 'chip', textContent: `+${c.otherInterfaces}`, title: t('zone.otherInterfaces', { n: c.otherInterfaces }) })] : []),
        ...(c.interfaces?.length || c.otherInterfaces ? [] : [el('span', { textContent: t('zone.noInterface') })]),
        ...(nat ? [el('span', { className: 'chip on', textContent: t('name.masquerade') })] : []),
      );
      const groups = [
        ['service', t('col.services'), c.services, this._attr(c.services, 'services')],
        ['port', t('col.ports'), c.ports, this._attr(c.ports, 'ports')],
        ['forward', t('col.forwards'), c.forwards, this._attr(c.forwards, 'forwards')],
      ].filter(([, , entity]) => entity && this._hass.states[entity]);
      this._lists.replaceChildren(...groups.map(([kind, title, , items]) => el('div', { className: 'group' }, [
        el('h3', { textContent: title }),
        el('ul', { className: 'rules' }, items.length
          ? items.map((item) => this._line(ruleOf(kind, item)))
          : [el('li', { className: 'none', textContent: t('zone.none') })]),
      ])));
    }

    _line(rule) {
      const t = this._t;
      const text = ruleText(rule);
      const key = `${rule.kind}:${text}`;
      if (this._confirm === key) {
        return el('li', { className: 'confirm' }, [
          el('span', { className: 'text', textContent: t('zone.confirmRemove', { rule: text }) }),
          button(t('form.cancel'), () => { this._confirm = null; this._renderLists(); }),
          button(t('action.remove'), () => this._send('remove', rule), { kind: 'danger filled', iconName: 'mdi:delete' }),
        ]);
      }
      return el('li', {}, [
        el('span', { className: 'text' }, el('code', { textContent: text })),
        button('', () => { this._confirm = key; this._renderLists(); }, { kind: 'iconic danger', iconName: 'mdi:delete-outline', title: t('zone.removeRule', { rule: text }) }),
      ]);
    }

    _input(key, label, pattern, placeholder) {
      const input = el('input', { value: this._draft[key] ?? '', pattern, required: true, placeholder: placeholder ?? '', spellcheck: false, autocomplete: 'off' });
      input.addEventListener('input', () => { this._draft[key] = input.value; this._refreshAdd(); });
      this._inputs.push(input);
      return field(label, input);
    }

    _protocol() {
      const s = select(PROTOCOLS.map((p) => ({ value: p, label: p.toUpperCase() })), this._draft.protocol);
      s.addEventListener('change', () => { this._draft.protocol = s.value; });
      return field(this._t('col.protocol'), s);
    }

    _renderAdd() {
      const t = this._t;
      this._inputs = [];
      const kind = select([
        { value: 'service', label: t('zone.kind.service') },
        { value: 'port', label: t('zone.kind.port') },
        { value: 'forward', label: t('zone.kind.forward') },
      ], this._kind);
      kind.addEventListener('change', () => { this._kind = kind.value; this._renderAdd(); });
      const fields = [field(t('zone.kind'), kind)];
      if (this._kind === 'service') fields.push(this._input('service', t('name.service'), SERVICE, 'https'));
      if (this._kind === 'port') fields.push(this._input('port', t('col.port'), PORT, '8443'), this._protocol());
      if (this._kind === 'forward') {
        fields.push(this._input('port', t('name.sourcePort'), PORT, '8443'), this._protocol(),
          this._input('toaddr', t('name.toAddress'), IPV4, '192.168.1.10'), this._input('toport', t('name.toPort'), PORT, '443'));
      }
      this._addBtn = button(t('action.add'), () => this._send('add', this._draftRule()), { kind: 'primary', iconName: 'mdi:plus' });
      this._add.replaceChildren(
        el('h3', { textContent: t('zone.addRule') }),
        el('div', { className: 'fields' }, fields),
        el('div', { className: 'actions', style: 'padding: 0' }, [el('span', { className: 'spacer' }), this._addBtn]),
      );
      this._refreshAdd();
    }

    _draftRule() {
      const d = this._draft;
      if (this._kind === 'service') return { kind: 'service', service: d.service };
      if (this._kind === 'port') return { kind: 'port', port: d.port, protocol: d.protocol };
      return { kind: 'forward', port: d.port, protocol: d.protocol, toaddr: d.toaddr, toport: d.toport };
    }

    _refreshAdd() {
      this._addBtn.disabled = !!this._sent || !this._inputs.every((i) => i.value && i.checkValidity());
    }

    async _send(op, rule) {
      const t = this._t;
      const topic = this._hass.states[this._config.lastAction]?.attributes?.command_topic;
      this._confirm = null;
      if (!topic) {
        this._show('error', t('zone.noAgent'));
        return;
      }
      const id = newId();
      this._sent = { id, op, rule };
      this._show('pending', t('form.working'));
      this._refreshAdd();
      try {
        await this._hass.callService('mqtt', 'publish', { topic, payload: JSON.stringify({ id, op, zone: this._config.zone, rule }) });
      } catch (err) {
        this._sent = null;
        this._show('error', t('form.failed', { error: err?.message ?? String(err) }));
        this._refreshAdd();
      }
      this._renderLists();
    }

    /** The agent answers on the last-action sensor with the id it was sent. */
    _readAnswer() {
      const result = this._attr(this._config.lastAction, 'result');
      if (!this._sent || result?.id !== this._sent.id) return;
      const t = this._t;
      const text = ruleText(this._sent.rule);
      if (result.ok) {
        this._show('ok', t(`zone.done.${this._sent.op}`, { rule: text }));
        if (this._sent.op === 'add') this._draft = { protocol: this._draft.protocol };
        this._renderAdd();
      } else {
        // `invalid` names the refused field by its code; firewalld's own message is shown as it is.
        const detail = result.failed === 'invalid' ? t(`zone.field.${result.detail}`) : result.detail ?? '';
        this._show('error', t(`zone.failed.${result.failed}`, { rule: text, detail }));
      }
      this._sent = null;
      this._refreshAdd();
      this._renderLists();
    }

    _show(kind, text) {
      this._status.replaceChildren(el('div', { className: `status ${kind}`, role: 'status', textContent: text }));
    }
  }

  if (!customElements.get(TAG)) customElements.define(TAG, ZoneCard);
}

if (globalThis.customElements) defineCard();
