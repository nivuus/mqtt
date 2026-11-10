// DOM helpers and the shared look of the edit cards (form-card.js,
// zone-card.js): outlined fields, text and filled buttons, an inline
// confirmation bar. Colours and type come from Home Assistant's theme
// variables, so the cards follow the user's theme and dark mode.

export function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of [children].flat()) if (child != null) node.append(child);
  return node;
}

export const icon = (name) => el('ha-icon', { icon: name });

/** `kind`: 'text' (default), 'primary' (filled) or 'danger' (text, error colour). */
export function button(label, onClick, { kind = 'text', iconName, disabled = false, title } = {}) {
  const b = el('button', { type: 'button', className: `btn ${kind}`, disabled, ...(title && { title, ariaLabel: title }) },
    [iconName && icon(iconName), label && el('span', { textContent: label })]);
  b.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(); });
  return b;
}

/** A labelled field wrapping an input or a select. */
export function field(label, control, hint) {
  return el('label', { className: 'field' }, [el('span', { className: 'label', textContent: label }), control,
    hint && el('span', { className: 'hint', textContent: hint })]);
}

export function select(options, value) {
  const s = el('select');
  for (const o of options) s.append(el('option', { value: o.value, textContent: o.label, selected: o.value === value }));
  return s;
}

export const STYLE = `
  :host { display: block; }
  ha-card { overflow: hidden; }
  .header { display: flex; align-items: center; gap: 16px; padding: 24px 16px 8px; }
  .header ha-icon { color: var(--state-icon-color, var(--secondary-text-color)); --mdc-icon-size: 24px; }
  .header h2 { margin: 0; flex: 1; font-family: var(--ha-card-header-font-family, inherit);
               font-size: var(--ha-card-header-font-size, var(--ha-font-size-2xl, 24px)); font-weight: var(--ha-font-weight-normal, 400);
               line-height: 1.33; color: var(--ha-card-header-color, var(--primary-text-color)); }
  .sub { padding: 0 16px 8px; color: var(--secondary-text-color); font-size: var(--ha-font-size-s, 12px); display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { border: 1px solid var(--divider-color); border-radius: 12px; padding: 2px 10px; font-size: var(--ha-font-size-s, 12px); color: var(--primary-text-color); }
  .chip.on { border-color: var(--success-color, #43a047); color: var(--success-color, #43a047); }
  .body { padding: 8px 16px 16px; display: grid; gap: 16px; }
  .fields { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
  .field { display: grid; gap: 4px; min-width: 0; }
  .field .label { font-size: var(--ha-font-size-s, 12px); color: var(--secondary-text-color); }
  .field .hint { font-size: var(--ha-font-size-xs, 11px); color: var(--secondary-text-color); }
  input, select { font: inherit; color: var(--primary-text-color); background: var(--card-background-color, var(--primary-background-color));
                  border: 1px solid var(--outline-color, var(--divider-color)); border-radius: 8px; padding: 10px 12px; min-width: 0; width: 100%; box-sizing: border-box; }
  input:focus, select:focus { outline: 2px solid var(--primary-color); outline-offset: -1px; border-color: transparent; }
  input:invalid { border-color: var(--error-color, #db4437); }
  .secret { position: relative; display: flex; }
  .secret input { padding-inline-end: 44px; }
  .secret .btn { position: absolute; inset-inline-end: 2px; top: 50%; transform: translateY(-50%); }
  .group h3 { margin: 0 0 4px; font-size: var(--ha-font-size-s, 12px); font-weight: var(--ha-font-weight-medium, 500);
              color: var(--secondary-text-color); text-transform: none; }
  .rules { list-style: none; margin: 0; padding: 0; border: 1px solid var(--divider-color); border-radius: 8px; }
  .rules li { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 4px 0 12px; border-bottom: 1px solid var(--divider-color); }
  .rules li:last-child { border-bottom: 0; }
  .rules li .text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .rules li .text code { font-family: var(--ha-font-family-code, monospace); }
  .rules li.confirm { background: color-mix(in srgb, var(--error-color, #db4437) 8%, transparent); }
  .rules .none { color: var(--secondary-text-color); }
  .add { border-top: 1px solid var(--divider-color); padding: 16px; display: grid; gap: 12px; }
  .add h3 { margin: 0; font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-medium, 500); }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 16px 16px; }
  .actions .spacer { flex: 1; }
  .confirmbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 16px; margin: 0 16px 16px; border-radius: 8px;
                background: color-mix(in srgb, var(--warning-color, #ffa600) 14%, transparent); }
  .confirmbar.danger { background: color-mix(in srgb, var(--error-color, #db4437) 12%, transparent); }
  .confirmbar .msg { flex: 1 1 220px; }
  .status { margin: 0 16px 16px; padding: 10px 12px; border-radius: 8px; font-size: var(--ha-font-size-m, 14px); }
  .status.ok { background: color-mix(in srgb, var(--success-color, #43a047) 12%, transparent); }
  .status.error { background: color-mix(in srgb, var(--error-color, #db4437) 12%, transparent); }
  .status.report { background: var(--secondary-background-color); color: var(--primary-text-color); }
  .status.pending { background: var(--secondary-background-color); color: var(--secondary-text-color); }
  .status code { font-family: var(--ha-font-family-code, monospace); word-break: break-word; }
  .btn { font: inherit; font-weight: var(--ha-font-weight-medium, 500); border: 0; border-radius: 18px; padding: 8px 14px; cursor: pointer;
         display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; background: none; color: var(--primary-color); }
  .btn ha-icon { --mdc-icon-size: 18px; }
  .btn:hover:not(:disabled) { background: color-mix(in srgb, currentColor 10%, transparent); }
  .btn:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  .btn:disabled { opacity: .45; cursor: default; }
  .btn.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .btn.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--primary-color) 88%, black); }
  .btn.danger { color: var(--error-color, #db4437); }
  .btn.danger.filled { background: var(--error-color, #db4437); color: #fff; }
  .btn.iconic { padding: 8px; border-radius: 50%; color: var(--secondary-text-color); }
  .btn.iconic.danger { color: var(--error-color, #db4437); }
`;
