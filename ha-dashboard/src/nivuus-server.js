// Entry point, loaded by Home Assistant as a dashboard resource (module).
//
// Registers the `custom:nivuus-server` strategy: the dashboard lists the
// views, and each view is generated only when opened, from the entity
// registry and the current states. Every card is a stock Home Assistant card
// but one (cpu-cores-card.js), so theming, dialogs, confirmations and the
// mobile layout are Home Assistant's own.

import './cpu-cores-card.js';
import './table-card.js';
import { loadAgentEntries } from './registry.js';
import { buildModel } from './model/index.js';
import { makeTranslator, languageOf } from './i18n/index.js';
import { VIEWS, buildView } from './views/index.js';

const NAME = 'nivuus-server';

class NivuusServerDashboardStrategy extends HTMLElement {
  static async generate(config, hass) {
    const t = makeTranslator(languageOf(hass));
    return {
      title: config.title ?? t('dashboard.title'),
      views: VIEWS.map((v) => ({
        title: t(`view.${v.key}`),
        path: v.key,
        strategy: { type: `custom:${NAME}`, view: v.key },
      })),
    };
  }
}

class NivuusServerViewStrategy extends HTMLElement {
  static async generate(config, hass) {
    const entries = await loadAgentEntries(hass);
    const t = makeTranslator(languageOf(hass));
    const base = `/${hass.panelUrl}`;
    return buildView(config.view, {
      m: buildModel(entries, hass.states),
      t,
      nav: (path) => ({ action: 'navigate', navigation_path: `${base}/${path}` }),
      hass,
      agentFound: entries.length > 0,
    });
  }
}

customElements.define(`ll-strategy-dashboard-${NAME}`, NivuusServerDashboardStrategy);
customElements.define(`ll-strategy-view-${NAME}`, NivuusServerViewStrategy);

window.customStrategies = window.customStrategies || [];
window.customStrategies.push({
  type: NAME,
  strategyType: 'dashboard',
  name: 'Nivuus server',
  description: 'Server dashboard generated from the Nivuus system agent entities.',
});
