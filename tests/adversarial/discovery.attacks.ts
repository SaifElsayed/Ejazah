// T028 — the `discovery` procedures' attacks, registered with T011's harness (FR-410, SC-304;
// FR-330 to FR-336; FR-315, US1 scenario 8, analysis G2; R-GENDER-1, R-GENDER-2, R-GENDER-3,
// R-GENDER-4, R-GENDER-5).
//
// Each of `discovery.browse`, `discovery.filters` and `discovery.teacher` registers FR-410's five
// attacks, each run by the harness once per direction against the real user surface and the real
// discovery services (`discovery-world.ts`): a male requester against female teachers and a female
// requester against male teachers, each also against the own gender's teachers in every excluded
// state. What every attack holds, for every teacher the requester may not see: absent from the cards
// and from anything else serialized, counted in no subject tab nor in the tab of all subjects,
// contributing no riwaya to `discovery.filters`, and answered by `discovery.teacher` exactly as an id
// that never existed (404, `NOT_FOUND`, no field). A visible control is present in every exact
// answer, so no attack passes on an empty one.
//
//   directCall            the procedure as the phone calls it: browse's tabs, counts, track,
//                         minimum-rating and riwaya filters and search; the filter's riwayas; every
//                         teacher's profile; and a teacher whose payout account was replaced is absent
//                         until the gateway's signed `recipient_verified` arrives (FR-315).
//   forgedId              ids and values lifted from excluded teachers: their own ids, their private
//                         subjects, their riwayas, and a cursor written at an excluded teacher's keys.
//   guessedId             ids never handed out: random ones, an excluded id's neighbour and its
//                         upper-case spelling.
//   tamperedToken         the requester's genuine bearer token with its signature or its session
//                         changed: refused as unauthenticated before any service is reached.
//   clientSuppliedGender  the input carrying the other gender: ignored, the answer the session's.
import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import { mapError, type MappedError } from '../../apps/api/src/platform/errors/error-filter.js';
import { toErrorShape } from '../../apps/api/src/surfaces/procedures.js';
import {
  type DiscoveryBrowseInput,
  type DiscoveryBrowseOutput,
  discoveryCursor,
  type DiscoveryFiltersInput,
  type DiscoveryTeacherInput,
} from '../../packages/contracts/src/index.js';
import {
  type AppCaller,
  COMMON_RIWAYA,
  discoverySurface,
  excludedFrom,
  isVisibleRole,
  OTHER_RIWAYA,
  PLAIN_NAME,
  type SeededTeacher,
  tabCount,
  visibleTo,
  WORLD_RATING,
  WORLD_REVIEW_COUNT,
} from './discovery-world.js';
import {
  type Direction,
  expectAnswersAsNonexistent,
  type ProcedureAttacks,
} from './procedure-harness.js';

/** How often the tab of all subjects is read before the database is called unsettled. */
const STABLE_READ_ATTEMPTS = 5;
/** A review count above any teacher's: a cursor written before every row. */
const ABOVE_EVERY_COUNT = 1_000_000;
const TOP_RATING = '5';
const LOWEST_UUID = '00000000-0000-0000-0000-000000000000';

const ids = (teachers: readonly { readonly id: string }[]) => teachers.map(({ id }) => id).sort();

const cardIds = (answer: DiscoveryBrowseOutput) =>
  answer.cards.map(({ teacherId }) => teacherId).sort();

/** The riwayas visible teachers hold too, so an answer may carry them. */
const SHOWN_RIWAYAS: ReadonlySet<string> = new Set([COMMON_RIWAYA, OTHER_RIWAYA]);

/**
 * Nothing of an excluded teacher anywhere in an answer: its id, and where no visible teacher holds
 * the same, its name and its riwaya (the other gender's visible teachers bear the visible names).
 */
function expectNothingOf(answer: unknown, excluded: readonly SeededTeacher[]): void {
  const serialized = JSON.stringify(answer);
  for (const teacher of excluded) {
    const which = `${teacher.gender} ${teacher.state}`;
    expect(serialized, `${which}: its id`).not.toContain(teacher.id);
    if (!isVisibleRole(teacher.state)) {
      expect(serialized, `${which}: its name`).not.toContain(`"${teacher.displayName}"`);
    }
    if (!SHOWN_RIWAYAS.has(teacher.sharedRiwaya)) {
      expect(serialized, `${which}: its riwaya`).not.toContain(teacher.sharedRiwaya);
    }
  }
}

/** A refused call's status and body through the surface's one formatter; throws if it answered. */
async function refusalOf(call: () => Promise<unknown>): Promise<MappedError> {
  try {
    await call();
  } catch (error) {
    return error instanceof Error && error.name === 'TRPCError'
      ? toErrorShape(error as Parameters<typeof toErrorShape>[0])
      : mapError(error);
  }
  throw new Error('the call answered where it must be refused');
}

/** Refused before any service: 401, `UNAUTHENTICATED`, no field. */
async function expectUnauthenticated(call: () => Promise<unknown>): Promise<void> {
  const refusal = await refusalOf(call);
  expect(refusal.status).toBe(401);
  expect(refusal.body.code).toBe('UNAUTHENTICATED');
  expect(Object.keys(refusal.body).sort()).toEqual(['code', 'message']);
}

/** A cursor as the server writes one (R-204), here written by the client at chosen keys. */
function forgedCursor(keys: readonly [string | null, number, string, string]) {
  return discoveryCursor.parse(Buffer.from(JSON.stringify(keys), 'utf8').toString('base64url'));
}

/** The uuid one above `id`: a guess at a neighbour of a real row. */
function neighbourOf(id: string): string {
  const hex = (BigInt(`0x${id.replaceAll('-', '')}`) + 1n).toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The requester's genuine bearer with its signature changed, with the other gender's student's
 * session in place of its own, and with the other gender appended as a claim: the server's token
 * names a session and never a gender, so each is refused by the resolver.
 */
function tamperedTokens(direction: Direction, own: string, otherSession: string): string[] {
  const last = own.at(-1) === 'A' ? 'B' : 'A';
  return [
    `${own.slice(0, -1)}${last}`,
    own.replace(/^(v1\.)[^.]+/, `$1${otherSession}`),
    `${own}.${direction.other}`,
  ];
}

async function surfaceFor(direction: Direction) {
  const surface = await discoverySurface();
  const { world } = surface;
  return {
    surface,
    world,
    caller: surface.student(direction.requester).caller,
    visible: visibleTo(world, direction.requester),
    excluded: excludedFrom(world, direction.requester),
  };
}

/**
 * The tab of all subjects counts the visible teachers with an active package and no one else
 * (FR-332, R-GENDER-3). Other specs commit teachers meanwhile, so the answer is compared with the
 * predicate counted in SQL just before and just after it, and read again until the two agree.
 */
async function expectAllTabCountsTheVisible(
  caller: AppCaller,
  count: () => Promise<number>,
  excluded: readonly SeededTeacher[],
): Promise<void> {
  for (let attempt = 1; attempt <= STABLE_READ_ATTEMPTS; attempt += 1) {
    const before = await count();
    const answer = await caller.discovery.browse({});
    const after = await count();
    expectNothingOf(answer, excluded);
    if (before === after) {
      expect(tabCount(answer, null), 'the tab of all subjects').toBe(before);
      return;
    }
  }
  throw new Error(`the database did not settle in ${String(STABLE_READ_ATTEMPTS)} reads`);
}

/**
 * FR-315, US1 scenario 8, analysis G2: a visible teacher who replaces the payout account is absent
 * from the procedure's answer (`check` says whether present) until the gateway's signed
 * `recipient_verified` for the new account arrives (SC-302: sent by the stand-in's harness over
 * HTTP to the real webhook), then present again.
 */
async function expectHiddenUntilRecipientVerified(
  direction: Direction,
  check: (caller: AppCaller, teacher: SeededTeacher, subjectId: string) => Promise<boolean>,
): Promise<void> {
  const surface = await discoverySurface();
  const { caller } = surface.student(direction.requester);
  const { teacher, subject } = await surface.loneTeacher(direction.requester);
  expect(await check(caller, teacher, subject.id), 'verified: present').toBe(true);

  const replacement = await surface.replacePayout(teacher.id);
  expect(await check(caller, teacher, subject.id), 'replaced: absent').toBe(false);

  expect(await replacement.verify(), 'the webhook takes the signed event').toBe(200);
  expect(await check(caller, teacher, subject.id), 'verified again: present').toBe(true);
}

// ---------------------------------------------------------------------------------------------
// discovery.browse
// ---------------------------------------------------------------------------------------------

const browse: ProcedureAttacks = {
  path: 'discovery.browse',
  holds: 'R-GENDER-1, R-GENDER-3, R-GENDER-5, FR-332 to FR-335, FR-315',
  attacks: {
    async directCall(direction) {
      const { surface, world, caller, visible, excluded } = await surfaceFor(direction);

      await expectHiddenUntilRecipientVerified(direction, async (as, teacher, subjectId) => {
        const answer = await as.discovery.browse({ subjectId });
        const present = cardIds(answer).includes(teacher.id);
        expect(tabCount(answer, subjectId)).toBe(present ? 1 : 0);
        if (!present) expect(JSON.stringify(answer)).not.toContain(teacher.id);
        return present;
      });

      const tab = await caller.discovery.browse({ subjectId: world.shared.id });
      expect(cardIds(tab), 'the shared subject’s cards').toEqual(ids(visible));
      expect(tabCount(tab, world.shared.id), 'the shared subject’s tab').toBe(visible.length);
      for (const teacher of world.teachers) {
        const expected = visible.includes(teacher) ? 1 : 0;
        expect(tabCount(tab, teacher.privateSubject.id), `${teacher.gender} ${teacher.state}`).toBe(
          expected,
        );
      }
      expectNothingOf(tab, excluded);
      await expectAllTabCountsTheVisible(
        caller,
        () => surface.allTabCount(direction.requester),
        excluded,
      );

      const filtered: DiscoveryBrowseInput[] = [
        { subjectId: world.shared.id, track: 'recitation' },
        { subjectId: world.shared.id, track: 'ijazah_track' },
        { subjectId: world.shared.id, minRating: Math.floor(Number(WORLD_RATING)) },
      ];
      for (const input of filtered) {
        const answer = await caller.discovery.browse(input);
        expect(cardIds(answer), JSON.stringify(input)).toEqual(ids(visible));
        expectNothingOf(answer, excluded);
      }

      const byRiwaya = await caller.discovery.browse({
        subjectId: world.shared.id,
        riwaya: COMMON_RIWAYA,
      });
      expect(cardIds(byRiwaya)).toEqual(
        ids(visible.filter((teacher) => teacher.sharedRiwaya === COMMON_RIWAYA)),
      );
      expectNothingOf(byRiwaya, excluded);
      expectNothingOf(await caller.discovery.browse({ riwaya: COMMON_RIWAYA }), excluded);

      const searched = await caller.discovery.browse({
        subjectId: world.shared.id,
        query: PLAIN_NAME,
      });
      expect(cardIds(searched), 'the search inside the shared subject').toEqual(
        ids(visible.filter((teacher) => teacher.state !== 'otherName')),
      );
      expectNothingOf(searched, excluded);
      expectNothingOf(await caller.discovery.browse({ query: PLAIN_NAME }), excluded);
    },

    async forgedId(direction) {
      const { world, caller, visible, excluded } = await surfaceFor(direction);
      for (const teacher of excluded) {
        const own = await caller.discovery.browse({ subjectId: teacher.privateSubject.id });
        expect(cardIds(own), `${teacher.gender} ${teacher.state}: its private subject`).toEqual([]);
        expect(tabCount(own, teacher.privateSubject.id)).toBe(0);
        expectNothingOf(own, excluded);

        const ownRiwaya = await caller.discovery.browse({
          subjectId: world.shared.id,
          riwaya: teacher.sharedRiwaya,
        });
        expect(cardIds(ownRiwaya), `${teacher.gender} ${teacher.state}: its riwaya`).toEqual(
          ids(visible.filter((one) => one.sharedRiwaya === teacher.sharedRiwaya)),
        );
        expectNothingOf(ownRiwaya, excluded);

        // A cursor written at the excluded teacher's own keys moves only where the page starts.
        const after = await caller.discovery.browse({
          subjectId: world.shared.id,
          cursor: forgedCursor([WORLD_RATING, WORLD_REVIEW_COUNT, teacher.displayName, teacher.id]),
        });
        expect(ids(visible)).toEqual(expect.arrayContaining(cardIds(after)));
        expectNothingOf(after, excluded);
      }
      const fromTheTop = await caller.discovery.browse({
        subjectId: world.shared.id,
        cursor: forgedCursor([TOP_RATING, ABOVE_EVERY_COUNT, '', LOWEST_UUID]),
      });
      expect(cardIds(fromTheTop), 'a cursor before every row').toEqual(ids(visible));
      expectNothingOf(fromTheTop, excluded);
    },

    async guessedId(direction) {
      const { caller, excluded } = await surfaceFor(direction);
      const guesses = [
        randomUUID(),
        ...excluded.map((teacher) => neighbourOf(teacher.privateSubject.id)),
      ];
      for (const subjectId of guesses) {
        const answer = await caller.discovery.browse({ subjectId });
        expect(answer.cards, subjectId).toEqual([]);
        expectNothingOf(answer, excluded);
      }
    },

    async tamperedToken(direction) {
      const { surface, world } = await surfaceFor(direction);
      const own = surface.student(direction.requester);
      const other = surface.student(direction.other);
      for (const token of tamperedTokens(direction, own.accessToken, other.sessionId)) {
        const tampered = await surface.bearing(token);
        await expectUnauthenticated(() =>
          tampered.discovery.browse({ subjectId: world.shared.id }),
        );
      }
      const genuine = await surface.bearing(own.accessToken);
      expect(cardIds(await genuine.discovery.browse({ subjectId: world.shared.id }))).toEqual(
        ids(visibleTo(world, direction.requester)),
      );
    },

    async clientSuppliedGender(direction) {
      const { world, caller, visible, excluded } = await surfaceFor(direction);
      const input = {
        subjectId: world.shared.id,
        gender: direction.other,
        requesterGender: direction.other,
        requester: { gender: direction.other },
      } as DiscoveryBrowseInput;
      const answer = await caller.discovery.browse(input);
      expect(cardIds(answer)).toEqual(ids(visible));
      expect(tabCount(answer, world.shared.id)).toBe(visible.length);
      expectNothingOf(answer, excluded);
    },
  },
};

// ---------------------------------------------------------------------------------------------
// discovery.filters
// ---------------------------------------------------------------------------------------------

const riwayasOf = (teachers: readonly SeededTeacher[]) =>
  [...new Set(teachers.map(({ sharedRiwaya }) => sharedRiwaya))].sort();

const filters: ProcedureAttacks = {
  path: 'discovery.filters',
  holds: 'R-GENDER-1, R-GENDER-3, R-GENDER-5, FR-334, FR-315',
  attacks: {
    async directCall(direction) {
      const { world, caller, visible, excluded } = await surfaceFor(direction);

      await expectHiddenUntilRecipientVerified(direction, async (as, teacher, subjectId) => {
        const { riwayas } = await as.discovery.filters({ subjectId });
        return riwayas.includes(teacher.sharedRiwaya);
      });

      const answer = await caller.discovery.filters({ subjectId: world.shared.id });
      expect([...answer.riwayas].sort(), 'the visible teachers’ riwayas alone').toEqual(
        riwayasOf(visible),
      );
      expectNothingOf(answer, excluded);
      for (const teacher of visible) {
        expect(
          (await caller.discovery.filters({ subjectId: teacher.privateSubject.id })).riwayas,
        ).toEqual([COMMON_RIWAYA]);
      }
    },

    async forgedId(direction) {
      const { caller, excluded } = await surfaceFor(direction);
      for (const teacher of excluded) {
        const answer = await caller.discovery.filters({ subjectId: teacher.privateSubject.id });
        expect(answer.riwayas, `${teacher.gender} ${teacher.state}: its private subject`).toEqual(
          [],
        );
      }
    },

    async guessedId(direction) {
      const { caller, excluded } = await surfaceFor(direction);
      const guesses = [
        randomUUID(),
        ...excluded.map((teacher) => neighbourOf(teacher.privateSubject.id)),
      ];
      for (const subjectId of guesses) {
        expect((await caller.discovery.filters({ subjectId })).riwayas, subjectId).toEqual([]);
      }
    },

    async tamperedToken(direction) {
      const { surface, world } = await surfaceFor(direction);
      const own = surface.student(direction.requester);
      const other = surface.student(direction.other);
      for (const token of tamperedTokens(direction, own.accessToken, other.sessionId)) {
        const tampered = await surface.bearing(token);
        await expectUnauthenticated(() =>
          tampered.discovery.filters({ subjectId: world.shared.id }),
        );
      }
    },

    async clientSuppliedGender(direction) {
      const { world, caller, visible, excluded } = await surfaceFor(direction);
      const input = {
        subjectId: world.shared.id,
        gender: direction.other,
      } as DiscoveryFiltersInput;
      const answer = await caller.discovery.filters(input);
      expect([...answer.riwayas].sort()).toEqual(riwayasOf(visible));
      expectNothingOf(answer, excluded);
    },
  },
};

// ---------------------------------------------------------------------------------------------
// discovery.teacher
// ---------------------------------------------------------------------------------------------

const teacher: ProcedureAttacks = {
  path: 'discovery.teacher',
  holds: 'R-GENDER-1, R-GENDER-2, R-GENDER-5, FR-331, FR-336, FR-315',
  attacks: {
    async directCall(direction) {
      const { caller, visible, excluded } = await surfaceFor(direction);

      await expectHiddenUntilRecipientVerified(direction, async (as, one) => {
        try {
          await as.discovery.teacher({ teacherId: one.id });
          return true;
        } catch {
          await expectAnswersAsNonexistent(
            () => as.discovery.teacher({ teacherId: one.id }),
            () => as.discovery.teacher({ teacherId: randomUUID() }),
          );
          return false;
        }
      });

      for (const one of visible) {
        const profile = await caller.discovery.teacher({ teacherId: one.id });
        expect(profile).toMatchObject({ teacherId: one.id, gender: direction.requester });
      }
      for (const one of excluded) {
        await expectAnswersAsNonexistent(
          () => caller.discovery.teacher({ teacherId: one.id }),
          () => caller.discovery.teacher({ teacherId: randomUUID() }),
        );
      }
    },

    async forgedId(direction) {
      const { caller, visible, excluded } = await surfaceFor(direction);
      // The other gender's visible teachers are the forged ids that matter most (R-GENDER-2).
      const forged = excluded.filter((one) => one.gender === direction.other);
      expect(forged.length).toBeGreaterThan(visible.length);
      for (const one of forged) {
        await expectAnswersAsNonexistent(
          () => caller.discovery.teacher({ teacherId: one.id }),
          () => caller.discovery.teacher({ teacherId: randomUUID() }),
        );
      }
    },

    async guessedId(direction) {
      const { caller, excluded } = await surfaceFor(direction);
      for (const one of excluded) {
        await expectAnswersAsNonexistent(
          () => caller.discovery.teacher({ teacherId: neighbourOf(one.id) }),
          () => caller.discovery.teacher({ teacherId: randomUUID() }),
        );
        await expectAnswersAsNonexistent(
          () => caller.discovery.teacher({ teacherId: one.id.toUpperCase() }),
          () => caller.discovery.teacher({ teacherId: randomUUID() }),
        );
      }
    },

    async tamperedToken(direction) {
      const { surface, visible } = await surfaceFor(direction);
      const own = surface.student(direction.requester);
      const other = surface.student(direction.other);
      const [one] = visible;
      if (one === undefined) throw new Error('no visible teacher');
      for (const token of tamperedTokens(direction, own.accessToken, other.sessionId)) {
        const tampered = await surface.bearing(token);
        await expectUnauthenticated(() => tampered.discovery.teacher({ teacherId: one.id }));
      }
    },

    async clientSuppliedGender(direction) {
      const { caller, excluded } = await surfaceFor(direction);
      for (const one of excluded.filter(({ gender }) => gender === direction.other)) {
        const input = { teacherId: one.id, gender: direction.other } as DiscoveryTeacherInput;
        await expectAnswersAsNonexistent(
          () => caller.discovery.teacher(input),
          () => caller.discovery.teacher({ teacherId: randomUUID() }),
        );
      }
    },
  },
};

/** The `discovery` namespace's registrations (T028). */
export const discoveryAttacks: readonly ProcedureAttacks[] = [browse, filters, teacher];
