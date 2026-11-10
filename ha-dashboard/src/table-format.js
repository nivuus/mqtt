// Formatting for table-card.js: styles, dot colours, relative times.

export const STYLE = `
  ha-card { overflow: hidden; }
  /* Same metrics as the header of a stock entities card. */
  .header { display: flex; align-items: center; gap: 16px; padding: 24px 16px 12px; }
  .header ha-icon { color: var(--state-icon-color, var(--secondary-text-color)); --mdc-icon-size: 24px; }
  .header h2 { margin: 0; font-family: var(--ha-card-header-font-family, inherit); font-size: var(--ha-card-header-font-size, var(--ha-font-size-2xl, 24px));
               font-weight: var(--ha-font-weight-normal, 400); line-height: 1.33; color: var(--ha-card-header-color, var(--primary-text-color)); }
  .scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: var(--ha-font-size-m, 14px); }
  th { text-align: start; font-weight: var(--ha-font-weight-medium, 500); color: var(--secondary-text-color);
       font-size: var(--ha-font-size-s, 12px); padding: 8px 16px; border-bottom: 1px solid var(--divider-color); white-space: nowrap; }
  th.sortable { cursor: pointer; user-select: none; }
  th .arrow { opacity: .6; margin-inline-start: 4px; }
  td { padding: 10px 16px; border-bottom: 1px solid var(--divider-color); color: var(--primary-text-color); vertical-align: middle; }
  tr:last-child td { border-bottom: 0; }
  tbody tr.clickable { cursor: pointer; }
  tbody tr.clickable:hover { background: var(--secondary-background-color); }
  .end { text-align: end; }
  .num { font-variant-numeric: tabular-nums; }
  .muted { color: var(--secondary-text-color); }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-inline-end: 8px; vertical-align: middle; background: var(--disabled-color, #bdbdbd); }
  .dot.ok { background: var(--success-color, #43a047); }
  .dot.bad { background: var(--error-color, #db4437); }
  .dot.warn { background: var(--warning-color, #ffa600); }
  button.action { font: inherit; font-weight: var(--ha-font-weight-medium, 500); color: var(--primary-color); background: none; border: 0;
                  border-radius: 8px; padding: 6px 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  button.action:hover { background: color-mix(in srgb, var(--primary-color) 10%, transparent); }
  button.action:focus-visible { outline: 2px solid var(--primary-color); }
  button.action ha-icon { --mdc-icon-size: 18px; }
  .empty { padding: 16px; color: var(--secondary-text-color); }
`;

// States drawn as a coloured dot. Anything else gets a neutral one.
const OK = new Set(['active', 'running', 'on', 'connected', 'PASSED', 'home']);
const BAD = new Set(['failed', 'inactive', 'off', 'error', 'ERROR', 'FAILED', 'unavailable', 'shut off', 'disconnected']);

export function tone(state) {
  if (OK.has(state)) return 'ok';
  if (BAD.has(state)) return 'bad';
  return '';
}

/** Dot colour of a numeric state against { warn, bad } thresholds. */
export function level(state, { warn, bad }) {
  const v = Number(state);
  if (!Number.isFinite(v)) return '';
  if (v >= bad) return 'bad';
  return v >= warn ? 'warn' : 'ok';
}

export function relative(iso, language) {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  if (!Number.isFinite(seconds)) return '';
  const units = [['day', 86400], ['hour', 3600], ['minute', 60]];
  const fmt = new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'short' });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return fmt.format(Math.round(seconds / size), unit);
  }
  return fmt.format(Math.round(seconds), 'second');
}
