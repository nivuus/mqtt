// Small query helpers over the unique_id index built by registry.js.

export class Lookup {
  constructor(index, states) {
    this.index = index;
    this.states = states;
  }

  /** entity_id of `nivuus_<suffix>`, or undefined. */
  id(suffix) {
    return this.index.get(`nivuus_${suffix}`);
  }

  /**
   * Every entity whose unique_id matches `nivuus_<pattern>`. Each result is
   * `{ match, entityId }` where match holds the regex groups.
   */
  all(pattern) {
    const re = new RegExp(`^nivuus_${pattern}$`);
    const out = [];
    for (const [uid, entityId] of this.index) {
      const match = uid.match(re);
      if (match) out.push({ match, entityId });
    }
    return out;
  }

  state(entityId) {
    return entityId ? this.states[entityId] : undefined;
  }

  attr(entityId, name) {
    return this.state(entityId)?.attributes?.[name];
  }

  /** Keep only the ids that resolve, so a missing entity never yields a broken card. */
  present(...ids) {
    return ids.filter(Boolean);
  }
}

/** Natural order: core_2 before core_10, enp5s0 before enp15s0. */
export function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}
