// src/websocket/__tests__/serverConfig.test.ts

import {
  resolveWebSocketConfig, WebSocketConfigError, DEFAULT_HOST, DEFAULT_MAX_PAYLOAD_BYTES, TOKEN_ENV_VAR,
} from '../serverConfig';
import { tokensMatch, isAuthMessage, isWizardCommand, isOriginAllowed } from '../messageGuards';

const GOOD_TOKEN = 'a'.repeat(64);

describe('resolveWebSocketConfig', () => {
  it('returns null when the section is missing or disabled', () => {
    expect(resolveWebSocketConfig(undefined, {})).toBeNull();
    expect(resolveWebSocketConfig({ enabled: false }, {})).toBeNull();
  });

  it('binds to loopback by default and bounds the payload size', () => {
    const config = resolveWebSocketConfig({ enabled: true, auth: { token: GOOD_TOKEN } }, {});
    expect(config).toMatchObject({ host: DEFAULT_HOST, port: 8766, maxPayloadBytes: DEFAULT_MAX_PAYLOAD_BYTES });
    expect(config?.allowedOrigins).toEqual([]);
  });

  it('takes the token from the environment over agent.yaml', () => {
    const config = resolveWebSocketConfig(
      { enabled: true, auth: { token: 'CHANGE_ME_WIZARD_TOKEN' } },
      { [TOKEN_ENV_VAR]: GOOD_TOKEN },
    );
    expect(config?.token).toBe(GOOD_TOKEN);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['the repository placeholder', 'CHANGE_ME_WIZARD_TOKEN'],
    ['an unresolved env reference', '${NIVUUS_WS_TOKEN}'],
    ['too short', 'x'.repeat(31)],
  ])('refuses a token that is %s', (_label, token) => {
    expect(() => resolveWebSocketConfig({ enabled: true, auth: { token } }, {}))
      .toThrow(WebSocketConfigError);
  });

  it('refuses to run without authentication', () => {
    expect(() => resolveWebSocketConfig({ enabled: true, auth: { type: 'none', token: GOOD_TOKEN } }, {}))
      .toThrow(/only "token"/);
  });

  it('refuses invalid numeric limits and origins', () => {
    const base = { enabled: true, auth: { token: GOOD_TOKEN } };
    expect(() => resolveWebSocketConfig({ ...base, max_payload_bytes: 0 }, {})).toThrow(WebSocketConfigError);
    expect(() => resolveWebSocketConfig({ ...base, port: 70000 }, {})).toThrow(WebSocketConfigError);
    expect(() => resolveWebSocketConfig({ ...base, allowed_origins: [1 as unknown as string] }, {}))
      .toThrow(WebSocketConfigError);
  });
});

describe('message guards', () => {
  it('compares tokens exactly, including length and non-ASCII content', () => {
    expect(tokensMatch(GOOD_TOKEN, GOOD_TOKEN)).toBe(true);
    expect(tokensMatch(GOOD_TOKEN.slice(1), GOOD_TOKEN)).toBe(false);
    expect(tokensMatch(GOOD_TOKEN + 'a', GOOD_TOKEN)).toBe(false);
    expect(tokensMatch('ключ-密钥-مفتاح', 'ключ-密钥-مفتاح')).toBe(true);
    expect(tokensMatch(undefined, GOOD_TOKEN)).toBe(false);
    expect(tokensMatch(['a'], GOOD_TOKEN)).toBe(false);
    expect(tokensMatch('', '')).toBe(false);
  });

  it('requires a string token in auth messages', () => {
    expect(isAuthMessage({ type: 'auth', token: 'x' })).toBe(true);
    expect(isAuthMessage({ type: 'auth', token: { $ne: null } })).toBe(false);
    expect(isAuthMessage(null)).toBe(false);
  });

  it('requires string fields and an object params in commands', () => {
    const ok = { id: '1', type: 'action', feature: 'vm', action: 'list_vms', params: {} };
    expect(isWizardCommand(ok)).toBe(true);
    expect(isWizardCommand({ ...ok, action: ['list_vms'] })).toBe(false);
    expect(isWizardCommand({ ...ok, params: 'x' })).toBe(false);
  });

  it('accepts no Origin (non-browser clients) and only allowlisted Origins', () => {
    expect(isOriginAllowed(undefined, [])).toBe(true);
    expect(isOriginAllowed('https://evil.example', [])).toBe(false);
    expect(isOriginAllowed('http://ha.local:8123', ['http://ha.local:8123'])).toBe(true);
  });
});
