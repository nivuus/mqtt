# Server dashboard for Home Assistant

A Home Assistant **dashboard strategy** (`custom:nivuus-server`) that builds the
server dashboard from the entities this agent publishes. It replaced, on
2026-11-10, both the `nivuus-panel` custom panel (`/nivuus`) and the hand-made
"Serveur" Lovelace dashboard (`/nivuus-dashboard`).

## Why a strategy

- **Stock cards.** Tiles, gauges, history graphs, entities rows, markdown,
  heading badges, tile features (`bar-gauge`, `trend-graph`, `toggle`,
  `update-actions`) and Lovelace action confirmations. Theme, more-info dialogs,
  mobile layout and accessibility come from Home Assistant. The only custom card
  is `cpu-cores-card.js`, because no stock card shows 24 cores readably.
- **Generated, not hand-kept.** Views are built from the entity registry when
  they are opened, so a new disk, VM, Wi-Fi network, bridge or firewall zone
  shows up without anyone editing a dashboard.
- **Keyed on unique_id.** Entities are found by their `unique_id`
  (`nivuus_<feature>_<key>`, which is the agent's contract), not by `entity_id`.
  The `entity_id`s carry two generations of prefixes (`linux_system_agent_*`
  and `nivuus_*`) and can be renamed. Reading `unique_id` needs the admin-only
  `config/entity_registry/list` command, so the dashboard is admin-only.

## Layout

| Path | Role |
|---|---|
| `src/nivuus-server.js` | Entry: the dashboard and view strategies |
| `src/registry.js` | Registry fetch (cached per registry revision), unique_id index |
| `src/model/` | Pure: registry + states → model (CPU, disks, bridges, zones…) |
| `src/views/` | One file per tab; `attention.js` holds the overview checks |
| `src/cards.js` | Builders for stock card configs |
| `src/i18n/` | English source, French; other languages fall back to English labels |
| `src/cpu-cores-card.js` | The custom core grid |
| `test/` | `node --test`; `fixtures/host.json` is the reference host's registry, anonymised |

The **overview** starts with "Needs attention": each check is a card with a
visibility condition (filesystem above 85 %, SMART not `PASSED`, a service not
`active`, UPS on battery, CPU above 85 °C, MCE or thermal events, guest VPN wanted
but down, pending updates). Home Assistant evaluates the conditions in the
browser, so the section follows the server live. The all-clear note uses
`not` + `or`, because Home Assistant's `not` means "not all".

**Language.** The dashboard's own words come from `src/i18n/`. Entity states,
numbers, units and relative times are formatted by Home Assistant in the user's
language and locale. Missing today: a dictionary for any language other than
English and French. Users of other languages see English titles around localised
values. State codes the agent publishes as text (`connected`, `PASSED`…) stay
untranslated, because MQTT discovery has no translation keys.

## Deploy

```bash
HA_CONFIG=/opt/nivuus/home-manager/config scripts/deploy-ha-dashboard.sh
# prints /local/nivuus-server/<commit>/nivuus-server.js
```

1. Register (or update) that URL as a dashboard resource of type *JavaScript module*.
2. Use a dashboard whose configuration is only:
   ```yaml
   strategy:
     type: custom:nivuus-server
   ```
   Make it admin-only.
3. Old commit directories under `www/nivuus-server/` can be deleted once the
   resource points elsewhere.

History graphs need the recorder. Do not exclude `sensor.linux_system_agent_*`
wholesale: CPU load and memory still carry that prefix. Exclude only the
per-core sensors if volume matters.

## Test

```bash
npm run test:dashboard
```
