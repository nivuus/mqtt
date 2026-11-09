/**
 * The activation wait is bounded by a clock, not a poll count, and every failure path cancels
 * the activation. Exec is mocked and time is fake: nothing here touches NetworkManager.
 */
import * as execModule from '../../../utils/exec';
import { waitForActivation, ActivationEnv } from '../nmActivation';

jest.mock('../../../utils/exec');
const exec = execModule as jest.Mocked<typeof execModule>;

const UUID = '00000000-0000-4000-8000-000000000001';
const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' });

describe('waitForActivation', () => {
  let clock: number;
  let env: ActivationEnv;
  let calls: Array<{ args: string[]; timeoutMs?: number }>;
  /** Fake time one poll takes, up to its timeout. */
  let pollCost: number;
  let onPoll: (n: number) => ReturnType<typeof ok> | Error;
  let down: () => ReturnType<typeof ok> | Error;

  beforeEach(() => {
    clock = 0;
    pollCost = 0;
    calls = [];
    down = () => ok('');
    onPoll = () => ok('GENERAL.STATE:activating\n');
    env = { sleep: async ms => { clock += ms; }, now: () => clock, pollMs: 500, activationTimeoutMs: 90000 };
    exec.execute_argv.mockImplementation(async (_file, args, opts) => {
      calls.push({ args, timeoutMs: opts?.timeoutMs });
      const isDown = args.includes('down');
      if (!isDown) clock += pollCost;
      const out = isDown ? down() : onPoll(calls.filter(c => !c.args.includes('down')).length);
      if (out instanceof Error) throw out;
      return { ...out, spawnError: undefined } as never;
    });
  });

  const polls = () => calls.filter(c => c.args.includes('GENERAL.STATE'));
  const downs = () => calls.filter(c => c.args.includes('down'));

  it('gives every poll a 10 s timeout', async () => {
    onPoll = () => ok('GENERAL.STATE:activated\n');
    await waitForActivation(env, UUID);
    expect(polls().map(c => c.timeoutMs)).toEqual([10000]);
  });

  it('polls that each hang for their whole timeout cannot stretch the wait past deadline + one poll', async () => {
    pollCost = 10000;
    await expect(waitForActivation(env, UUID)).rejects.toThrow(/still activating after 90 s/);
    expect(clock).toBeLessThanOrEqual(90000 + 10000 + 500 + 1000);
    expect(polls().length).toBeLessThanOrEqual(10);
    expect(downs()).toHaveLength(1);
  });

  it('a poll that throws mid-wait still cancels the activation, then rethrows', async () => {
    onPoll = n => (n < 3 ? ok('GENERAL.STATE:activating\n') : new Error('nmcli timed out'));
    await expect(waitForActivation(env, UUID)).rejects.toThrow(/nmcli timed out/);
    expect(downs().map(c => c.args)).toEqual([['connection', 'down', 'uuid', UUID]]);
  });

  it('reports both errors when the cancel fails too', async () => {
    onPoll = () => new Error('poll boom');
    down = () => new Error('down boom');
    const err = (await waitForActivation(env, UUID).then(() => new Error("resolved"), e => e)) as Error;
    expect(err.message).toMatch(/poll boom/);
    expect(err.message).toMatch(/down boom/);
  });

  it('does not cancel an activation NM already dropped', async () => {
    onPoll = () => ok('');
    await expect(waitForActivation(env, UUID)).rejects.toThrow(/dropped the VPN/);
    expect(downs()).toHaveLength(0);
  });
});
