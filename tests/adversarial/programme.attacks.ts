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
// `programme.request` (the teacher's refusal, FR-709), attacked as the offer is: in the discovery
// world, on programmes of each gender awaiting their offer (session 1 delivered an hour ago, so the
// refusal may be asked). A programme the caller is not the party of, the other gender's above all,
// answers exactly as an enrollment that never existed and is left as it was; the own party's call is
// answered (the own student's cancellation `{ ok: true }`, the own teacher's request an item), so no
// attack passes on a refusal of everything. The cancellation's other role (the teacher) is FORBIDDEN
// by its kind, the request's (the student) too.

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
    kind: 'refusal',
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
  answered: (answer: unknown) => void,
): ProcedureAttacks {
  const answers = async (pair: ProgrammePair, extra: object = {}) =>
    answered(await call(party(pair), pair.enrollmentId, extra));
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
  (answer) => expect(answer).toEqual({ ok: true }),
);

const requestAttacks = partyAttacks(
  'programme.request',
  'R-GENDER-2, R-GENDER-4, FR-709, FR-410',
  request,
  (pair) => pair.teacher,
  (pair) => pair.student,
  (answer) => expect(answer).toEqual({ requestId: expect.any(String) }),
);

export const programmeAttacks: readonly ProcedureAttacks[] = [
  offerAttacks,
  // 006:T008.
  cancelAttacks,
  requestAttacks,
];
