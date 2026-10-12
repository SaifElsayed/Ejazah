// T160 — the dependency-alerts gate (R-SEC-12, FR-060, SC-003).
//
// No merge while a critical dependency alert is open. The gate reads the same advisory data twice
// and fails closed on each: `pnpm audit --audit-level critical` over the lockfile, and the
// repository's open critical Dependabot alerts through the REST API. It also warns, without
// failing, when the token that reads the alerts is about to expire (T158). Every case below runs
// the gate over stand-ins for the audit and for GitHub's answers, so no network and no token are
// needed, and every refusal is reproducible from the repository.
import { describe, expect, it } from 'vitest';

import {
  ALERTS_URL,
  AUDIT_COMMAND,
  type Answer,
  type Dependencies,
  main,
} from '../../scripts/dependency-alerts';

const REPOSITORY = 'SaifElsayed/Ejazah';
const TOKEN = 'github_pat_standin_never_real_0123456789';
const NOW = new Date('2026-10-12T12:00:00Z');
const FIRST_PAGE = ALERTS_URL(REPOSITORY);
const FAR = '2027-03-05 00:00:00 UTC';

function alert(name: string, ghsa: string) {
  return {
    dependency: { package: { name } },
    security_advisory: { ghsa_id: ghsa },
    html_url: `https://github.com/${REPOSITORY}/security/dependabot/${ghsa}`,
  };
}

function page(body: unknown, headers: Record<string, string> = {}, status = 200): Answer {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { status, header: (name) => lower[name.toLowerCase()], body };
}

interface World {
  readonly auditCode?: number;
  readonly token?: string | undefined;
  readonly repository?: string | undefined;
  /** Answers by URL; a URL with no answer is a stand-in for a failed request. */
  readonly answers?: Readonly<Record<string, Answer>>;
}

async function run(world: World = {}) {
  const requested: string[] = [];
  const out: string[] = [];
  const env: Record<string, string | undefined> = {
    DEPENDABOT_ALERTS_TOKEN: 'token' in world ? world.token : TOKEN,
    GITHUB_REPOSITORY: 'repository' in world ? world.repository : REPOSITORY,
  };
  const answers = world.answers ?? {
    [FIRST_PAGE]: page([], { 'GitHub-Authentication-Token-Expiration': FAR }),
  };
  const dependencies: Dependencies = {
    env,
    audit: async () => world.auditCode ?? 0,
    request: async (url, token) => {
      requested.push(url);
      expect(token).toBe(TOKEN);
      const answer = answers[url];
      if (answer === undefined) throw new Error('connection refused');
      return answer;
    },
    now: () => NOW,
  };
  const code = await main(dependencies, { out: (text) => out.push(text) });
  const text = out.join('');
  return {
    code,
    text,
    requested,
    errors: text.split('\n').filter((line) => line.startsWith('::error::')),
    warnings: text.split('\n').filter((line) => line.startsWith('::warning::')),
  };
}

describe('the dependency-alerts gate (T160, R-SEC-12)', () => {
  it('passes when the audit is clean and no critical alert is open', async () => {
    const result = await run();
    expect(result.code).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.text).toContain('R-SEC-12: no open critical Dependabot alert');
    expect(result.requested).toEqual([FIRST_PAGE]);
  });

  it('runs the audit as pnpm audit --audit-level critical', () => {
    expect(AUDIT_COMMAND).toEqual(['pnpm', ['audit', '--audit-level', 'critical']]);
  });

  it('asks only for open critical alerts, a hundred to a page', () => {
    expect(FIRST_PAGE).toBe(
      `https://api.github.com/repos/${REPOSITORY}/dependabot/alerts?state=open&severity=critical&per_page=100`,
    );
  });

  it('fails on a critical advisory from the audit, and still reads the alerts', async () => {
    const result = await run({ auditCode: 1 });
    expect(result.code).toBe(1);
    expect(result.errors.join('\n')).toMatch(/R-SEC-12: pnpm audit found a critical advisory/);
    expect(result.requested).toEqual([FIRST_PAGE]);
  });

  it('fails on an open critical alert, naming its package, advisory and link', async () => {
    const result = await run({
      answers: {
        [FIRST_PAGE]: page([alert('lodash', 'GHSA-aaaa-bbbb-cccc')], {
          'GitHub-Authentication-Token-Expiration': FAR,
        }),
      },
    });
    expect(result.code).toBe(1);
    expect(result.errors).toContain(
      `::error::R-SEC-12: open critical Dependabot alert: lodash GHSA-aaaa-bbbb-cccc https://github.com/${REPOSITORY}/security/dependabot/GHSA-aaaa-bbbb-cccc`,
    );
    expect(result.text).toContain('R-SEC-12: 1 open critical Dependabot alert(s)');
  });

  it('follows the next link, so an alert on the second page is not missed', async () => {
    const second = `${FIRST_PAGE}&page=2`;
    const result = await run({
      answers: {
        [FIRST_PAGE]: page([alert('a', 'GHSA-1111-1111-1111')], {
          Link: `<${second}>; rel="next", <${second}>; rel="last"`,
          'GitHub-Authentication-Token-Expiration': FAR,
        }),
        [second]: page([alert('b', 'GHSA-2222-2222-2222')]),
      },
    });
    expect(result.code).toBe(1);
    expect(result.requested).toEqual([FIRST_PAGE, second]);
    expect(
      result.errors.filter((line) => line.includes('open critical Dependabot alert:')),
    ).toHaveLength(2);
  });

  it.each([
    ['empty', ''],
    ['not set', undefined],
  ])('fails closed when the token is %s, asking GitHub nothing', async (_case, token) => {
    const result = await run({ token });
    expect(result.code).toBe(1);
    expect(result.errors.join('\n')).toMatch(
      /R-SEC-12: the secret DEPENDABOT_ALERTS_TOKEN is empty/,
    );
    expect(result.requested).toEqual([]);
  });

  it('fails closed when the repository is not known', async () => {
    const result = await run({ repository: undefined });
    expect(result.code).toBe(1);
    expect(result.errors.join('\n')).toMatch(/R-SEC-12: GITHUB_REPOSITORY is not set/);
    expect(result.requested).toEqual([]);
  });

  it.each([401, 403, 404, 500])(
    'fails closed on an answer of %i, never reading it as zero alerts',
    async (status) => {
      const result = await run({
        answers: { [FIRST_PAGE]: page({ message: 'Resource not accessible' }, {}, status) },
      });
      expect(result.code).toBe(1);
      expect(result.errors.join('\n')).toContain(`answered ${status}`);
      expect(result.text).not.toContain('no open critical Dependabot alert');
    },
  );

  it('fails closed on an answer that is not a list of alerts', async () => {
    const result = await run({ answers: { [FIRST_PAGE]: page({ total_count: 0 }) } });
    expect(result.code).toBe(1);
    expect(result.errors.join('\n')).toMatch(/not a list of alerts/);
  });

  it('fails closed when no page arrives at all', async () => {
    const result = await run({ answers: {} });
    expect(result.code).toBe(1);
    expect(result.errors.join('\n')).toMatch(/no page/);
  });

  it('fails closed when a later page is missing, even after a clean first page', async () => {
    const second = `${FIRST_PAGE}&page=2`;
    const result = await run({
      answers: {
        [FIRST_PAGE]: page([], {
          Link: `<${second}>; rel="next"`,
          'GitHub-Authentication-Token-Expiration': FAR,
        }),
      },
    });
    expect(result.code).toBe(1);
    expect(result.errors.join('\n')).toMatch(/no page/);
  });

  it('warns and passes when the token expires in under fourteen days', async () => {
    const result = await run({
      answers: {
        [FIRST_PAGE]: page([], {
          'GitHub-Authentication-Token-Expiration': '2026-10-20 00:00:00 UTC',
        }),
      },
    });
    expect(result.code).toBe(0);
    expect(result.warnings.join('\n')).toMatch(
      /R-SEC-12: DEPENDABOT_ALERTS_TOKEN expires on 2026-10-20 00:00:00 UTC \(7 days left\)/,
    );
  });

  it('reads an expiry given with a numeric offset', async () => {
    const result = await run({
      answers: {
        [FIRST_PAGE]: page([], {
          'GitHub-Authentication-Token-Expiration': '2026-10-14 02:00:00 +0200',
        }),
      },
    });
    expect(result.code).toBe(0);
    expect(result.warnings.join('\n')).toMatch(/\(1 days left\)/);
  });

  it('says how long the token has left without warning when it is far off', async () => {
    const result = await run();
    expect(result.warnings).toEqual([]);
    expect(result.text).toContain(`DEPENDABOT_ALERTS_TOKEN expires on ${FAR} (143 days left)`);
  });

  it.each([
    ['no expiry header', {}, /returned no expiry date/],
    [
      'an expiry it cannot read',
      { 'GitHub-Authentication-Token-Expiration': 'soon' },
      /could not be read: soon/,
    ],
  ])('warns and passes on %s', async (_case, headers, warning) => {
    const result = await run({ answers: { [FIRST_PAGE]: page([], headers) } });
    expect(result.code).toBe(0);
    expect(result.warnings.join('\n')).toMatch(warning);
  });

  it('never prints the token', async () => {
    const results = await Promise.all([
      run(),
      run({ auditCode: 1 }),
      run({ answers: { [FIRST_PAGE]: page({}, {}, 403) } }),
    ]);
    for (const result of results) expect(result.text).not.toContain(TOKEN);
  });
});
