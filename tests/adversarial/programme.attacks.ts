// 006:T007 of specs/006-programme — `programme.offer`'s attacks (contracts/app-surface.md; FR-705;
// R-GENDER-2, R-GENDER-4; PR #153 r1 Major 2). `programme` is read by the harness whatever the
// caller kind, so this teacher-kind procedure is registered (`procedure-harness.ts`,
// `PROGRAMME_ROUTERS`). Each attack runs in the discovery world (`discovery-world.ts`) over the real
// user surface, on programmes of each gender awaiting their offer (`programmePair`, a new one per
// call, since an offer moves a programme to `offered`).
//
// What every attack holds: a programme the caller is not the teacher of, the other gender's above
// all, answers exactly as an enrollment that never existed (404, `NOT_FOUND`, no field), and
// nothing is written to it; the own teacher's offer is answered, so no attack passes on a refusal of
// everything.
//
//   directCall            the teacher offers on the own programme (answered: 40 × 400 EGP); the
//                         same teacher on the other gender's programme, and another teacher of the
//                         same gender on this one, NOT_FOUND; the programme's own student FORBIDDEN.
//   forgedId              the other gender's enrollment, the parties' user ids and an enrollment of
//                         another teacher's programme, sent as the enrollment.
//   guessedId             random ids, the own enrollment's neighbour and that neighbour upper-cased
//                         (the own id upper-cased is the own id: Postgres reads a uuid in any case).
//   tamperedToken         a tampered bearer token: 401 before anything is read.
//   clientSuppliedGender  a `gender` field naming the other gender is ignored: the other gender's
//                         programme stays hidden, the own one is offered.
import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import { toErrorShape } from '../../apps/api/src/surfaces/procedures.js';
import { expectUnauthenticated, neighbourOf, tamperedTokens } from './discovery.attacks.js';
import { discoverySurface, type ProgrammePair, type SessionParty } from './discovery-world.js';
import {
  type Direction,
  expectAnswersAsNonexistent,
  type ProcedureAttacks,
} from './procedure-harness.js';

const HOLDS = 'R-GENDER-2, R-GENDER-4, FR-705, FR-410';

/** The world's 45-minute programme price, 400 EGP: 40 sessions are 16,000 EGP in 10 months. */
const OFFERED = { total_piasters: 1_600_000, sessionPrice_piasters: 40_000, monthCount: 10 };

type OfferInput = Parameters<SessionParty['caller']['programme']['offer']>[0];

function offer(party: SessionParty, enrollmentId: string, extra: object = {}) {
  return party.caller.programme.offer({
    enrollmentId,
    level: 'يحفظ جزء عم',
    readiness: 'جاهز',
    expectedLength: 'عشرة أشهر',
    durationMinutes: 45,
    sessionCount: 40,
    idempotencyKey: randomUUID(),
    ...extra,
  } as OfferInput);
}

/** The offer on `enrollmentId` answers exactly as one on an enrollment that never existed. */
function expectHidden(party: SessionParty, enrollmentId: string, extra: object = {}) {
  return expectAnswersAsNonexistent(
    () => offer(party, enrollmentId, extra),
    () => offer(party, randomUUID(), extra),
  );
}

/** The requester's programme, the other gender's, and another of the requester's gender. */
async function worldFor(direction: Direction) {
  const surface = await discoverySurface();
  const [own, theirs, neighbour] = await Promise.all([
    surface.programmePair(direction.requester),
    surface.programmePair(direction.other),
    surface.programmePair(direction.requester),
  ]);
  return { surface, own, theirs, neighbour };
}

/** The programme still awaits its offer: a refused attack wrote nothing to it. */
async function expectUntouched(pair: ProgrammePair, other: SessionParty): Promise<void> {
  // A second teacher's refusal leaves it offerable by its own teacher alone.
  await expectHidden(other, pair.enrollmentId);
  expect(await offer(pair.teacher, pair.enrollmentId)).toEqual(OFFERED);
}

const offerAttacks: ProcedureAttacks = {
  path: 'programme.offer',
  holds: HOLDS,
  attacks: {
    directCall: async (direction) => {
      const { own, theirs, neighbour } = await worldFor(direction);
      await expectHidden(own.teacher, theirs.enrollmentId);
      await expectHidden(neighbour.teacher, own.enrollmentId);
      const refusal: unknown = await offer(own.student, own.enrollmentId).catch(
        (error: unknown) => error,
      );
      expect(toErrorShape(refusal as Parameters<typeof toErrorShape>[0]).body.code).toBe(
        'FORBIDDEN',
      );
      expect(await offer(own.teacher, own.enrollmentId)).toEqual(OFFERED);
      await expectUntouched(theirs, own.teacher);
    },
    forgedId: async (direction) => {
      const { own, theirs, neighbour } = await worldFor(direction);
      for (const forged of [
        theirs.enrollmentId,
        neighbour.enrollmentId,
        own.student.userId,
        own.teacher.userId,
        theirs.teacher.userId,
      ]) {
        await expectHidden(own.teacher, forged);
      }
      expect(await offer(own.teacher, own.enrollmentId)).toEqual(OFFERED);
    },
    guessedId: async (direction) => {
      const { own } = await worldFor(direction);
      for (const guessed of [
        randomUUID(),
        randomUUID(),
        neighbourOf(own.enrollmentId),
        neighbourOf(own.enrollmentId).toUpperCase(),
      ]) {
        await expectHidden(own.teacher, guessed);
      }
      expect(await offer(own.teacher, own.enrollmentId)).toEqual(OFFERED);
    },
    tamperedToken: async (direction) => {
      const { surface, own, theirs } = await worldFor(direction);
      for (const token of tamperedTokens(
        direction,
        own.teacher.accessToken,
        theirs.teacher.sessionId,
      )) {
        const tampered = await surface.bearing(token);
        await expectUnauthenticated(() =>
          tampered.programme.offer({
            enrollmentId: own.enrollmentId,
            level: 'x',
            readiness: 'x',
            expectedLength: 'x',
            durationMinutes: 45,
            sessionCount: 40,
            idempotencyKey: randomUUID(),
          }),
        );
      }
      expect(await offer(own.teacher, own.enrollmentId)).toEqual(OFFERED);
    },
    clientSuppliedGender: async (direction) => {
      const { own, theirs } = await worldFor(direction);
      await expectHidden(own.teacher, theirs.enrollmentId, { gender: direction.other });
      expect(await offer(own.teacher, own.enrollmentId, { gender: direction.other })).toEqual(
        OFFERED,
      );
    },
  },
};

// ---------------------------------------------------------------------------------------------
// 006:T008 of specs/006-programme — `programme.cancel` (the student's, FR-706) and
// `programme.request` (the teacher's; `stop` alone since SRS DEC-112, T017's), attacked as the offer
// is: in the discovery world, on programmes of each gender awaiting their offer. A programme the
// caller is not the party of, the other gender's above all, answers exactly as an enrollment that
// never existed and is left as it was; the own party's call gets its own answer (the own student's
// cancellation `{ ok: true }`; the own teacher's stop `CONFLICT` `not_paused`, the programme not
// being paused), so no attack passes on a NOT_FOUND to everyone. The cancellation's other role (the
// teacher) is FORBIDDEN by its kind, the request's (the student) too.

type ActionInput = Parameters<SessionParty['caller']['programme']['cancel']>[0];
type RequestInput = Parameters<SessionParty['caller']['programme']['request']>[0];

function cancel(party: SessionParty, enrollmentId: string, extra: object = {}) {
  return party.caller.programme.cancel({
    enrollmentId,
    idempotencyKey: randomUUID(),
    ...extra,
  } as ActionInput);
}

function request(party: SessionParty, enrollmentId: string, extra: object = {}) {
  return party.caller.programme.request({
    enrollmentId,
    kind: 'stop',
    reason: 'لا يناسبه البرنامج',
    idempotencyKey: randomUUID(),
    ...extra,
  } as RequestInput);
}

type Call = (party: SessionParty, enrollmentId: string, extra?: object) => Promise<unknown>;

/** `call` on `enrollmentId` answers exactly as on an enrollment that never existed. */
function expectHiddenTo(call: Call, party: SessionParty, enrollmentId: string, extra: object = {}) {
  return expectAnswersAsNonexistent(
    () => call(party, enrollmentId, extra),
    () => call(party, randomUUID(), extra),
  );
}

/** The kind's refusal of the other role, before anything is read. */
async function expectForbidden(call: Promise<unknown>): Promise<void> {
  const refusal: unknown = await call.catch((error: unknown) => error);
  expect(toErrorShape(refusal as Parameters<typeof toErrorShape>[0]).body.code).toBe('FORBIDDEN');
}

/** A party call's attacks: `party` picks the caller of the procedure's role from a pair. */
function partyAttacks(
  path: string,
  holds: string,
  call: Call,
  party: (pair: ProgrammePair) => SessionParty,
  otherRole: (pair: ProgrammePair) => SessionParty,
  answered: (answer: Promise<unknown>) => Promise<void>,
): ProcedureAttacks {
  const answers = async (pair: ProgrammePair, extra: object = {}) =>
    answered(call(party(pair), pair.enrollmentId, extra));
  return {
    path,
    holds,
    attacks: {
      directCall: async (direction) => {
        const { own, theirs, neighbour } = await worldFor(direction);
        await expectHiddenTo(call, party(own), theirs.enrollmentId);
        await expectHiddenTo(call, party(neighbour), own.enrollmentId);
        await expectForbidden(call(otherRole(own), own.enrollmentId));
        await answers(own);
        // The refused attacks wrote nothing to the other gender's programme: its party is answered.
        await answers(theirs);
      },
      forgedId: async (direction) => {
        const { own, theirs, neighbour } = await worldFor(direction);
        for (const forged of [
          theirs.enrollmentId,
          neighbour.enrollmentId,
          own.student.userId,
          own.teacher.userId,
          party(theirs).userId,
        ]) {
          await expectHiddenTo(call, party(own), forged);
        }
        await answers(own);
      },
      guessedId: async (direction) => {
        const { own } = await worldFor(direction);
        for (const guessed of [
          randomUUID(),
          randomUUID(),
          neighbourOf(own.enrollmentId),
          neighbourOf(own.enrollmentId).toUpperCase(),
        ]) {
          await expectHiddenTo(call, party(own), guessed);
        }
        await answers(own);
      },
      tamperedToken: async (direction) => {
        const { surface, own, theirs } = await worldFor(direction);
        for (const token of tamperedTokens(
          direction,
          party(own).accessToken,
          party(theirs).sessionId,
        )) {
          const tampered = await surface.bearing(token);
          await expectUnauthenticated(() =>
            call({ ...party(own), caller: tampered }, own.enrollmentId),
          );
        }
        await answers(own);
      },
      clientSuppliedGender: async (direction) => {
        const { own, theirs } = await worldFor(direction);
        await expectHiddenTo(call, party(own), theirs.enrollmentId, { gender: direction.other });
        await answers(own, { gender: direction.other });
      },
    },
  };
}

const cancelAttacks = partyAttacks(
  'programme.cancel',
  'R-GENDER-2, R-GENDER-4, FR-706, FR-410',
  cancel,
  (pair) => pair.student,
  (pair) => pair.teacher,
  async (answer) => {
    expect(await answer).toEqual({ ok: true });
  },
);

const requestAttacks = partyAttacks(
  'programme.request',
  'R-GENDER-2, R-GENDER-4, FR-723, FR-410, SRS DEC-112',
  request,
  (pair) => pair.teacher,
  (pair) => pair.student,
  async (answer) => {
    const refusal: unknown = await answer.then(
      () => new Error('answered instead of refused'),
      (error: unknown) => error,
    );
    expect(toErrorShape(refusal as Parameters<typeof toErrorShape>[0]).body).toMatchObject({
      code: 'CONFLICT',
      details: [{ path: 'cause', code: 'not_paused' }],
    });
  },
);

// ---------------------------------------------------------------------------------------------
// 006:T009 of specs/006-programme — `programme.pay`'s attacks (FR-710; R-GENDER-2, R-GENDER-4). The
// student kind, on programmes of each gender their teacher offered (`offeredProgramme`, a new one
// per call, since a payment's order makes another checkout of its student wait). What every attack
// holds: a programme the caller is not the student of, the other gender's above all, answers
// exactly as an enrollment that never existed, and no order is written on it; the own student's
// payment is answered with its hosted checkout, so no attack passes on a refusal of everything.
//
//   directCall            the student pays the own programme (answered); the same student on the
//                         other gender's programme, and another student of the same gender on this
//                         one, NOT_FOUND; the programme's own teacher FORBIDDEN.
//   forgedId              the other gender's enrollment, the parties' user ids and another student's
//                         programme, sent as the enrollment.
//   guessedId             random ids and the own enrollment's neighbour, upper-cased too.
//   tamperedToken         a tampered bearer token: 401 before anything is read.
//   clientSuppliedGender  a `gender` field naming the other gender is ignored.

const PAY_HOLDS = 'R-GENDER-2, R-GENDER-4, FR-710, FR-410';

type PayInput = Parameters<SessionParty['caller']['programme']['pay']>[0];

function pay(party: SessionParty, enrollmentId: string, extra: object = {}) {
  return party.caller.programme.pay({
    enrollmentId,
    plan: 'monthly',
    saveCard: false,
    idempotencyKey: randomUUID(),
    ...extra,
  } as PayInput);
}

/** The payment on `enrollmentId` answers exactly as one on an enrollment that never existed. */
function expectPayHidden(party: SessionParty, enrollmentId: string, extra: object = {}) {
  return expectAnswersAsNonexistent(
    () => pay(party, enrollmentId, extra),
    () => pay(party, randomUUID(), extra),
  );
}

/** The own student's payment: its hosted checkout. */
async function expectPaid(pair: ProgrammePair, extra: object = {}): Promise<void> {
  const answer = await pay(pair.student, pair.enrollmentId, extra);
  expect(answer.checkoutUrl).toMatch(/^https?:\/\//);
}

/** The requester's offered programme, the other gender's, and another of the requester's gender. */
async function offeredWorldFor(direction: Direction) {
  const surface = await discoverySurface();
  const [own, theirs, neighbour] = await Promise.all([
    surface.offeredProgramme(direction.requester),
    surface.offeredProgramme(direction.other),
    surface.offeredProgramme(direction.requester),
  ]);
  return { surface, own, theirs, neighbour };
}

const payAttacks: ProcedureAttacks = {
  path: 'programme.pay',
  holds: PAY_HOLDS,
  attacks: {
    directCall: async (direction) => {
      const { own, theirs, neighbour } = await offeredWorldFor(direction);
      await expectPayHidden(own.student, theirs.enrollmentId);
      await expectPayHidden(neighbour.student, own.enrollmentId);
      const refusal: unknown = await pay(own.teacher, own.enrollmentId).catch(
        (error: unknown) => error,
      );
      expect(toErrorShape(refusal as Parameters<typeof toErrorShape>[0]).body.code).toBe(
        'FORBIDDEN',
      );
      await expectPaid(own);
      // The other gender's programme took no order: its own student still pays it.
      await expectPaid(theirs);
    },
    forgedId: async (direction) => {
      const { own, theirs, neighbour } = await offeredWorldFor(direction);
      for (const forged of [
        theirs.enrollmentId,
        neighbour.enrollmentId,
        own.student.userId,
        own.teacher.userId,
        theirs.student.userId,
      ]) {
        await expectPayHidden(own.student, forged);
      }
      await expectPaid(own);
    },
    guessedId: async (direction) => {
      const { own } = await offeredWorldFor(direction);
      for (const guessed of [
        randomUUID(),
        randomUUID(),
        neighbourOf(own.enrollmentId),
        neighbourOf(own.enrollmentId).toUpperCase(),
      ]) {
        await expectPayHidden(own.student, guessed);
      }
      await expectPaid(own);
    },
    tamperedToken: async (direction) => {
      const { surface, own, theirs } = await offeredWorldFor(direction);
      for (const token of tamperedTokens(
        direction,
        own.student.accessToken,
        theirs.student.sessionId,
      )) {
        const tampered = await surface.bearing(token);
        await expectUnauthenticated(() =>
          tampered.programme.pay({
            enrollmentId: own.enrollmentId,
            plan: 'monthly',
            saveCard: false,
            idempotencyKey: randomUUID(),
          }),
        );
      }
      await expectPaid(own);
    },
    clientSuppliedGender: async (direction) => {
      const { own, theirs } = await offeredWorldFor(direction);
      await expectPayHidden(own.student, theirs.enrollmentId, { gender: direction.other });
      await expectPaid(own, { gender: direction.other });
    },
  },
};

// 006:T016 (FR-713a, SRS DEC-95; contracts/app-surface.md `programme.autoRenewOff`): the student's, at
// any time; on the pair's programme awaiting its offer it answers `{ ok: true }` (no card to delete),
// so the attacks show the own student reaches the service and everyone else meets NOT_FOUND.
function autoRenewOff(party: SessionParty, enrollmentId: string, extra: object = {}) {
  return party.caller.programme.autoRenewOff({
    enrollmentId,
    idempotencyKey: randomUUID(),
    ...extra,
  } as ActionInput);
}

const autoRenewOffAttacks = partyAttacks(
  'programme.autoRenewOff',
  'R-GENDER-2, R-GENDER-4, FR-713a, FR-410, SRS DEC-95',
  autoRenewOff,
  (pair) => pair.student,
  (pair) => pair.teacher,
  async (answer) => {
    expect(await answer).toEqual({ ok: true });
  },
);

// 006:T016 (FR-715, FR-716; contracts/app-surface.md `programme.renew`): the student's next month by
// hand; on the pair's programme awaiting its offer it is refused `nothing_due` (no month is due before
// the first payment), so the attacks show the own student reaches the check and everyone else meets
// NOT_FOUND, with no gateway order made.
type RenewInput = Parameters<SessionParty['caller']['programme']['renew']>[0];

function renew(party: SessionParty, enrollmentId: string, extra: object = {}) {
  return party.caller.programme.renew({
    enrollmentId,
    saveCard: false,
    idempotencyKey: randomUUID(),
    ...extra,
  } as RenewInput);
}

const renewAttacks = partyAttacks(
  'programme.renew',
  'R-GENDER-2, R-GENDER-4, FR-715, FR-716, FR-410',
  renew,
  (pair) => pair.student,
  (pair) => pair.teacher,
  async (answer) => {
    const refusal: unknown = await answer.then(
      () => new Error('answered instead of refused'),
      (error: unknown) => error,
    );
    expect(toErrorShape(refusal as Parameters<typeof toErrorShape>[0]).body).toMatchObject({
      code: 'CONFLICT',
      details: [{ path: 'cause', code: 'nothing_due' }],
    });
  },
);

export const programmeAttacks: readonly ProcedureAttacks[] = [
  offerAttacks,
  // 006:T008.
  cancelAttacks,
  requestAttacks,
  // 006:T009.
  payAttacks,
  // 006:T016.
  autoRenewOffAttacks,
  renewAttacks,
];
