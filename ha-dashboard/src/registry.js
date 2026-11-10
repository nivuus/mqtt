// Loads the agent's entities from the Home Assistant entity registry.
//
// The agent's contract with Home Assistant is the unique_id of each entity
// (`nivuus_<feature>_<key>`), not its entity_id: entity_ids carry two
// generations of prefixes (`linux_system_agent_*`, `nivuus_*`) and can be
// renamed by the user. `hass.entities` does not expose unique_id, so the
// admin-only `config/entity_registry/list` command is used instead.

let cache = { key: undefined, promise: undefined };

/**
 * Registry entries of the agent, fetched once per registry revision.
 * `hass.entities` is replaced by the frontend whenever the registry changes,
 * so its identity is the revision key.
 */
export function loadAgentEntries(hass) {
  if (cache.key !== hass.entities || !cache.promise) {
    const promise = hass
      .callWS({ type: 'config/entity_registry/list' })
      .then(selectAgentEntries);
    cache = { key: hass.entities, promise };
    // A failed fetch must not be served again on the next load.
    promise.catch(() => {
      if (cache.promise === promise) cache = { key: undefined, promise: undefined };
    });
  }
  return cache.promise;
}

export function selectAgentEntries(entries) {
  return entries.filter(
    (e) =>
      e.platform === 'mqtt' &&
      !e.disabled_by &&
      typeof e.unique_id === 'string' &&
      e.unique_id.startsWith('nivuus_'),
  );
}

// discoveryTopic() appends an 8-hex SHA-256 digest when the raw object id
// holds characters MQTT discovery forbids (e.g. `enp5s0.832`). The digest
// only disambiguates; the readable part is the key.
const DIGEST = /_[0-9a-f]{8}$/;

/** Map of unique_id (digest stripped) -> entity_id. */
export function indexByUniqueId(entries) {
  const index = new Map();
  for (const e of entries) {
    index.set(e.unique_id.replace(DIGEST, ''), e.entity_id);
  }
  return index;
}
