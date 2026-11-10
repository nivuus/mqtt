// The dashboard's views, in tab order.

import { overview } from './overview.js';
import { performance } from './performance.js';
import { network } from './network.js';
import { wifi } from './wifi.js';
import { firewall } from './firewall.js';
import { storage } from './storage.js';
import { services } from './services.js';
import { maintenance, backupEntities } from './maintenance.js';
import { markdown, section, view } from '../cards.js';

export const VIEWS = [
  { key: 'overview', build: (ctx) => overview(ctx.m, ctx.t, ctx.nav) },
  { key: 'performance', build: (ctx) => performance(ctx.m, ctx.t) },
  { key: 'network', build: (ctx) => network(ctx.m, ctx.t) },
  { key: 'wifi', build: (ctx) => wifi(ctx.m, ctx.t) },
  { key: 'firewall', build: (ctx) => firewall(ctx.m, ctx.t) },
  { key: 'storage', build: (ctx) => storage(ctx.m, ctx.t) },
  { key: 'services', build: (ctx) => services(ctx.m, ctx.t) },
  { key: 'maintenance', build: (ctx) => maintenance(ctx.m, ctx.t, backupEntities(ctx.hass)) },
];

/**
 * ctx: { m: model, t: translator, nav: path -> navigate action, hass,
 * agentFound: whether the registry holds any of the agent's entities }.
 */
export function buildView(key, ctx) {
  const spec = VIEWS.find((v) => v.key === key);
  if (!spec) throw new Error(`Unknown view: ${key}`);
  if (!ctx.agentFound) {
    return view(key, ctx.t(`view.${key}`), [
      section([markdown(ctx.t('empty.agent'))], { column_span: 4 }),
    ]);
  }
  return spec.build(ctx);
}
