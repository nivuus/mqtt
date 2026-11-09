// src/websocket/__tests__/serverConfig.test.ts

import {
  resolveWebSocketConfig, describeTokenSource, WebSocketConfigError, DEFAULT_HOST, DEFAULT_MAX_PAYLOAD_BYTES,
  MAX_AUTH_TIMEOUT_MS, TOKEN_ENV_VAR,
} from '../serverConfig';
import { tokensMatch, isAuthMessage, isWizardCommand, isOriginAllowed } from '../messageGuards';

const GOOD_TOKEN = '3f9c1e7a5b2d4c6e8f0a1b3c5d7e9f1a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e';

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
    ['a lower-case placeholder', 'change_me_wizard_token_0123456789abcdef'],
    ['a single repeated character', 'a'.repeat(64)],
    ['padded with leading whitespace', ' ' + GOOD_TOKEN],
    ['padded with a trailing newline', GOOD_TOKEN + '\n'],
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

  it('caps the auth timeout so setTimeout cannot overflow', () => {
    const base = { enabled: true, auth: { token: GOOD_TOKEN } };
    expect(() => resolveWebSocketConfig({ ...base, auth_timeout_ms: MAX_AUTH_TIMEOUT_MS + 1 }, {}))
      .toThrow(WebSocketConfigError);
    expect(resolveWebSocketConfig({ ...base, auth_timeout_ms: MAX_AUTH_TIMEOUT_MS }, {})?.authTimeoutMs)
      .toBe(MAX_AUTH_TIMEOUT_MS);
  });
});

describe('describeTokenSource', () => {
  const raw = { enabled: true, auth: { token: GOOD_TOKEN } };

  it('names the environment when it supplies the token', () => {
    expect(describeTokenSource(raw, { [TOKEN_ENV_VAR]: GOOD_TOKEN })).toBe(`environment (${TOKEN_ENV_VAR})`);
  });

  it('says when an empty environment variable was ignored in favour of agent.yaml', () => {
    expect(describeTokenSource(raw, { [TOKEN_ENV_VAR]: '' })).toBe(`agent.yaml (${TOKEN_ENV_VAR} is set but empty)`);
    expect(describeTokenSource(raw, {})).toBe('agent.yaml');
  });

  it('never contains the token itself', () => {
    expect(describeTokenSource(raw, { [TOKEN_ENV_VAR]: GOOD_TOKEN })).not.toContain(GOOD_TOKEN);
    expect(describeTokenSource(raw, {})).not.toContain(GOOD_TOKEN);
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
