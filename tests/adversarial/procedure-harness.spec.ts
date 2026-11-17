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
// The registered attacks themselves run at the end, against the real router (`registered-attacks.ts`:
// `discovery`'s three since T028), and each runs only on a database (T124).
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
import { adminRouter } from '../../apps/api/src/surfaces/admin.router.js';
import { createAppContext, type UserSession } from '../../apps/api/src/surfaces/context.js';
import {
  adminProcedure,
  createAdminRouter,
  createAppCallerFactory,
  createAppRouter,
  publicProcedure,
  studentProcedure,
  teacherProcedure,
  userProcedure,
} from '../../apps/api/src/surfaces/procedures.js';
import {
  unusedBookingServices,
  unusedCatalogServices,
  unusedCertificationServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../apps/api/src/surfaces/services.fixtures.js';
import {
  ATTACK_KINDS,
  ATTACKED_ROUTERS,
  type AttackKind,
  attackCases,
  coverageFailures,
  DECLARED_LIMITS,
  declaredLimitFailures,
  describeProcedureAttacks,
  directions,
  type Exemption,
  exemptProcedures,
  expectAnswersAsNonexistent,
  notApplicable,
  type ProcedureAttacks,
  SESSION_ATTACK_KINDS,
  type SessionAttackKind,
  sessionKindFailures,
  type SessionProcedureAttacks,
  studentFacingProcedures,
} from './procedure-harness.js';
import { registeredAttacks } from './registered-attacks.js';

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
// T052 of specs/004-sessions: Phase 3's routers, FR-496's three kinds and the declared limits
// ---------------------------------------------------------------------------------------------

const anyQuery = () => query().query(() => []);

/** One procedure, `any`, under each namespace T052's line names, as the surface would mount it. */
const phaseThreeNamespaces: Readonly<Record<string, ReturnType<typeof createAppRouter>>> = {
  sessions: createAppRouter({ sessions: createAppRouter({ any: anyQuery() }) }),
  'sessions.cancellation': createAppRouter({
    sessions: createAppRouter({ cancellation: createAppRouter({ any: anyQuery() }) }),
  }),
  'sessions.remedy': createAppRouter({
    sessions: createAppRouter({ remedy: createAppRouter({ any: anyQuery() }) }),
  }),
  'sessions.dispute': createAppRouter({
    sessions: createAppRouter({ dispute: createAppRouter({ any: anyQuery() }) }),
  }),
  'sessions.complaint': createAppRouter({
    sessions: createAppRouter({ complaint: createAppRouter({ any: anyQuery() }) }),
  }),
  chat: createAppRouter({ chat: createAppRouter({ any: anyQuery() }) }),
  live: createAppRouter({ live: createAppRouter({ any: anyQuery() }) }),
};

describe('a procedure of sessions, chat or live is registered and never exempt (T052, FR-496)', () => {
  it.each(Object.keys(phaseThreeNamespaces))(
    'fails a procedure under %s that is exempt with a reason',
    (namespace) => {
      const path = `${namespace}.any`;
      const surface = phaseThreeNamespaces[namespace];
      expect(surface).toBeDefined();
      expect(studentFacingProcedures(surface!)).toEqual([path]);
      expect(coverageFailures([path], [], [{ path, reason: 'names no one' }])).toEqual([
        expect.stringMatching(
          new RegExp(`^${path.replaceAll('.', '\\.')}: .*never exempt.*FR-496`),
        ),
      ]);
    },
  );

  it.each(Object.keys(phaseThreeNamespaces))(
    'fails a procedure under %s that is not registered',
    (namespace) => {
      const path = `${namespace}.any`;
      expect(coverageFailures([path], [], [])).toEqual([
        expect.stringMatching(
          new RegExp(`^${path.replaceAll('.', '\\.')}: .*never exempt.*FR-496`),
        ),
      ]);
    },
  );

  /** One teacher-kind procedure, `teacherReads`, under each of the three routers (#142 r1, Major 1). */
  const teacherReads = () =>
    teacherProcedure({ admits: 'approved', input: emptyInput, output: subjectsListOutput }).query(
      () => [],
    );
  const teacherKindNamespaces: Readonly<Record<string, ReturnType<typeof createAppRouter>>> = {
    sessions: createAppRouter({ sessions: createAppRouter({ teacherReads: teacherReads() }) }),
    chat: createAppRouter({ chat: createAppRouter({ teacherReads: teacherReads() }) }),
    live: createAppRouter({ live: createAppRouter({ teacherReads: teacherReads() }) }),
  };

  it.each(Object.keys(teacherKindNamespaces))(
    'reads a teacher-kind procedure under %s and fails it while it is not registered',
    (namespace) => {
      const path = `${namespace}.teacherReads`;
      const surface = teacherKindNamespaces[namespace];
      expect(surface).toBeDefined();
      expect(studentFacingProcedures(surface!)).toEqual([path]);
      expect(coverageFailures(studentFacingProcedures(surface!), [], [])).toEqual([
        expect.stringMatching(
          new RegExp(`^${path.replaceAll('.', '\\.')}: .*never exempt.*FR-496`),
        ),
      ]);
    },
  );
});

/** The three kinds FR-496 names beyond FR-410's five, as T052's note writes them. */
const FR_496_KINDS = ['otherSessionToken', 'replayedToken', 'afterGenderCorrection'] as const;

/** A registration of `path` with every kind passing, but `omitted`. */
function registrationWithout(path: string, omitted?: SessionAttackKind): ProcedureAttacks {
  const attacks = Object.fromEntries(
    [...ATTACK_KINDS, ...FR_496_KINDS]
      .filter((kind) => kind !== omitted)
      .map((kind) => [kind, passing]),
  );
  return { path, holds: 'FR-496', attacks } as unknown as ProcedureAttacks;
}

const missingACorrection: SessionProcedureAttacks = {
  path: 'sessions.get',
  holds: 'FR-496',
  // @ts-expect-error -- T052: a Phase 3 registration names FR-496's three kinds, and `afterGenderCorrection` is missing
  attacks: {
    directCall: passing,
    forgedId: passing,
    guessedId: passing,
    tamperedToken: passing,
    clientSuppliedGender: passing,
    otherSessionToken: passing,
    replayedToken: passing,
  },
};

describe('a registration of sessions, chat or live gives FR-496’s three kinds (T052, Q2 (a))', () => {
  it('names the three kinds FR-496 adds to FR-410’s five', () => {
    expect([...SESSION_ATTACK_KINDS].sort()).toEqual([...FR_496_KINDS].sort());
    expect(Object.keys(missingACorrection.attacks)).not.toContain('afterGenderCorrection');
  });

  it('passes every registration of the user surface today', () => {
    expect(sessionKindFailures(registeredAttacks)).toEqual([]);
  });

  it.each(FR_496_KINDS)('fails a registration of sessions, chat or live missing %s', (kind) => {
    const paths = ['chat.send', 'live.events', 'sessions.get', 'sessions.remedy.accept'];
    expect(sessionKindFailures(paths.map((path) => registrationWithout(path, kind)))).toEqual(
      paths.map((path) =>
        expect.stringMatching(new RegExp(`^${path.replaceAll('.', '\\.')}: .*${kind}.*FR-496`)),
      ),
    );
  });

  it('fails one of the three marked not applicable without a reason', () => {
    const registration = {
      ...registrationWithout('chat.list'),
      attacks: { ...registrationWithout('chat.list').attacks, replayedToken: notApplicable(' ') },
    } as ProcedureAttacks;
    expect(sessionKindFailures([registration])).toEqual([
      expect.stringMatching(/^chat\.list: .*replayedToken.*reason/),
    ]);
    expect(() => attackCases([registration])).toThrow(/chat\.list.*replayedToken.*reason/);
  });

  it('leaves Phase 2’s registrations with FR-410’s five', () => {
    const phaseTwo = registrationWithout('discovery.browse');
    const five = Object.fromEntries(ATTACK_KINDS.map((kind) => [kind, passing]));
    const registration = { ...phaseTwo, attacks: five } as unknown as ProcedureAttacks;
    expect(sessionKindFailures([registration])).toEqual([]);
    expect(attackCases([registration])).toHaveLength(ATTACK_KINDS.length * 2);
  });

  it('runs each of the three once per direction', async () => {
    const ran: string[] = [];
    const recording = (kind: string) => async (direction: { requester: string }) => {
      ran.push(`${kind}:${direction.requester}`);
    };
    const registration = {
      path: 'sessions.join',
      holds: 'FR-496',
      attacks: Object.fromEntries(
        [...ATTACK_KINDS, ...FR_496_KINDS].map((kind) => [kind, recording(kind)]),
      ),
    } as unknown as SessionProcedureAttacks;
    const cases = attackCases([registration]);
    expect(cases).toHaveLength((ATTACK_KINDS.length + FR_496_KINDS.length) * 2);
    for (const attackCase of cases) await attackCase.run();
    for (const kind of FR_496_KINDS) {
      expect(ran.filter((entry) => entry.startsWith(`${kind}:`)).sort()).toEqual([
        `${kind}:female`,
        `${kind}:male`,
      ]);
    }
  });
});

/** A user-kind and an administrator-kind fixture, each stamped (or not) as named. */
const limitFixture = createAppRouter({
  stamped: userProcedure({
    input: emptyInput,
    output: subjectsListOutput,
    rateLimit: { key: 'rate_limit_live_channel', subject: 'caller' },
  }).query(() => []),
  unstamped: userProcedure({ input: emptyInput, output: subjectsListOutput }).query(() => []),
});

const adminLimitFixture = createAdminRouter({
  stamped: adminProcedure({
    input: emptyInput,
    output: subjectsListOutput,
    rateLimit: { key: 'rate_limit_enrollment_restore', subject: 'caller' },
  }).query(() => []),
});

describe('every limit T052 names is stamped in the real routers’ meta (T052, G1, G4, Q-R16 (a))', () => {
  it('reads each user kind’s declared key from `appRouter`', () => {
    expect(declaredLimitFailures(appRouter, DECLARED_LIMITS.app)).toEqual([]);
  });

  it('reads each administrator kind’s declared key from `adminRouter` (`AdminMeta.rateLimit`)', () => {
    expect(declaredLimitFailures(adminRouter, DECLARED_LIMITS.admin)).toEqual([]);
  });

  it('fails a procedure that lost its key', () => {
    expect(
      declaredLimitFailures(limitFixture, [
        { path: 'unstamped', key: 'rate_limit_live_channel', source: 'a fixture' },
      ]),
    ).toEqual([expect.stringMatching(/^unstamped: declares no limit.*rate_limit_live_channel/)]);
  });

  it('fails a procedure stamped with another key', () => {
    expect(
      declaredLimitFailures(limitFixture, [
        { path: 'stamped', key: 'rate_limit_absence_complaint', source: 'a fixture' },
      ]),
    ).toEqual([
      expect.stringMatching(
        /^stamped: declares rate_limit_live_channel.*rate_limit_absence_complaint/,
      ),
    ]);
  });

  it('fails an administrator procedure stamped with another key', () => {
    expect(
      declaredLimitFailures(adminLimitFixture, [
        { path: 'stamped', key: 'rate_limit_enrollment_end', source: 'a fixture' },
      ]),
    ).toEqual([
      expect.stringMatching(
        /^stamped: declares rate_limit_enrollment_restore.*rate_limit_enrollment_end/,
      ),
    ]);
  });

  it('fails a named procedure the surface does not have', () => {
    expect(
      declaredLimitFailures(limitFixture, [
        { path: 'gone', key: 'rate_limit_live_channel', source: 'a fixture' },
      ]),
    ).toEqual([expect.stringMatching(/^gone: not a procedure of the surface/)]);
  });

  it('passes the fixture’s stamped procedure', () => {
    expect(
      declaredLimitFailures(limitFixture, [
        { path: 'stamped', key: 'rate_limit_live_channel', source: 'a fixture' },
      ]),
    ).toEqual([]);
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
    // Every signed-in call is counted by the signed-in default since T062 (FR-470), whose row this
    // limiter reads; nothing else here reads a setting.
    rateLimiter: new RateLimiter({
      settings: { read: async (_key, schema) => schema.parse({ limit: 1_000, window_seconds: 60 }) },
      counter,
      subjectKey: Buffer.alloc(32, 1),
    }),
    clientAddress: '203.0.113.7',
    services: {
      settings,
      publicConfig: { supportEmail: 'support@ijazah.invalid' },
      subjects: { listActive: async () => [] },
      identity: unusedIdentityServices,
      verification: unusedVerificationServices,
      catalog: unusedCatalogServices,
      teacherProfile: unusedTeacherProfileServices,
      discovery: unusedDiscoveryServices,
      booking: unusedBookingServices,
      checkout: unusedCheckoutServices,
      sessions: unusedSessionsServices,
      chat: unusedChatServices,
      certification: unusedCertificationServices,
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
