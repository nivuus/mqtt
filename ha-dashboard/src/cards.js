// Builders for native Lovelace card configs. Every card here is a stock Home
// Assistant card; the only custom one is the CPU core grid (cpu-cores-card.js).

/** A tile, or null when the entity does not exist on this host. */
export function tile(entity, opts = {}) {
  if (!entity) return null;
  return { type: 'tile', entity, ...opts };
}

export function gaugeTile(entity, opts = {}) {
  const { max = 100, ...rest } = opts;
  return tile(entity, { ...rest, features: [{ type: 'bar-gauge', min: 0, max }] });
}

export function entities(rows, opts = {}) {
  const list = rows.filter(Boolean);
  if (!list.length) return null;
  return { type: 'entities', entities: list, ...opts };
}

export const row = (entity, name, extra = {}) => (entity ? { entity, ...(name && { name }), ...extra } : null);

export function history(ids, opts = {}) {
  const list = ids.filter(Boolean);
  if (!list.length) return null;
  return { type: 'history-graph', hours_to_show: 24, entities: list, grid_options: { columns: 'full' }, ...opts };
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

// Views carry no icon on purpose: with eight tabs, Home Assistant would show
// icons only, and nobody reads "shield" as "Firewall" at a glance.
export function view(key, title, sections, extra = {}) {
  return {
    type: 'sections', path: key, title, max_columns: 4,
    sections: sections.filter(Boolean), ...extra,
  };
}

/** Settings-style table (table-card.js); null when it would have no row. */
export function table(title, icon, columns, rows, opts = {}) {
  const list = rows.filter(Boolean);
  if (!list.length && !opts.empty) return null;
  return { type: 'custom:nivuus-table-card', title, icon, columns, rows: list, ...opts };
}

/** A row action that presses a button entity, confirmed when `confirm` is set. */
export function pressAction(entity, label, icon, confirm) {
  if (!entity) return null;
  return {
    label, icon,
    tap_action: {
      action: 'perform-action', perform_action: 'button.press', target: { entity_id: entity },
      ...(confirm && { confirmation: { text: confirm } }),
    },
  };
}

/** Settings-style list: an entities card with a header icon. */
export const list = (title, icon, rows, opts = {}) =>
  entities(rows, { title, icon, state_color: true, grid_options: { columns: 'full' }, ...opts });

/** An entities-card row that presses a button entity, confirmed when `confirm` is set. */
export function buttonRow(entity, name, icon, actionName, confirm) {
  if (!entity) return null;
  return {
    type: 'button', name, icon, action_name: actionName,
    tap_action: {
      action: 'perform-action', perform_action: 'button.press', target: { entity_id: entity },
      ...(confirm && { confirmation: { text: confirm } }),
    },
  };
}
