// Builders for native Lovelace card configs. Every card here is a stock Home
// Assistant card; the only custom one is the CPU core grid (cpu-cores-card.js).

export const heading = (text, icon, extra = {}) => ({
  type: 'heading', heading: text, ...(icon && { icon }), ...extra,
});

export const subheading = (text) => ({ type: 'heading', heading: text, heading_style: 'subtitle' });

/** A tile, or null when the entity does not exist on this host. */
export function tile(entity, opts = {}) {
  if (!entity) return null;
  return { type: 'tile', entity, ...opts };
}

export function gaugeTile(entity, opts = {}) {
  const { max = 100, ...rest } = opts;
  return tile(entity, { ...rest, features: [{ type: 'bar-gauge', min: 0, max }] });
}

export const trendTile = (entity, opts = {}, hours = 24) =>
  tile(entity, { ...opts, features: [{ type: 'trend-graph', hours_to_show: hours }] });

export const toggleTile = (entity, opts = {}) =>
  tile(entity, { ...opts, features: [{ type: 'toggle' }] });

export const updateTile = (entity, opts = {}) =>
  tile(entity, { ...opts, features: [{ type: 'update-actions' }] });

/**
 * A tile that presses a button entity. Pressing is the whole point of the
 * card, so both the card and its icon press, and `confirm` (text) gates
 * anything that interrupts a service, a client or a VM.
 */
export function pressTile(entity, name, icon, confirm) {
  if (!entity) return null;
  const action = {
    action: 'perform-action',
    perform_action: 'button.press',
    target: { entity_id: entity },
    ...(confirm && { confirmation: { text: confirm } }),
  };
  return {
    type: 'tile', entity, name, icon,
    hide_state: true, vertical: false,
    tap_action: action, icon_tap_action: action,
  };
}

export function entities(rows, opts = {}) {
  const list = rows.filter(Boolean);
  if (!list.length) return null;
  return { type: 'entities', entities: list, ...opts };
}

export const row = (entity, name, extra = {}) => (entity ? { entity, name, ...extra } : null);

export function history(ids, opts = {}) {
  const list = ids.filter(Boolean);
  if (!list.length) return null;
  return { type: 'history-graph', hours_to_show: 24, entities: list, grid_options: { columns: 'full' }, ...opts };
}

export function gauge(entity, name, severity) {
  if (!entity) return null;
  return {
    type: 'gauge', entity, name, needle: true, min: 0, max: 100,
    ...(severity && { severity }),
    grid_options: { columns: 4, rows: 2 },
  };
}

export const markdown = (content, opts = {}) => ({ type: 'markdown', content, ...opts });

/** A sections-view section; empty cards (missing entities) are dropped. */
export function section(cards, opts = {}) {
  const list = cards.flat().filter(Boolean);
  // A section left with only its heading has nothing to show.
  if (!list.some((c) => c.type !== 'heading')) return null;
  return { type: 'grid', cards: list, ...opts };
}

/** Visibility helpers (card `visibility` conditions). */
export const when = {
  state: (entity, state) => ({ condition: 'state', entity, state }),
  stateNot: (entity, state_not) => ({ condition: 'state', entity, state_not }),
  above: (entity, above) => ({ condition: 'numeric_state', entity, above }),
  below: (entity, below) => ({ condition: 'numeric_state', entity, below }),
  and: (conditions) => ({ condition: 'and', conditions }),
  or: (conditions) => ({ condition: 'or', conditions }),
};

export const visibleWhen = (card, ...conditions) =>
  card ? { ...card, visibility: conditions } : null;

export function view(key, title, icon, sections, extra = {}) {
  return {
    type: 'sections', path: key, title, icon, max_columns: 4,
    sections: sections.filter(Boolean), ...extra,
  };
}
