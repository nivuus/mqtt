// src/features/firewall/firewallRules.ts
//
// One firewalld rule change, from the JSON command the dashboard sends to the
// firewall-cmd calls that apply it.
//
// A change is written to the permanent configuration and then to the runtime
// one, never through `firewall-cmd --reload`: a live reload cut the home LAN on
// 2026-11-09. Both calls are checked; the result says which part failed.

import { execute_argv } from '../../utils/exec';
import { Validators } from '../../utils/validators';

export type RuleOp = 'add' | 'remove';

export type Rule =
  | { kind: 'service'; service: string }
  | { kind: 'port'; port: string; protocol: string }
  | { kind: 'forward'; port: string; protocol: string; toaddr: string; toport: string };

export interface RuleCommand {
  /** Echoed in the result so the card that sent the command can recognise its answer. */
  id: string;
  op: RuleOp;
  zone: string;
  rule: Rule;
}

/** Published as the last-action attributes; the dashboard words it in the user's language. */
export interface RuleResult {
  id: string;
  ok: boolean;
  op?: RuleOp;
  zone?: string;
  rule?: Rule;
  /** `invalid`: refused before any change; `permanent`/`runtime`: which write failed. */
  failed?: 'invalid' | 'permanent' | 'runtime';
  /** firewalld's own message (e.g. ALREADY_ENABLED), or the field that failed validation. */
  detail?: string;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Parses and validates a command; returns the reason when it is refused. */
export function parseRuleCommand(raw: string, zones: string[]): RuleCommand | { error: string; id: string } {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: 'json', id: '' };
  }
  const id = typeof data?.id === 'string' && ID_RE.test(data.id) ? data.id : '';
  const fail = (error: string) => ({ error, id });
  if (data?.op !== 'add' && data?.op !== 'remove') return fail('op');
  if (!Validators.isZone(data.zone) || !zones.includes(data.zone)) return fail('zone');
  const r = data.rule ?? {};
  let rule: Rule;
  if (r.kind === 'service') {
    if (!Validators.isFirewallService(r.service)) return fail('service');
    rule = { kind: 'service', service: r.service };
  } else if (r.kind === 'port') {
    if (!Validators.isPort(r.port)) return fail('port');
    if (!Validators.isProtocol(r.protocol)) return fail('protocol');
    rule = { kind: 'port', port: r.port, protocol: r.protocol };
  } else if (r.kind === 'forward') {
    if (!Validators.isPort(r.port)) return fail('port');
    if (!Validators.isProtocol(r.protocol)) return fail('protocol');
    if (!Validators.isIPv4(r.toaddr)) return fail('toaddr');
    if (!Validators.isPort(r.toport)) return fail('toport');
    rule = { kind: 'forward', port: r.port, protocol: r.protocol, toaddr: r.toaddr, toport: r.toport };
  } else {
    return fail('kind');
  }
  return { id, op: data.op, zone: data.zone, rule };
}

/** The firewall-cmd option for a rule, e.g. `--add-port=445/tcp`. */
export function ruleOption(op: RuleOp, rule: Rule): string {
  switch (rule.kind) {
    case 'service': return `--${op}-service=${rule.service}`;
    case 'port': return `--${op}-port=${rule.port}/${rule.protocol}`;
    // argv: the rule is one literal argument, no quoting.
    case 'forward': return `--${op}-forward-port=port=${rule.port}:proto=${rule.protocol}:toport=${rule.toport}:toaddr=${rule.toaddr}`;
  }
}

/**
 * Runs `args` against the permanent configuration, then the runtime one.
 * Returns which write failed, with firewalld's message.
 */
export async function applyBoth(args: string[]): Promise<Pick<RuleResult, 'ok' | 'failed' | 'detail'>> {
  const permanent = await execute_argv('firewall-cmd', ['--permanent', ...args]);
  if (permanent.exitCode !== 0) return { ok: false, failed: 'permanent', detail: (permanent.stderr || permanent.stdout).trim() };
  const runtime = await execute_argv('firewall-cmd', args);
  if (runtime.exitCode !== 0) return { ok: false, failed: 'runtime', detail: (runtime.stderr || runtime.stdout).trim() };
  return { ok: true };
}

export async function applyRule(command: RuleCommand): Promise<RuleResult> {
  const { id, op, zone, rule } = command;
  const outcome = await applyBoth([`--zone=${zone}`, ruleOption(op, rule)]);
  return { id, op, zone, rule, ...outcome };
}

/** Moves an interface to another zone, permanently and at runtime. */
export function moveInterface(iface: string, zone: string): ReturnType<typeof applyBoth> {
  return applyBoth([`--zone=${zone}`, `--change-interface=${iface}`]);
}
