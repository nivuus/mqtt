// An edit form bound to the agent's input entities (text and select), in the
// style of Home Assistant's settings dialogs: labelled fields, Cancel / Save,
// a Delete on the left, and the confirmation inline in the card.
//
// Values stay in the card until the person saves. Saving writes the changed
// fields (`text.set_value`, `select.select_option`) in order, then presses the
// form's button entity: the agent stages each field as it arrives and acts on
// the button, so nothing reaches the system half-typed.
//
// Config:
//   title, icon
//   mode: 'edit' (Save enabled once a field changed) | 'add' (enabled once required fields are filled)
//   fields: [{ entity, label, required?, optionLabels? }]  text.* -> input (password masked), select.* -> select
//   submit: { entity, label, icon?, confirm? }    button pressed after the fields are written
//   remove?: { entity, label, confirm }           destructive button, always confirmed
//   extra?: [{ entity, label, icon?, confirm? }]  other buttons (e.g. "Test connection")
//   status?: entity                               the agent's last-action sensor, shown as written after a press

import { el, button, field, select, STYLE } from './dom.js';
import { makeTranslator, languageOf } from '../i18n/index.js';

export const FORM_CARD_TYPE = 'custom:nivuus-form-card';
const TAG = 'nivuus-form-card';
const EMPTY = new Set(['unknown', 'unavailable']);

function defineCard() {
  class FormCard extends HTMLElement {
    setConfig(config) {
      if (!Array.isArray(config.fields) || !config.submit?.entity) throw new Error('fields and submit.entity are required');
      this._config = config;
      this._values = {};
      this._dirty = new Set();
      this._confirm = null; // the action awaiting confirmation
      this._busy = false;
      this._outcome = null; // { kind: 'ok' | 'error' | 'pending', text }
      this._built = false;
    }

    set hass(hass) {
      this._hass = hass;
      this._t = makeTranslator(languageOf(hass));
      if (!this._built) return this._render();
      // Fields the person has not touched follow the system; touched ones keep their text.
      for (const f of this._config.fields) {
        if (this._dirty.has(f.entity)) continue;
        const input = this._inputs[f.entity];
        const value = this._stateValue(f.entity);
        if (input && input.value !== value) input.value = value;
        this._values[f.entity] = value;
      }
      this._refreshStatus();
      this._refreshButtons();
    }

    getCardSize() { return 2 + this._config.fields.length; }
    getGridOptions() { return { columns: 'full', rows: 'auto' }; }

    _stateValue(entity) {
      const s = this._hass.states[entity]?.state;
      return s === undefined || EMPTY.has(s) ? '' : s;
    }

    _render() {
      const { title, icon: iconName, fields } = this._config;
      const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${STYLE}</style>`;
      this._inputs = {};
      const card = el('ha-card');
      if (title) card.append(el('div', { className: 'header' }, [iconName && el('ha-icon', { icon: iconName }), el('h2', { textContent: title })]));
      const grid = el('div', { className: 'fields' });
      for (const f of fields) {
        if (!this._hass.states[f.entity]) continue;
        if (!(f.entity in this._values)) this._values[f.entity] = this._stateValue(f.entity);
        grid.append(field(f.label, this._control(f)));
      }
      card.append(el('div', { className: 'body' }, grid));
      card.append(this._confirm ? this._confirmBar() : this._actions());
      this._statusNode = el('div');
      card.append(this._statusNode);
      root.append(card);
      this._built = true;
      this._refreshStatus();
      this._refreshButtons();
    }

    _control(f) {
      const s = this._hass.states[f.entity];
      const value = this._values[f.entity];
      let control;
      if (f.entity.startsWith('select.')) {
        control = select((s.attributes.options ?? []).map((o) => ({ value: o, label: f.optionLabels?.[o] ?? this._hass.formatEntityState?.(s, o) ?? o })), value);
        control.addEventListener('change', () => this._edit(f.entity, control.value));
      } else {
        const a = s.attributes;
        control = el('input', { type: a.mode === 'password' ? 'password' : 'text', value, required: !!f.required, spellcheck: false, placeholder: ' ',
          ...(a.max && { maxLength: a.max }), ...(a.pattern && { pattern: a.pattern }), autocomplete: 'off' });
        control.addEventListener('input', () => this._edit(f.entity, control.value));
        if (a.mode === 'password') {
          const t = this._t;
          const toggle = button('', () => {
            control.type = control.type === 'password' ? 'text' : 'password';
            toggle.querySelector('ha-icon').icon = control.type === 'password' ? 'mdi:eye' : 'mdi:eye-off';
          }, { kind: 'iconic', iconName: 'mdi:eye', title: t('form.reveal') });
          this._inputs[f.entity] = control;
          return el('div', { className: 'secret' }, [control, toggle]);
        }
      }
      this._inputs[f.entity] = control;
      return control;
    }

    _edit(entity, value) {
      this._values[entity] = value;
      if (value === this._stateValue(entity)) this._dirty.delete(entity);
      else this._dirty.add(entity);
      this._outcome = null;
      this._refreshStatus();
      this._refreshButtons();
    }

    _actions() {
      const { submit, remove, extra = [] } = this._config;
      const t = this._t;
      const bar = el('div', { className: 'actions' });
      if (remove?.entity && this._hass.states[remove.entity]) {
        bar.append(button(remove.label, () => this._ask({ ...remove, danger: true }), { kind: 'danger', iconName: 'mdi:delete' }));
      }
      for (const x of extra) if (this._hass.states[x.entity]) bar.append(button(x.label, () => this._ask(x), { iconName: x.icon }));
      bar.append(el('span', { className: 'spacer' }));
      this._cancelBtn = button(t('form.cancel'), () => this._reset());
      this._submitBtn = button(submit.label, () => this._ask({ ...submit, submit: true }), { kind: 'primary', iconName: submit.icon });
      bar.append(this._cancelBtn, this._submitBtn);
      return bar;
    }

    _confirmBar() {
      const c = this._confirm;
      const t = this._t;
      return el('div', { className: `confirmbar${c.danger ? ' danger' : ''}` }, [
        el('span', { className: 'msg', textContent: c.confirm }),
        button(t('form.cancel'), () => { this._confirm = null; this._render(); }),
        button(c.label, () => this._run(c), { kind: c.danger ? 'danger filled' : 'primary', iconName: c.icon }),
      ]);
    }

    _ready() {
      const { mode = 'edit', fields } = this._config;
      const valid = Object.values(this._inputs).every((i) => i.checkValidity?.() !== false);
      if (mode === 'add') return valid && fields.every((f) => !f.required || this._values[f.entity]);
      return valid && this._dirty.size > 0;
    }

    _refreshButtons() {
      if (!this._submitBtn) return;
      this._submitBtn.disabled = this._busy || !this._ready();
      this._cancelBtn.hidden = this._dirty.size === 0;
    }

    _ask(action) {
      if (action.submit && !this._ready()) return;
      if (!action.confirm) return this._run(action);
      this._confirm = action;
      this._render();
    }

    _reset() {
      this._dirty.clear();
      for (const f of this._config.fields) this._values[f.entity] = this._stateValue(f.entity);
      this._outcome = null;
      this._render();
    }

    async _run(action) {
      const t = this._t;
      this._confirm = null;
      this._busy = true;
      this._outcome = { kind: 'pending', text: t('form.working') };
      this._render();
      const statusBefore = this._hass.states[this._config.status]?.last_updated;
      try {
        if (action.submit) {
          const { mode = 'edit', fields } = this._config;
          for (const f of fields) {
            if (!this._hass.states[f.entity]) continue;
            if (mode === 'edit' && !this._dirty.has(f.entity)) continue;
            const value = this._values[f.entity] ?? '';
            if (f.entity.startsWith('select.')) await this._hass.callService('select', 'select_option', { entity_id: f.entity, option: value });
            else await this._hass.callService('text', 'set_value', { entity_id: f.entity, value });
          }
        }
        await this._hass.callService('button', 'press', { entity_id: action.entity });
        this._dirty.clear();
        this._statusBefore = statusBefore;
        this._outcome = { kind: 'pending', text: t('form.sent') };
      } catch (err) {
        this._outcome = { kind: 'error', text: t('form.failed', { error: err?.message ?? String(err) }) };
      }
      this._busy = false;
      this._render();
    }

    /** After a press, the agent's own report replaces "sent" as soon as it changes. */
    _refreshStatus() {
      if (!this._statusNode) return;
      const status = this._hass.states[this._config.status];
      if (this._outcome?.kind === 'pending' && this._statusBefore !== undefined && status && status.last_updated !== this._statusBefore) {
        const text = this._hass.formatEntityState?.(status) ?? status.state;
        // The agent's report is free text: shown as it is, never classified by its words.
        this._outcome = { kind: 'report', text };
        this._statusBefore = undefined;
      }
      this._statusNode.replaceChildren(...(this._outcome
        ? [el('div', { className: `status ${this._outcome.kind}`, role: 'status', textContent: this._outcome.text })] : []));
    }
  }

  if (!customElements.get(TAG)) customElements.define(TAG, FormCard);
}

if (globalThis.customElements) defineCard();
