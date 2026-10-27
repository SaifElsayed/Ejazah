// T087 — the adversarial gender suite (FR-064; R-GENDER-1, R-GENDER-2, R-GENDER-3; ADR 0006).
//
// Cross-gender pairings do not exist, in either direction (SRS §3.7.1). A teacher is visible to a
// requester on a student-facing path if and only if all four hold:
//
//   teacher.gender = requester.gender
//   AND teacher_profile.verification_status = 'approved'
//   AND teacher.deleted_at IS NULL
//   AND teacher_profile.payout_verified_at IS NOT NULL
//
// and a pending gender flag changes nothing: the declared gender governs until an admin rules
// (OPEN-09). This suite is a blocking gate from Phase 0 on, while its case coverage is small.
//
// HOW THE HARNESS TAKES THE PREDICATE. Each implementation under attack is a `VisibilitySubject`:
// given a requester and a world of teacher records, it answers with the ids the requester may see.
// The cases are data, written once in relative terms — a teacher of the requester's own gender or
// of the other one — and every case is materialised and asserted in both directions: a male
// requester against female teachers, and a female requester against male teachers (FR-064). The
// expected answer of each case is written by hand from the SRS text, never computed by a subject,
// so the suite can fail an implementation, the reference one included.
//
// WHAT IS UNDER ATTACK TODAY. No implementation exists yet: the predicate lands in Phase 2, once,
// as the repository filter of `catalog` (R-GENDER-5). Until then the one subject is the SRS text
// itself, transcribed conjunct by conjunct, so the cases are proven consistent with the
// requirement and the suite runs and blocks with the coverage it has. When `catalog` lands, its
// filter joins `subjects` through `catalog`'s `index.ts`, against a migrated database, and every
// case below runs against it in both directions with no case rewritten. The cases that need the
// API surfaces (a profile by id answering 404, crafted pagination, facets) are listed as `it.todo`
// in each direction, for the Phase 2 task that builds those surfaces.
//
// THE SUITE IS SEEN TO BITE (T085, FR-211, research R-119). A suite that passes the right predicate
// proves nothing until it is seen to fail a wrong one, so two leaky subjects are committed beside
// the reference: `noGenderConjunct`, the predicate without the gender conjunct, and
// `asymmetricV11`, the asymmetric rule SRS §3.7.1 replaced (a female requester sees both genders,
// a male requester only males). They are never in `subjects`, whose every case must pass; the
// `expectToBite` block runs the whole case table, the count comparison included, against each, in
// each direction, and is red only if a leaky subject passes where it must be caught — the way
// `tests/violations/harness.ts` inverts a lint rule. The reference subject runs through the same
// comparison as a control, so a bite cannot come from a comparison that disagrees with everything.
//
// The genders and verification statuses come from the generated client (`pnpm db:generate`), so a
// status added to the schema is attacked here without a new case, and a third gender value fails
// the suite until this harness is revisited.
import { $Enums } from '@prisma/client';
import { describe, expect, it } from 'vitest';

type Gender = $Enums.Gender;
type VerificationStatus = $Enums.TeacherVerificationStatus;

interface Requester {
  /** Taken from the server-held session, never from client input (R-GENDER-4). */
  readonly gender: Gender;
}

/** What the predicate reads of one teacher: `users` and `teacher_profiles` (ERD), and any open flag. */
interface TeacherRecord {
  readonly id: string;
  /** The declared gender (`users.gender`). */
  readonly gender: Gender;
  readonly verificationStatus: VerificationStatus;
  readonly deletedAt: Date | null;
  readonly payoutVerifiedAt: Date | null;
  /** A `gender_flags` row with status `open` names this teacher. */
  readonly openGenderFlag: boolean;
}

/** One implementation of the visibility predicate under attack. */
interface VisibilitySubject {
  readonly name: string;
  /** The ids of the teachers in `world` the requester may see on a student-facing path. */
  visibleTeacherIds(
    requester: Requester,
    world: readonly TeacherRecord[],
  ): Promise<readonly string[]>;
}

/** SRS §3.7.1 as written, one line per conjunct. An open flag is not read (OPEN-09). */
const srsText: VisibilitySubject = {
  name: 'SRS §3.7.1 as written',
  visibleTeacherIds: (requester, world) =>
    Promise.resolve(
      world
        .filter(
          (teacher) =>
            teacher.gender === requester.gender &&
            teacher.verificationStatus === $Enums.TeacherVerificationStatus.approved &&
            teacher.deletedAt === null &&
            teacher.payoutVerifiedAt !== null,
        )
        .map((teacher) => teacher.id),
    ),
};

/** Every implementation the cases run against. `catalog`'s filter joins in Phase 2 (R-GENDER-5). */
const subjects: readonly VisibilitySubject[] = [srsText];

// ---------------------------------------------------------------------------------------------
// Directions
// ---------------------------------------------------------------------------------------------

interface Direction {
  readonly name: string;
  readonly requester: Gender;
  readonly other: Gender;
}

const directions: readonly Direction[] = [
  {
    name: 'a male requester against female teachers',
    requester: $Enums.Gender.male,
    other: $Enums.Gender.female,
  },
  {
    name: 'a female requester against male teachers',
    requester: $Enums.Gender.female,
    other: $Enums.Gender.male,
  },
];

// ---------------------------------------------------------------------------------------------
// Cases, written relative to the requester
// ---------------------------------------------------------------------------------------------

/** A teacher written relative to the requester; every field left out takes its visible value. */
interface RelativeTeacher {
  readonly gender: 'own' | 'other';
  readonly verificationStatus?: VerificationStatus;
  readonly deleted?: boolean;
  readonly payoutVerified?: boolean;
  readonly openGenderFlag?: boolean;
}

type World = Readonly<Record<string, RelativeTeacher>>;

interface VisibilityCase {
  readonly name: string;
  /** The rule or requirement the case holds, printed when it fails. */
  readonly holds: string;
  readonly world: World;
  /** The keys of `world` the requester must see, and no other; written from the SRS text. */
  readonly visible: readonly string[];
}

const SOME_DAY = new Date('2026-10-01T00:00:00Z');

function materialise(direction: Direction, world: World): TeacherRecord[] {
  return Object.entries(world).map(([id, teacher]) => ({
    id,
    gender: teacher.gender === 'own' ? direction.requester : direction.other,
    verificationStatus: teacher.verificationStatus ?? $Enums.TeacherVerificationStatus.approved,
    deletedAt: teacher.deleted === true ? SOME_DAY : null,
    payoutVerifiedAt: teacher.payoutVerified === false ? null : SOME_DAY,
    openGenderFlag: teacher.openGenderFlag ?? false,
  }));
}

const notApproved = Object.values($Enums.TeacherVerificationStatus).filter(
  (status) => status !== $Enums.TeacherVerificationStatus.approved,
);

const cases: readonly VisibilityCase[] = [
  {
    name: 'an eligible teacher of the requester’s gender is visible, one of the other gender is absent',
    holds: 'R-GENDER-1',
    world: { own: { gender: 'own' }, other: { gender: 'other' } },
    visible: ['own'],
  },
  {
    name: 'a world holding only teachers of the other gender answers with nothing',
    holds: 'R-GENDER-1',
    world: { a: { gender: 'other' }, b: { gender: 'other' }, c: { gender: 'other' } },
    visible: [],
  },
  ...notApproved.map((status): VisibilityCase => ({
    name: `a teacher of either gender whose verification is ${status} is absent`,
    holds: 'FR-DISC-5',
    world: {
      own: { gender: 'own', verificationStatus: status },
      other: { gender: 'other', verificationStatus: status },
    },
    visible: [],
  })),
  {
    name: 'a soft-deleted teacher of either gender is absent',
    holds: 'SRS §3.7.1',
    world: { own: { gender: 'own', deleted: true }, other: { gender: 'other', deleted: true } },
    visible: [],
  },
  {
    name: 'a teacher of either gender whose payout is not verified is absent',
    holds: 'FR-PAYG-14',
    world: {
      own: { gender: 'own', payoutVerified: false },
      other: { gender: 'other', payoutVerified: false },
    },
    visible: [],
  },
  {
    name: 'an open gender flag changes nothing: the declared gender governs',
    holds: 'OPEN-09',
    world: {
      own: { gender: 'own', openGenderFlag: true },
      other: { gender: 'other', openGenderFlag: true },
    },
    visible: ['own'],
  },
  {
    name: 'a mixed world: only the eligible teachers of the requester’s gender are visible',
    holds: 'R-GENDER-1',
    world: {
      eligible: { gender: 'own' },
      flagged: { gender: 'own', openGenderFlag: true },
      pending: { gender: 'own', verificationStatus: $Enums.TeacherVerificationStatus.pending },
      deleted: { gender: 'own', deleted: true },
      unpaid: { gender: 'own', payoutVerified: false },
      other: { gender: 'other' },
      otherFlagged: { gender: 'other', openGenderFlag: true },
    },
    visible: ['eligible', 'flagged'],
  },
];

/**
 * Teachers of the requester's own gender only, to show that nothing the requester sees, its count
 * included, changes with how many teachers of the other gender exist (R-GENDER-3).
 */
const ownOnly: World = {
  a: { gender: 'own' },
  b: { gender: 'own' },
  pending: { gender: 'own', verificationStatus: $Enums.TeacherVerificationStatus.pending },
};

/** How many teachers of the other gender the count comparison adds to `ownOnly`. */
const OTHER_GENDER_COUNTS = [1, 5, 50] as const;

function withOthers(count: number): World {
  const others: Record<string, RelativeTeacher> = {};
  for (let index = 0; index < count; index += 1) others[`other${index}`] = { gender: 'other' };
  return { ...ownOnly, ...others };
}

// ---------------------------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------------------------

const caseTable = cases.map((visibilityCase) => [visibilityCase.name, visibilityCase] as const);

describe('the harness runs every case in both directions (FR-064)', () => {
  it('has exactly two directions, one per gender, each against the other', () => {
    expect(Object.values($Enums.Gender).sort()).toEqual(['female', 'male']);
    expect(directions.map((direction) => direction.requester).sort()).toEqual(['female', 'male']);
    for (const direction of directions) expect(direction.other).not.toBe(direction.requester);
  });

  it.each(caseTable)('materialises “%s” as mirror images', (_, visibilityCase) => {
    const [first, second] = directions.map((direction) =>
      materialise(direction, visibilityCase.world),
    );
    const swap = (gender: Gender): Gender =>
      gender === $Enums.Gender.male ? $Enums.Gender.female : $Enums.Gender.male;
    expect(first?.map((teacher) => ({ ...teacher, gender: swap(teacher.gender) }))).toEqual(second);
  });
});

for (const subject of subjects) {
  for (const direction of directions) {
    describe(`${subject.name}: ${direction.name}`, () => {
      const requester: Requester = { gender: direction.requester };

      it.each(caseTable)('%s', async (_, visibilityCase) => {
        const world = materialise(direction, visibilityCase.world);
        const seen = await subject.visibleTeacherIds(requester, world);
        expect([...seen].sort(), visibilityCase.holds).toEqual([...visibilityCase.visible].sort());
        for (const id of seen) {
          const teacher = world.find((candidate) => candidate.id === id);
          expect(teacher?.gender, 'R-GENDER-1').toBe(direction.requester);
        }
      });

      it('answers the same, count included, however many teachers of the other gender exist (R-GENDER-3)', async () => {
        const baseline = await subject.visibleTeacherIds(
          requester,
          materialise(direction, ownOnly),
        );
        expect([...baseline].sort()).toEqual(['a', 'b']);
        for (const count of OTHER_GENDER_COUNTS) {
          const seen = await subject.visibleTeacherIds(
            requester,
            materialise(direction, withOthers(count)),
          );
          expect([...seen].sort()).toEqual([...baseline].sort());
          expect(seen.length).toBe(baseline.length);
        }
      });

      it.todo(
        'Phase 2: a direct request for a teacher of the other gender answers exactly as one for an id that does not exist, 404 and never 403 (R-GENDER-2)',
      );
      it.todo(
        'Phase 2: crafted pagination cursors and page sizes never reach a teacher of the other gender (R-GENDER-1)',
      );
      it.todo('Phase 2: search facets and totals are computed after the predicate (R-GENDER-3)');
    });
  }
}

// ---------------------------------------------------------------------------------------------
// The suite bites (T085, FR-211, research R-119)
// ---------------------------------------------------------------------------------------------

function eligibleApartFromGender(teacher: TeacherRecord): boolean {
  return (
    teacher.verificationStatus === $Enums.TeacherVerificationStatus.approved &&
    teacher.deletedAt === null &&
    teacher.payoutVerifiedAt !== null
  );
}

/** SRS §3.7.1 with its first conjunct, `teacher.gender = requester.gender`, dropped. */
const noGenderConjunct: VisibilitySubject = {
  name: 'noGenderConjunct',
  visibleTeacherIds: (_requester, world) =>
    Promise.resolve(world.filter(eligibleApartFromGender).map((teacher) => teacher.id)),
};

/** The asymmetric v1.1 rule SRS §3.7.1 replaced: a female requester sees both genders. */
const asymmetricV11: VisibilitySubject = {
  name: 'asymmetricV11',
  visibleTeacherIds: (requester, world) =>
    Promise.resolve(
      world
        .filter(
          (teacher) =>
            (requester.gender === $Enums.Gender.female || teacher.gender === requester.gender) &&
            eligibleApartFromGender(teacher),
        )
        .map((teacher) => teacher.id),
    ),
};

interface InvertedSubject {
  readonly subject: VisibilitySubject;
  /**
   * The requester genders whose direction must catch the subject, written by hand from where its
   * leak lies. A direction left out must pass it: its leak is not there, and only the other
   * direction shows it, which is why every case runs in both (FR-064).
   */
  readonly caughtBy: readonly Gender[];
}

const invertedSubjects: readonly InvertedSubject[] = [
  { subject: noGenderConjunct, caughtBy: [$Enums.Gender.male, $Enums.Gender.female] },
  { subject: asymmetricV11, caughtBy: [$Enums.Gender.female] },
];

interface Disagreement {
  readonly name: string;
  readonly holds: string;
}

const COUNT_COMPARISON: Disagreement = {
  name: 'the answer and its count unchanged however many teachers of the other gender exist',
  holds: 'R-GENDER-3',
};

function sameIds(seen: readonly string[], expected: readonly string[]): boolean {
  return JSON.stringify([...seen].sort()) === JSON.stringify([...expected].sort());
}

/**
 * Every case of the table, and the count comparison, on which `subject` answers otherwise than the
 * hand-written expectation, in one direction. Nothing here throws: the caller decides whether a
 * disagreement is the failure (a subject under attack) or the proof (an inverted one).
 */
async function disagreements(
  subject: VisibilitySubject,
  direction: Direction,
): Promise<Disagreement[]> {
  const requester: Requester = { gender: direction.requester };
  const answer = (world: World): Promise<readonly string[]> =>
    subject.visibleTeacherIds(requester, materialise(direction, world));

  const [table, baseline, withOtherGender] = await Promise.all([
    Promise.all(cases.map((visibilityCase) => answer(visibilityCase.world))),
    answer(ownOnly),
    Promise.all(OTHER_GENDER_COUNTS.map((count) => answer(withOthers(count)))),
  ]);

  const found: Disagreement[] = cases
    .filter((visibilityCase, index) => !sameIds(table[index] ?? [], visibilityCase.visible))
    .map(({ name, holds }) => ({ name, holds }));
  const countHolds =
    sameIds(baseline, ['a', 'b']) && withOtherGender.every((seen) => sameIds(seen, baseline));
  if (!countHolds) found.push(COUNT_COMPARISON);
  return found;
}

function biteReport(subject: VisibilitySubject, direction: Direction, verdict: string): string {
  return [
    '',
    `subject      ${subject.name}`,
    `direction    ${direction.name}`,
    `verdict      ${verdict}`,
    '',
  ].join('\n');
}

/**
 * The inversion: a leaky subject must disagree with the table in this direction, on a case of
 * R-GENDER-1 and on the count comparison of R-GENDER-3. Red only if the leak passes.
 */
async function expectToBite(subject: VisibilitySubject, direction: Direction): Promise<void> {
  const found = await disagreements(subject, direction);
  const holds = new Set(found.map((disagreement) => disagreement.holds));
  expect(
    holds.has('R-GENDER-1'),
    biteReport(
      subject,
      direction,
      'THE SUITE PASSED A LEAKY SUBJECT — no R-GENDER-1 case caught it',
    ),
  ).toBe(true);
  expect(
    holds.has('R-GENDER-3'),
    biteReport(
      subject,
      direction,
      'THE SUITE PASSED A LEAKY SUBJECT — the count comparison did not catch it (R-GENDER-3)',
    ),
  ).toBe(true);
}

describe('expectToBite: the suite fails each inverted subject (T085, FR-211)', () => {
  for (const direction of directions) {
    it(`the comparison finds no disagreement for the reference subject: ${direction.name}`, async () => {
      expect(await disagreements(srsText, direction)).toEqual([]);
    });
  }

  for (const { subject, caughtBy } of invertedSubjects) {
    for (const direction of directions) {
      if (caughtBy.includes(direction.requester)) {
        it(`${subject.name} is caught: ${direction.name}`, async () => {
          await expectToBite(subject, direction);
        });
      } else {
        it(`${subject.name} leaks nothing here, so only the other direction catches it: ${direction.name}`, async () => {
          expect(await disagreements(subject, direction)).toEqual([]);
        });
      }
    }
  }
});
