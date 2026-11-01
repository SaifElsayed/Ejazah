// T011 — the adversarial procedure harness, proven before any procedure it attacks exists (R-202,
// FR-410, SC-304; analysis U1).
//
// Three things are shown here. COVERAGE: the user surface's student-facing procedures are read from
// the real `appRouter`, and today each is registered or exempt with its reason; fixture routers built
// with the real caller kinds show the check failing a procedure of the `discovery`, `booking`,
// `checkout` or `enrollments` routers that is not registered (an exemption does not count there),
// and a later procedure anywhere else that is neither registered nor exempt. DIRECTIONS: a
// registration names every attack kind (a missing one does not compile) and each attack runs once
// per direction, a male and a female requester. NOT FOUND IS ONE SHAPE: through an in-process
// caller, a hidden profile passes as a nonexistent one, and a 403, another message, a field in the
// body or an answer instead of a refusal are each caught.
//
// The registered attacks themselves run at the end, against the real router; none is registered
// until `discovery` lands (T028), and each runs only on a database (T124).
import { $Enums } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { emptyInput, subjectsListOutput } from '../../packages/contracts/src/index.js';
import {
  DomainError,
  ForbiddenProfileError,
} from '../../apps/api/src/platform/errors/domain-error.js';
import {
  type RateLimitCounter,
  RateLimiter,
} from '../../apps/api/src/platform/guards/rate-limit.guard.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import { appRouter } from '../../apps/api/src/surfaces/app.router.js';
import { createAppContext, type UserSession } from '../../apps/api/src/surfaces/context.js';
import {
  createAppCallerFactory,
  createAppRouter,
  publicProcedure,
  studentProcedure,
  teacherProcedure,
  userProcedure,
} from '../../apps/api/src/surfaces/procedures.js';
import {
  unusedIdentityServices,
  unusedVerificationServices,
} from '../../apps/api/src/surfaces/services.fixtures.js';
import {
  ATTACK_KINDS,
  ATTACKED_ROUTERS,
  type AttackKind,
  attackCases,
  coverageFailures,
  describeProcedureAttacks,
  directions,
  type Exemption,
  exemptProcedures,
  expectAnswersAsNonexistent,
  notApplicable,
  type ProcedureAttacks,
  registeredAttacks,
  studentFacingProcedures,
} from './procedure-harness.js';

const anyone = { key: 'rate_limit_search', subjectOf: () => 'anyone' } as const;

const query = () => studentProcedure({ input: emptyInput, output: subjectsListOutput });

/** One procedure of each caller kind, under the four routers, a Phase 1 namespace and a later one. */
const fixture = createAppRouter({
  discovery: createAppRouter({
    browse: query().query(() => []),
    filters: publicProcedure({
      input: emptyInput,
      output: subjectsListOutput,
      rateLimit: anyone,
    }).query(() => []),
  }),
  checkout: createAppRouter({ hold: query().mutation(() => []) }),
  account: createAppRouter({
    me: userProcedure({ input: emptyInput, output: subjectsListOutput }).query(() => []),
  }),
  reviews: createAppRouter({ write: query().mutation(() => []) }),
  teacher: createAppRouter({
    slots: teacherProcedure({
      admits: 'publishable',
      input: emptyInput,
      output: subjectsListOutput,
    }).query(() => []),
  }),
});

const fixtureExempt: readonly Exemption[] = [
  { path: 'account.me', reason: 'the caller’s own account' },
  { path: 'reviews.write', reason: 'a fixture: names no teacher' },
];

const registeredPaths = registeredAttacks.map((registration) => registration.path);

describe('which procedures the harness reads (T011)', () => {
  it('reads every procedure of a caller kind a student can reach, and no teacher one', () => {
    expect(studentFacingProcedures(fixture)).toEqual([
      'account.me',
      'checkout.hold',
      'discovery.browse',
      'discovery.filters',
      'reviews.write',
    ]);
  });

  it('reads the user surface’s student-facing procedures, each with its caller kind a student reaches', () => {
    const read = studentFacingProcedures(appRouter);
    expect(read).toContain('account.me');
    expect(read).toContain('catalog.subjects.list');
    expect(read.filter((path) => path.startsWith('teacher.'))).toEqual([]);
  });
});

describe('every student-facing procedure is registered or exempt with its reason (FR-410, analysis U1)', () => {
  it('passes the user surface today', () => {
    expect(
      coverageFailures(studentFacingProcedures(appRouter), registeredPaths, exemptProcedures),
    ).toEqual([]);
  });

  it('gives every exemption a reason of its own', () => {
    for (const { path, reason } of exemptProcedures) {
      expect(reason.trim(), path).not.toBe('');
    }
  });

  it('fails each procedure of the four routers that is not registered, a public one included', () => {
    const failures = coverageFailures(studentFacingProcedures(fixture), [], fixtureExempt);
    expect(failures).toHaveLength(3);
    for (const path of ['checkout.hold', 'discovery.browse', 'discovery.filters']) {
      expect(failures.some((failure) => failure.startsWith(`${path}:`))).toBe(true);
    }
    for (const failure of failures) expect(failure).toContain('FR-410');
  });

  it.each(ATTACKED_ROUTERS)('fails an unregistered procedure of the %s router', (router) => {
    const one = createAppRouter({ [router]: createAppRouter({ any: query().query(() => []) }) });
    expect(coverageFailures(studentFacingProcedures(one), [], [])).toEqual([
      expect.stringMatching(new RegExp(`^${router}\\.any: .*FR-410`)),
    ]);
  });

  it('never accepts an exemption for a procedure of the four routers', () => {
    const failures = coverageFailures(
      ['discovery.browse'],
      [],
      [{ path: 'discovery.browse', reason: 'returns nothing' }],
    );
    expect(failures).toEqual([expect.stringMatching(/^discovery\.browse: .*never exempt/)]);
  });

  it('fails a later procedure elsewhere that is neither registered nor exempt', () => {
    const failures = coverageFailures(
      studentFacingProcedures(fixture),
      ['checkout.hold', 'discovery.browse', 'discovery.filters'],
      [{ path: 'account.me', reason: 'the caller’s own account' }],
    );
    expect(failures).toEqual([
      expect.stringMatching(/^reviews\.write: neither registered nor exempt/),
    ]);
  });

  it('passes the fixture once the four routers’ procedures are registered and the rest exempt', () => {
    expect(
      coverageFailures(
        studentFacingProcedures(fixture),
        ['checkout.hold', 'discovery.browse', 'discovery.filters'],
        fixtureExempt,
      ),
    ).toEqual([]);
  });

  it('passes a later procedure elsewhere once it is registered', () => {
    expect(
      coverageFailures(
        studentFacingProcedures(fixture),
        ['checkout.hold', 'discovery.browse', 'discovery.filters', 'reviews.write'],
        [{ path: 'account.me', reason: 'the caller’s own account' }],
      ),
    ).toEqual([]);
  });

  it('fails an exemption without a reason', () => {
    expect(coverageFailures(['account.me'], [], [{ path: 'account.me', reason: ' ' }])).toEqual([
      expect.stringMatching(/^account\.me: exempt without a reason/),
    ]);
  });

  it('fails a procedure both registered and exempt', () => {
    expect(
      coverageFailures(
        ['reviews.write'],
        ['reviews.write'],
        [{ path: 'reviews.write', reason: 'x' }],
      ),
    ).toEqual([expect.stringMatching(/^reviews\.write: both registered and exempt/)]);
  });

  it('fails an entry that names no student-facing procedure, a teacher one included', () => {
    expect(
      coverageFailures(
        studentFacingProcedures(fixture),
        ['checkout.hold', 'discovery.browse', 'discovery.filters', 'discovery.gone'],
        [...fixtureExempt, { path: 'teacher.slots', reason: 'a teacher’s own slots' }],
      ),
    ).toEqual([
      expect.stringMatching(/^discovery\.gone: listed by the harness but/),
      expect.stringMatching(/^teacher\.slots: listed by the harness but/),
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Directions and attack kinds
// ---------------------------------------------------------------------------------------------

const passing = async () => undefined;

const missingAKind: ProcedureAttacks = {
  path: 'discovery.teacher',
  holds: 'R-GENDER-2',
  // @ts-expect-error -- T011: a registration names every attack kind, and `tamperedToken` is missing
  attacks: {
    directCall: passing,
    forgedId: passing,
    guessedId: passing,
    clientSuppliedGender: passing,
  },
};

describe('each attack runs in both directions (FR-410, FR-064)', () => {
  it('has the two directions, one per gender, each against the other', () => {
    expect(Object.values($Enums.Gender).sort()).toEqual(['female', 'male']);
    expect(directions.map((direction) => direction.requester).sort()).toEqual(['female', 'male']);
    for (const direction of directions) expect(direction.other).not.toBe(direction.requester);
  });

  it('names the five attacks of FR-410', () => {
    expect([...ATTACK_KINDS].sort()).toEqual(
      ['clientSuppliedGender', 'directCall', 'forgedId', 'guessedId', 'tamperedToken'].sort(),
    );
    expect(Object.keys(missingAKind.attacks)).not.toContain('tamperedToken');
  });

  it('runs every attack of a registration once per direction, with that direction', async () => {
    const ran: string[] = [];
    const recording = (kind: AttackKind) => async (direction: { requester: string }) => {
      ran.push(`${kind}:${direction.requester}`);
    };
    const registration: ProcedureAttacks = {
      path: 'discovery.teacher',
      holds: 'R-GENDER-2',
      attacks: {
        directCall: recording('directCall'),
        forgedId: recording('forgedId'),
        guessedId: recording('guessedId'),
        tamperedToken: recording('tamperedToken'),
        clientSuppliedGender: recording('clientSuppliedGender'),
      },
    };
    const cases = attackCases([registration]);
    expect(cases).toHaveLength(ATTACK_KINDS.length * 2);
    for (const attackCase of cases) await attackCase.run();
    expect(ran.sort()).toEqual(
      ATTACK_KINDS.flatMap((kind) => [`${kind}:female`, `${kind}:male`]).sort(),
    );
    for (const attackCase of cases) {
      expect(attackCase.title).toContain('discovery.teacher');
      expect(attackCase.title).toContain(attackCase.direction.name);
    }
  });

  it('runs no case for an attack registered as not applicable, in either direction', () => {
    const cases = attackCases([
      {
        path: 'discovery.filters',
        holds: 'R-GENDER-3',
        attacks: {
          directCall: passing,
          forgedId: notApplicable('takes no id'),
          guessedId: notApplicable('takes no id'),
          tamperedToken: passing,
          clientSuppliedGender: passing,
        },
      },
    ]);
    expect(cases.map((attackCase) => attackCase.kind).sort()).toEqual([
      'clientSuppliedGender',
      'clientSuppliedGender',
      'directCall',
      'directCall',
      'tamperedToken',
      'tamperedToken',
    ]);
  });

  it('refuses an attack marked not applicable without a reason', () => {
    expect(() =>
      attackCases([
        {
          path: 'discovery.filters',
          holds: 'R-GENDER-3',
          attacks: {
            directCall: passing,
            forgedId: notApplicable(''),
            guessedId: passing,
            tamperedToken: passing,
            clientSuppliedGender: passing,
          },
        },
      ]),
    ).toThrow(/discovery\.filters.*forgedId.*reason/);
  });
});

// ---------------------------------------------------------------------------------------------
// An excluded teacher answers exactly as a nonexistent one
// ---------------------------------------------------------------------------------------------

const student: UserSession = {
  userId: 'student-1',
  sessionId: 'session-1',
  role: 'student',
  accountStatus: 'active',
  gender: 'female',
  preferredLanguage: 'en',
};

const settings: SettingsReader = {
  read: async () => {
    throw new Error('no setting is read here');
  },
};
const counter: RateLimitCounter = { hit: async () => 1 };

const caller = createAppCallerFactory(
  createAppRouter({
    absent: query().query(() => {
      throw new DomainError('NOT_FOUND');
    }),
    hidden: query().query(() => {
      throw new ForbiddenProfileError();
    }),
    forbidden: query().query(() => {
      throw new DomainError('FORBIDDEN');
    }),
    worded: query().query(() => {
      throw new DomainError('NOT_FOUND', 'No such teacher.');
    }),
    detailed: query().query(() => {
      throw new DomainError('NOT_FOUND', undefined, {
        details: [{ path: 'teacherId', code: 'excluded' }],
      });
    }),
    answers: query().query(() => []),
  }),
)(
  createAppContext({
    session: student,
    log: createLogger({ level: 'fatal' }),
    rateLimiter: new RateLimiter({ settings, counter, subjectKey: Buffer.alloc(32, 1) }),
    clientAddress: '203.0.113.7',
    services: {
      settings,
      publicConfig: { supportEmail: 'support@ijazah.invalid' },
      subjects: { listActive: async () => [] },
      identity: unusedIdentityServices,
      verification: unusedVerificationServices,
    },
  }),
);

const absent = () => caller.absent({});

describe('an excluded teacher answers exactly as a nonexistent one: 404 and no field (R-GENDER-2)', () => {
  it('passes a hidden profile, which the filter answers as an absent one', async () => {
    await expectAnswersAsNonexistent(() => caller.hidden({}), absent);
  });

  it('fails a 403', async () => {
    await expect(expectAnswersAsNonexistent(() => caller.forbidden({}), absent)).rejects.toThrow();
  });

  it('fails another message', async () => {
    await expect(expectAnswersAsNonexistent(() => caller.worded({}), absent)).rejects.toThrow();
  });

  it('fails a body that carries a field', async () => {
    await expect(expectAnswersAsNonexistent(() => caller.detailed({}), absent)).rejects.toThrow();
  });

  it('fails an answer where the nonexistent id is refused', async () => {
    await expect(expectAnswersAsNonexistent(() => caller.answers({}), absent)).rejects.toThrow();
  });

  it('fails when the nonexistent id itself is not answered 404', async () => {
    const forbidden = () => caller.forbidden({});
    await expect(expectAnswersAsNonexistent(forbidden, forbidden)).rejects.toThrow();
  });
});

// The registered attacks, against the real router, both directions (T028, T043 register theirs).
describeProcedureAttacks(registeredAttacks);
