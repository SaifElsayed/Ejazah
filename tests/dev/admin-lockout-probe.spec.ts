// T087 — `scripts/dev/admin-lockout-probe.ts`, the administrator's sign-in seen from outside
// (quickstart §4, SC-109, FR-170 to FR-173). Per the note under T087 (the owner's approval of
// 2026-10-27) it is NOT read-only: each wrong attempt counts toward the lockout the API writes. So it
// runs only on this machine, only against the seed's administrator, says before its first attempt
// that the attempts count toward the lockout (the counts read from the settings), reads the right
// password from hidden input and never from its arguments, and judges the timing by T060's
// tolerance, one password verify (`admin-auth.service.spec.ts`).
//
// Its own logic is proved here with the database and the API stood in: the arguments, the hidden
// input, the plan read from the settings, the order of the attempts and the verdict. It is never run
// against a real account.
import { describe, expect, it } from 'vitest';

import { ADMINISTRATOR } from '../../prisma/seed';
import {
  type Attempt,
  hiddenInputStep,
  judge,
  parseArguments,
  planOf,
  run,
  type RunDependencies,
  SIGN_IN_PATH,
  TOLERANCE_IN_VERIFIES,
} from '../../scripts/dev/admin-lockout-probe';
import type { Connection } from '../../scripts/dev/local-only';

const LOCAL = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://ijazah_app:secret@localhost:5432/ijazah',
};
const RIGHT = 'the right password, typed';
const REFUSED = '{"error":{"code":"ADMIN_SIGN_IN_FAILED","message":"Sign-in failed."}}';

const SETTINGS: readonly { readonly key: string; readonly value: unknown }[] = [
  { key: 'admin_lockout_attempts', value: 5 },
  { key: 'admin_lockout_minutes', value: 15 },
  { key: 'rate_limit_authentication', value: { limit: 10, window_seconds: 900 } },
];

describe('the command line', () => {
  it('takes the API’s origin and nothing else', () => {
    expect(parseArguments([])).toEqual({});
    expect(parseArguments(['--api', 'http://127.0.0.1:4000'])).toEqual({
      api: 'http://127.0.0.1:4000',
    });
  });

  it.each([
    [['--password', RIGHT]],
    [[`--password=${RIGHT}`]],
    [[RIGHT]],
    [['--email', 'someone@example.com']],
  ])('refuses %j: the password is never an argument, nor the account', (argv) => {
    expect(parseArguments(argv)).toMatch(/usage/);
  });
});

describe('the hidden input', () => {
  it('collects what is typed, without echo, until Enter', () => {
    let step = hiddenInputStep('', 'sec');
    expect(step).toEqual({ typed: 'sec', state: 'typing' });
    step = hiddenInputStep(step.typed, 'ret\r');
    expect(step).toEqual({ typed: 'secret', state: 'entered' });
    expect(hiddenInputStep('', 'piped\n')).toEqual({ typed: 'piped', state: 'entered' });
  });

  it('honours Backspace and ignores other control characters', () => {
    expect(hiddenInputStep('secrex', '\u007ft\u001b')).toEqual({
      typed: 'secret',
      state: 'typing',
    });
    expect(hiddenInputStep('', '\b\b')).toEqual({ typed: '', state: 'typing' });
  });

  it('is cancelled by Ctrl-C, and by Ctrl-D on an empty line', () => {
    expect(hiddenInputStep('half', '\u0003')).toEqual({ typed: '', state: 'cancelled' });
    expect(hiddenInputStep('', '\u0004')).toEqual({ typed: '', state: 'cancelled' });
  });
});

describe('the plan, read from the settings', () => {
  it('is the lockout pair and the throttle the attempts must stay under', () => {
    expect(planOf(SETTINGS)).toEqual({ attempts: 5, minutes: 15, throttleLimit: 10 });
    expect(
      planOf([
        { key: 'admin_lockout_attempts', value: 3 },
        { key: 'admin_lockout_minutes', value: 2 },
        { key: 'rate_limit_authentication', value: { limit: 6, window_seconds: 60 } },
      ]),
    ).toEqual({ attempts: 3, minutes: 2, throttleLimit: 6 });
  });

  it('refuses a missing or malformed setting, naming the key', () => {
    expect(planOf(SETTINGS.slice(1))).toMatch(/admin_lockout_attempts/);
    expect(planOf([{ key: 'admin_lockout_attempts', value: '5' }, ...SETTINGS.slice(1)])).toMatch(
      /admin_lockout_attempts/,
    );
    expect(planOf(SETTINGS.slice(0, 2))).toMatch(/rate_limit_authentication/);
  });

  it('refuses when the attempts would meet the throttle before the lockout', () => {
    expect(
      planOf([
        ...SETTINGS.slice(0, 2),
        { key: 'rate_limit_authentication', value: { limit: 6, window_seconds: 900 } },
      ]),
    ).toMatch(/rate_limit_authentication/);
  });
});

function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    label: 'wrong 1',
    status: 401,
    body: REFUSED,
    headerNames: ['content-type', 'vary'],
    milliseconds: 50,
    ...overrides,
  };
}

describe('the verdict', () => {
  const sevenAlike = Array.from({ length: 7 }, (_, index) =>
    attempt({ label: `attempt ${index + 1}`, milliseconds: 50 + index }),
  );

  it('passes seven identical refusals within one verify of each other', () => {
    expect(judge(sevenAlike, 10)).toEqual({ passed: true, findings: [] });
  });

  it('holds T060’s tolerance: the spread is under one verify', () => {
    expect(TOLERANCE_IN_VERIFIES).toBe(1);
    const spread = [...sevenAlike.slice(0, 6), attempt({ label: 'right', milliseconds: 70 })];
    const verdict = judge(spread, 10);
    expect(verdict.passed).toBe(false);
    expect(verdict.findings.join('\n')).toMatch(/timing/);
  });

  it('fails a status or a body that differs, by a byte', () => {
    for (const odd of [attempt({ status: 429 }), attempt({ body: `${REFUSED} ` })]) {
      const verdict = judge([...sevenAlike.slice(0, 6), { ...odd, label: 'right' }], 10);
      expect(verdict.passed).toBe(false);
      expect(verdict.findings.join('\n')).toMatch(/right/);
    }
  });

  it('fails answers that are alike but are not the sign-in refusal, so the lockout was never reached', () => {
    for (const odd of [
      attempt({ status: 404, body: '{"error":{"code":"NOT_FOUND"}}' }),
      attempt({ status: 401, body: '{"error":{"code":"UNAUTHENTICATED"}}' }),
    ]) {
      const all = sevenAlike.map((one) => ({ ...one, status: odd.status, body: odd.body }));
      const verdict = judge(all, 10);
      expect(verdict.passed).toBe(false);
      expect(verdict.findings.join('\n')).toMatch(/ADMIN_SIGN_IN_FAILED/);
    }
  });

  it('fails a right password that signed in during the lockout', () => {
    const verdict = judge(
      sevenAlike.map((one) => ({ ...one, status: 200, body: '{"result":{}}' })),
      10,
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.findings.join('\n')).toMatch(/signed in/);
  });

  it('fails a response that carries a count, in its body or its headers', () => {
    for (const odd of [
      attempt({ body: '{"error":{"code":"ADMIN_SIGN_IN_FAILED","remaining":2}}' }),
      attempt({ headerNames: ['content-type', 'x-attempts-left'] }),
      attempt({ headerNames: ['retry-after'] }),
    ]) {
      const all = sevenAlike.map((one) => ({
        ...one,
        body: odd.body,
        headerNames: odd.headerNames,
      }));
      const verdict = judge(all, 10);
      expect(verdict.passed).toBe(false);
      expect(verdict.findings.join('\n')).toMatch(/count/);
    }
  });
});

/** A probe run with the database and the API stood in, recording what happened in order. */
async function probe(
  options: {
    readonly argv?: readonly string[];
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly administrator?: Readonly<Record<string, boolean>> | null;
    readonly settings?: readonly { key: string; value: unknown }[];
    readonly answer?: (index: number) => { status: number; body: string };
    readonly secret?: string | null;
  } = {},
) {
  const events: string[] = [];
  const sent: { url: string; body: { email: string; password: string } }[] = [];
  const printed: string[] = [];
  const administrator =
    options.administrator === undefined
      ? { passwordSet: true, active: true, locked: false }
      : options.administrator;
  const connection: Connection = {
    query: async (text: string) => {
      events.push('query');
      const rows = text.includes('admin_users')
        ? administrator === null
          ? []
          : [administrator]
        : (options.settings ?? SETTINGS);
      return { rows } as never;
    },
    end: async () => undefined,
  };
  let clock = 0;
  const dependencies: RunDependencies = {
    connect: async () => {
      events.push('connect');
      return connection;
    },
    fetch: async (input, init) => {
      events.push('send');
      sent.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      const { status, body } = (options.answer ?? (() => ({ status: 401, body: REFUSED })))(
        sent.length - 1,
      );
      return new Response(body, { status, headers: { 'content-type': 'application/json' } });
    },
    readSecret: async () => {
      events.push('secret');
      return options.secret === undefined ? RIGHT : options.secret;
    },
    oneVerifyMilliseconds: async () => 40,
    now: () => (clock += 25),
    out: (line) => {
      events.push(`out: ${line}`);
      printed.push(line);
    },
    err: (line) => {
      events.push(`err: ${line}`);
      printed.push(line);
    },
  };
  const code = await run(options.argv ?? [], options.env ?? LOCAL, dependencies);
  return { code, events, sent, printed: printed.join('\n') };
}

describe('a run (the API and the database stood in)', () => {
  it('warns before its first attempt, then signs in wrong, wrong again, then right, and passes', async () => {
    const { code, events, sent, printed } = await probe();

    expect(code).toBe(0);
    const firstSend = events.indexOf('send');
    const warning = events.findIndex((event) => /count toward the lockout/.test(event));
    expect(warning).toBeGreaterThanOrEqual(0);
    expect(warning).toBeLessThan(events.indexOf('secret'));
    expect(events.indexOf('secret')).toBeLessThan(firstSend);
    expect(printed).toMatch(/5 attempts/);
    expect(printed).toMatch(/15 minutes/);

    expect(sent).toHaveLength(7);
    for (const { url, body } of sent) {
      expect(url).toBe(`http://localhost:3000${SIGN_IN_PATH}`);
      expect(body.email).toBe(ADMINISTRATOR.email);
    }
    const passwords = sent.map(({ body }) => body.password);
    expect(passwords.slice(0, 6).every((password) => password !== RIGHT)).toBe(true);
    expect(passwords[6]).toBe(RIGHT);
    expect(new Set(passwords.slice(0, 6)).size).toBe(6);

    expect(printed).toMatch(/PASS/);
    expect(printed).not.toContain(RIGHT);
  });

  it('fails when the right password signs in during the lockout', async () => {
    const { code, printed } = await probe({
      answer: (index) =>
        index === 6
          ? { status: 200, body: '{"result":{"data":{"next":"mfa"}}}' }
          : { status: 401, body: REFUSED },
    });
    expect(code).toBe(1);
    expect(printed).toMatch(/FAIL/);
    expect(printed).not.toContain('"next"');
  });

  it('refuses a remote API before it opens the database, reads a secret or sends anything', async () => {
    const { code, events, printed } = await probe({
      argv: ['--api', 'https://api.ijazah.example'],
    });
    expect(code).not.toBe(0);
    expect(events.filter((event) => !event.startsWith('err'))).toEqual([]);
    expect(printed).toMatch(/API/);
  });

  it('refuses outside development or test, before anything', async () => {
    const { code, events } = await probe({ env: { ...LOCAL, NODE_ENV: 'production' } });
    expect(code).not.toBe(0);
    expect(events.filter((event) => !event.startsWith('err'))).toEqual([]);
  });

  it.each([
    ['the seed’s administrator is absent', null, /seed/],
    [
      'its password was never set',
      { passwordSet: false, active: true, locked: false },
      /admin-invite/,
    ],
    ['it is disabled', { passwordSet: true, active: false, locked: false }, /disabled/],
    ['it is locked already', { passwordSet: true, active: true, locked: true }, /locked/],
  ])('refuses, sending nothing, when %s', async (_case, administrator, reason) => {
    const { code, events, printed } = await probe({ administrator });
    expect(code).not.toBe(0);
    expect(events).not.toContain('send');
    expect(events).not.toContain('secret');
    expect(printed).toMatch(reason);
  });

  it('sends nothing when no password is typed', async () => {
    for (const secret of ['', null]) {
      const { code, events } = await probe({ secret });
      expect(code).not.toBe(0);
      expect(events).not.toContain('send');
    }
  });
});
