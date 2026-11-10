// A dense, sortable table in the style of Home Assistant's settings pages.
//
// Stock cards lay entities out as tiles or as one-entity rows; an admin page
// needs columns (name, state, since, action) a row per object. Values are
// formatted by `hass.formatEntityState`, times by the browser's Intl in the
// user's language, and every click goes through Home Assistant's own
// `hass-action` event: confirmations and the more-info dialog are native.
//
// Config:
//   title, icon            card header
//   columns: [{ key, label, sortable?, align? }]
//   rows: [{ entity?, cells: { key: Cell }, actions?: [{ label, icon, tap_action, when? }] }]
//   Cell: { entity, kind: 'state' | 'since' | 'attribute', attribute?, dot?, tones?, muted?, numeric? } | { text }
//         `tones` maps a state to a dot colour ('ok' | 'warn' | 'bad') where the default reading is wrong;
//         `levels` ({ warn, bad }) colours a numeric state by threshold;
//         `tonePrefixes` does the same for states that start with a key ("Active (2.4+5GHz)").
//   empty                  text shown when there is no row

export const TABLE_CARD_TYPE = 'custom:nivuus-table-card';
const TAG = 'nivuus-table-card';

import { STYLE, tone, level, relative } from './table-format.js';

function defineCard() {
  class TableCard extends HTMLElement {
    setConfig(config) {
      if (!Array.isArray(config.columns) || !Array.isArray(config.rows)) throw new Error('columns and rows are required');
      this._config = config;
      this._sort = undefined;
      this._signature = undefined;
    }

    set hass(hass) {
      this._hass = hass;
      // Re-render only when a state this table shows changed.
      const signature = this._entities().map((e) => hass.states[e]?.last_updated ?? '').join('|');
      if (signature !== this._signature) {
        this._signature = signature;
        this._render();
      }
    }

    getCardSize() {
      return 1 + this._config.rows.length;
    }

    getGridOptions() {
      return { columns: 'full', rows: 'auto' };
    }

    _entities() {
      const out = new Set();
      for (const r of this._config.rows) {
        if (r.entity) out.add(r.entity);
        for (const c of Object.values(r.cells)) if (c.entity) out.add(c.entity);
      }
      return [...out];
    }

    _text(cell) {
      if ('text' in cell) return cell.text;
      const s = this._hass.states[cell.entity];
      if (!s) return '—';
      if (cell.kind === 'since') return relative(s.last_changed, this._hass.locale?.language);
      if (cell.kind === 'attribute') {
        const value = s.attributes[cell.attribute];
        if (value === undefined || value === null) return '—';
        // Numbers in the user's locale (913,91 in French, 913.91 in English).
        if (typeof value === 'number') return new Intl.NumberFormat(this._hass.locale?.language).format(value);
        return String(value);
      }
      return this._hass.formatEntityState(s);
    }

    _sortValue(row, key) {
      const cell = row.cells[key];
      if (!cell) return '';
      if (cell.entity && cell.kind !== 'since') {
        const n = Number(this._hass.states[cell.entity]?.state);
        if (Number.isFinite(n)) return n;
      }
      return this._text(cell);
    }

    _rows() {
      const rows = [...this._config.rows];
      if (!this._sort) return rows;
      const { key, dir } = this._sort;
      return rows.sort((a, b) => {
        const x = this._sortValue(a, key);
        const y = this._sortValue(b, key);
        const c = typeof x === 'number' && typeof y === 'number'
          ? x - y
          : String(x).localeCompare(String(y), this._hass.locale?.language, { numeric: true });
        return dir * c;
      });
    }

    _render() {
      const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
      const { title, icon, columns, empty } = this._config;
      root.innerHTML = `<style>${STYLE}</style><ha-card></ha-card>`;
      const card = root.querySelector('ha-card');
      if (title) {
        const header = document.createElement('div');
        header.className = 'header';
        if (icon) header.append(Object.assign(document.createElement('ha-icon'), { icon }));
        header.append(Object.assign(document.createElement('h2'), { textContent: title }));
        card.append(header);
      }
      const rows = this._rows();
      if (!rows.length) {
        card.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: empty ?? '' }));
        return;
      }
      const scroll = document.createElement('div');
      scroll.className = 'scroll';
      const table = document.createElement('table');
      const head = table.createTHead().insertRow();
      for (const col of columns) {
        const th = document.createElement('th');
        th.textContent = col.label ?? '';
        if (col.align === 'end') th.classList.add('end');
        if (col.sortable) {
          th.classList.add('sortable');
          const active = this._sort?.key === col.key;
          th.setAttribute('aria-sort', active ? (this._sort.dir > 0 ? 'ascending' : 'descending') : 'none');
          if (active) th.append(Object.assign(document.createElement('span'), { className: 'arrow', textContent: this._sort.dir > 0 ? '▲' : '▼' }));
          th.addEventListener('click', () => {
            this._sort = { key: col.key, dir: active ? -this._sort.dir : 1 };
            this._render();
          });
        }
        head.append(th);
      }
      const body = table.createTBody();
      for (const row of rows) body.append(this._row(row, columns));
      scroll.append(table);
      card.append(scroll);
    }

    _row(row, columns) {
      const tr = document.createElement('tr');
      if (row.entity) {
        tr.classList.add('clickable');
        tr.addEventListener('click', () => this._act({ entity: row.entity, tap_action: { action: 'more-info' } }));
      }
      for (const col of columns) {
        const td = tr.insertCell();
        if (col.align === 'end') td.classList.add('end');
        if (col.key === 'action') {
          for (const action of row.actions ?? []) {
            // `when`: { entity, states } — the action only makes sense in these states.
            if (action.when && !action.when.states.includes(this._hass.states[action.when.entity]?.state)) continue;
            td.append(this._button(action));
          }
          continue;
        }
        const cell = row.cells[col.key];
        if (!cell) continue;
        const text = this._text(cell);
        if (cell.dot && cell.entity) {
          const state = this._hass.states[cell.entity]?.state;
          const prefixed = Object.entries(cell.tonePrefixes ?? {}).find(([p]) => String(state).startsWith(p));
          const t = cell.levels ? level(state, cell.levels) : cell.tones?.[state] ?? prefixed?.[1] ?? tone(state);
          td.append(Object.assign(document.createElement('span'), { className: `dot ${t}` }));
        }
        td.append(document.createTextNode(text));
        if (cell.muted) td.classList.add('muted');
        if (cell.numeric) td.classList.add('num');
      }
      return tr;
    }

    _button(action) {
      const button = document.createElement('button');
      button.className = 'action';
      if (action.icon) button.append(Object.assign(document.createElement('ha-icon'), { icon: action.icon }));
      button.append(document.createTextNode(action.label));
      button.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this._act({ tap_action: action.tap_action });
      });
      return button;
    }

    // Home Assistant's own action handler: confirmation dialogs, more-info,
    // service calls and error toasts all behave as on any stock card.
    _act(config) {
      this.dispatchEvent(new CustomEvent('hass-action', {
        detail: { config, action: 'tap' }, bubbles: true, composed: true,
      }));
    }
  }

  if (!customElements.get(TAG)) customElements.define(TAG, TableCard);
}

if (globalThis.customElements) defineCard();
