// Translator for the dashboard's own words (titles, names, confirmations).
//
// Entity states and numbers are not translated here: Home Assistant's cards
// format them in the user's language and locale. Only English and French have
// a dictionary today; any other language gets English labels around natively
// localised values, key by key.

import enLabels from './en-labels.js';
import enMessages from './en-messages.js';
import frLabels from './fr-labels.js';
import frMessages from './fr-messages.js';

const DICTIONARIES = {
  en: { ...enLabels, ...enMessages },
  fr: { ...frLabels, ...frMessages },
};

/** `fr-CA` -> `fr`; Home Assistant language codes are BCP 47 tags. */
export function dictionaryFor(language) {
  const base = String(language ?? 'en').toLowerCase().split(/[-_]/)[0];
  return DICTIONARIES[base] ?? DICTIONARIES.en;
}

export function makeTranslator(language) {
  const dict = dictionaryFor(language);
  const t = (key, vars = {}) => {
    const template = dict[key] ?? DICTIONARIES.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? String(vars[name]) : `{${name}}`));
  };
  const named = (prefix, name) => {
    const key = `${prefix}.${name}`;
    return key in dict || key in DICTIONARIES.en ? t(key) : undefined;
  };
  t.bridge = (name) => named('bridge', name) ?? name;
  t.service = (name) => named('service', name) ?? name;
  t.disk = (name) => named('disk', name) ?? t('disk.generic', { name });
  t.iface = (name) => named('bridge', name) ?? name;
  return t;
}

/** The language Home Assistant shows this user. */
export const languageOf = (hass) => hass.locale?.language ?? hass.language ?? 'en';
