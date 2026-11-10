// The one custom card of the dashboard: every CPU core at a glance.
//
// No stock card shows 24 cores readably: 24 history lines are a tangle and
// 24 tiles fill a screen. Each cell shows the core's load (fill height) and
// temperature; a click opens Home Assistant's own more-info dialog. Values are
// formatted by `hass.formatEntityState`, so numbers follow the user's locale.

export const CORE_CARD_TYPE = 'custom:nivuus-cpu-cores-card';
const TAG = 'nivuus-cpu-cores-card';
// Temperatures from which a core is drawn as warm, then hot (°C).
const WARM_C = 80;
const HOT_C = 90;

const STYLE = `
  ha-card { padding: 12px 16px 16px; }
  h2 { margin: 0 0 12px; font: var(--ha-font-weight-medium, 500) var(--ha-font-size-l, 16px)/1.4 var(--ha-font-family-body, inherit); color: var(--primary-text-color); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(56px, 1fr)); gap: 6px; }
  button {
    position: relative; overflow: hidden; border: 0; border-radius: var(--ha-card-border-radius, 12px);
    background: var(--secondary-background-color); color: var(--primary-text-color);
    padding: 6px 4px; font: inherit; cursor: pointer; text-align: center; min-height: 56px;
  }
  button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  .fill {
    position: absolute; inset: 0; transform-origin: bottom; transform: scaleY(var(--load, 0));
    background: color-mix(in srgb, var(--primary-color) 35%, transparent);
    transition: transform .6s ease;
  }
  .n, .load, .temp { position: relative; display: block; line-height: 1.25; }
  .n { font-size: 11px; color: var(--secondary-text-color); }
  .load { font-weight: 600; font-size: 13px; font-variant-numeric: tabular-nums; }
  .temp { font-size: 11px; font-variant-numeric: tabular-nums; color: var(--secondary-text-color); }
  .warm .temp { color: var(--warning-color); }
  .hot .temp { color: var(--error-color); font-weight: 600; }
  @media (prefers-reduced-motion: reduce) { .fill { transition: none; } }
`;

const numeric = (stateObj) => {
  const v = Number(stateObj?.state);
  return Number.isFinite(v) ? v : undefined;
};

function defineCard() {
  class CpuCoresCard extends HTMLElement {
    setConfig(config) {
      if (!Array.isArray(config.cores)) throw new Error('cores is required');
      this._config = config;
      this._cells = undefined;
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._cells) this._build();
      this._update();
    }

    getCardSize() {
      return 3;
    }

    getGridOptions() {
      return { columns: 'full', rows: 'auto' };
    }

    _build() {
      const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${STYLE}</style><ha-card><h2></h2><div class="grid"></div></ha-card>`;
      root.querySelector('h2').textContent = this._config.title ?? '';
      const grid = root.querySelector('.grid');
      this._cells = this._config.cores.map((core) => {
        const button = document.createElement('button');
        button.innerHTML = '<span class="fill"></span><span class="n"></span><span class="load"></span><span class="temp"></span>';
        button.querySelector('.n').textContent = String(core.n);
        button.addEventListener('click', () => this._moreInfo(core.load ?? core.temp));
        grid.append(button);
        return { core, button };
      });
    }

    _update() {
      const hass = this._hass;
      for (const { core, button } of this._cells) {
        const load = hass.states[core.load];
        const temp = hass.states[core.temp];
        const loadValue = numeric(load);
        const tempValue = numeric(temp);
        const loadText = load ? hass.formatEntityState(load) : '';
        const tempText = temp ? hass.formatEntityState(temp) : '';
        button.style.setProperty('--load', String(Math.max(0, Math.min(100, loadValue ?? 0)) / 100));
        button.querySelector('.load').textContent = loadText;
        button.querySelector('.temp').textContent = tempText;
        button.classList.toggle('warm', tempValue !== undefined && tempValue >= WARM_C && tempValue < HOT_C);
        button.classList.toggle('hot', tempValue !== undefined && tempValue >= HOT_C);
        button.setAttribute('aria-label', [this._config.title, core.n, loadText, tempText].filter(Boolean).join(' · '));
      }
    }

    _moreInfo(entityId) {
      if (!entityId) return;
      this.dispatchEvent(new CustomEvent('hass-more-info', {
        detail: { entityId }, bubbles: true, composed: true,
      }));
    }
  }

  if (!customElements.get(TAG)) customElements.define(TAG, CpuCoresCard);
}

// Imported by the unit tests under Node, where there is no DOM.
if (globalThis.customElements) defineCard();
