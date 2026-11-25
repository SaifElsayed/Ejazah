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
//
// 006:T022 (B-P4, the final reach; SC-707): `programme.get` is attacked on programmes that each hold
// a saved card (`cardWorldFor`), so the student's read shows the card's last four and brand and
// nothing else, the teacher's none, and every other party meets NOT_FOUND, both directions. Every
// programme answer and refusal of the run is kept (`recorded`), and one suite-level check
// (`describeProgrammeCardDetailCheck`, called by `procedure-harness.spec.ts` after the attacks)
// finds no card detail in them nor in an audit entry naming the run's ids.
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { mapError } from '../../apps/api/src/platform/errors/error-filter.js';
import { toErrorShape } from '../../apps/api/src/surfaces/procedures.js';
import { expectUnauthenticated, neighbourOf, tamperedTokens } from './discovery.attacks.js';
import {
  discoverySurface,
  type ProgrammePair,
  type SessionParty,
  WORLD_PROGRAMME_PRICES,
} from './discovery-world.js';
import {
  type Direction,
  expectAnswersAsNonexistent,
  type ProcedureAttacks,
} from './procedure-harness.js';

// ---------------------------------------------------------------------------------------------
// 006:T022 (SC-707): what the run answered, kept for the suite-level check
// ---------------------------------------------------------------------------------------------

/** Every programme answer and refusal body of the run, as JSON, in the order they came. */
const responses: string[] = [];
/** The run's enrollments and parties: an audit entry naming one is read by the check. */
const runIds = new Set<string>();

/** A refusal as the client receives it: the surface's one formatter's body. */
function refusalBodyOf(error: unknown): unknown {
  return error instanceof Error && error.name === 'TRPCError'
    ? toErrorShape(error as Parameters<typeof toErrorShape>[0]).body
    : mapError(error).body;
}

/** The call's answer or refusal, kept as the client receives it; the call itself unchanged. */
function recorded<T>(answer: Promise<T>): Promise<T> {
  return answer.then(
    (value) => {
      responses.push(JSON.stringify(value));
      return value;
    },
    (error: unknown) => {
      responses.push(JSON.stringify(refusalBodyOf(error)));
      throw error;
    },
  );
}

function remember(...pairs: readonly ProgrammePair[]): void {
  for (const pair of pairs) {
    runIds.add(pair.enrollmentId);
    runIds.add(pair.student.userId);
    runIds.add(pair.teacher.userId);
  }
}

const HOLDS = 'R-GENDER-2, R-GENDER-4, FR-705, FR-410';

/** The world's 45-minute programme price, 400 EGP: 40 sessions are 16,000 EGP in 10 months. */
const OFFERED = { total_piasters: 1_600_000, sessionPrice_piasters: 40_000, monthCount: 10 };

type OfferInput = Parameters<SessionParty['caller']['programme']['offer']>[0];

function offer(party: SessionParty, enrollmentId: string, extra: object = {}) {
  return recorded(
    party.caller.programme.offer({
      enrollmentId,
      level: 'يحفظ جزء عم',
      readiness: 'جاهز',
      expectedLength: 'عشرة أشهر',
      durationMinutes: 45,
      sessionCount: 40,
      idempotencyKey: randomUUID(),
      ...extra,
    } as OfferInput),
  );
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
  remember(own, theirs, neighbour);
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
  return recorded(
    party.caller.programme.cancel({
      enrollmentId,
      idempotencyKey: randomUUID(),
      ...extra,
    } as ActionInput),
  );
}

function request(party: SessionParty, enrollmentId: string, extra: object = {}) {
  return recorded(
    party.caller.programme.request({
      enrollmentId,
      kind: 'stop',
      reason: 'لا يناسبه البرنامج',
      idempotencyKey: randomUUID(),
      ...extra,
    } as RequestInput),
  );
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
  return recorded(
    party.caller.programme.pay({
      enrollmentId,
      plan: 'monthly',
      saveCard: false,
      idempotencyKey: randomUUID(),
      ...extra,
    } as PayInput),
  );
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
  remember(own, theirs, neighbour);
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
  return recorded(
    party.caller.programme.autoRenewOff({
      enrollmentId,
      idempotencyKey: randomUUID(),
      ...extra,
    } as ActionInput),
  );
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
  return recorded(
    party.caller.programme.renew({
      enrollmentId,
      saveCard: false,
      idempotencyKey: randomUUID(),
      ...extra,
    } as RenewInput),
  );
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

// 006:T018 (FR-726; contracts/app-surface.md `programme.get`): either party's read. Both the pair's
// student and its teacher are answered; everyone else, the other gender's parties above all, meets
// NOT_FOUND exactly as an unknown enrollment, both ways.
//
// 006:T022 (B-P4, (1); R-510, SC-707): every programme attacked here holds a saved card, written as
// the DB specs write one (`programme-reads.spec.ts`): its token encrypted under
// `programme_cards.token_encrypted`, the enrollment's id bound, through this module's own client. The
// student's read answers the card's last four and brand and no other card field; the teacher's
// `card: null`; every other party NOT_FOUND, whatever the card.
type GetInput = Parameters<SessionParty['caller']['programme']['get']>[0];

function get(party: SessionParty, enrollmentId: string, extra: object = {}) {
  return recorded(party.caller.programme.get({ enrollmentId, ...extra } as GetInput));
}

/** The saved card of every programme of `cardWorldFor`, as the gateway's `card_saved` reports one. */
const CARD = { last4: '4821', brand: 'Mastercard' } as const;
/** The card's token: card detail (SC-707), sent to the gateway alone, never answered. */
const CARD_TOKEN = `adversarial-card-token-${randomUUID()}`;
const CARD_TOKEN_COLUMN = 'programme_cards.token_encrypted';
const cardCipher = new ColumnCipher(randomBytes(32).toString('base64'));

/** This module's own client for the cards and the audit read; closed after the file's cases. */
let cardsDatabase: Database | undefined;

function cardsClient(): Database {
  cardsDatabase ??= openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 30_000,
  });
  return cardsDatabase;
}

afterAll(async () => {
  if (cardsDatabase !== undefined) await closeDatabase(cardsDatabase);
});

/** The programme's saved card, as `programme-reads.spec.ts` writes one. */
async function withCard(pair: ProgrammePair): Promise<ProgrammePair> {
  await cardsClient().programmeCard.create({
    data: {
      enrollmentId: pair.enrollmentId,
      tokenEncrypted: Uint8Array.from(
        cardCipher.encrypt(CARD_TOKEN, CARD_TOKEN_COLUMN, pair.enrollmentId),
      ),
      last4: CARD.last4,
      brand: CARD.brand,
      consentedAt: new Date(),
    },
    select: { enrollmentId: true },
  });
  return pair;
}

/** `worldFor`'s three programmes, each with a saved card. */
async function cardWorldFor(direction: Direction) {
  const world = await worldFor(direction);
  await Promise.all([withCard(world.own), withCard(world.theirs), withCard(world.neighbour)]);
  return world;
}

/**
 * The pair's two parties each read the programme, awaiting its offer: the student its card's last
 * four and brand, exactly; the teacher no card. B-P4 (T022, the changed reads): the teacher-only
 * fields go to the teacher alone: `offerTerms` (the offer open to send: the world's three programme
 * prices), `stopRequestOpen` false with none open, `stopRequestFrom` null while not paused; the
 * student is answered none of them.
 */
async function expectRead(pair: ProgrammePair, extra: object = {}): Promise<void> {
  for (const party of [pair.student, pair.teacher]) {
    expect(await get(party, pair.enrollmentId, extra)).toMatchObject({
      state: 'awaiting_offer',
      offer: null,
      payeePending: false,
      stopRequestFrom: null,
      stopRequestOpen: false,
    });
  }
  const student = await get(pair.student, pair.enrollmentId, extra);
  expect(student.card, 'the student: the last four and the brand, nothing else (SC-707)').toEqual(
    CARD,
  );
  expect(student.offerTerms).toBeNull();
  const teacher = await get(pair.teacher, pair.enrollmentId, extra);
  expect(teacher.card, 'the teacher: no card (R-510)').toBeNull();
  expect(teacher.offerTerms).toMatchObject({
    slotMinutes: expect.any(Number),
    prices: WORLD_PROGRAMME_PRICES,
  });
}

const getAttacks: ProcedureAttacks = {
  path: 'programme.get',
  holds: 'R-GENDER-2, R-GENDER-4, FR-726, FR-410, R-510, SC-707',
  attacks: {
    directCall: async (direction) => {
      const { own, theirs, neighbour } = await cardWorldFor(direction);
      for (const party of [own.student, own.teacher]) {
        await expectHiddenTo(get, party, theirs.enrollmentId);
      }
      for (const party of [neighbour.student, neighbour.teacher]) {
        await expectHiddenTo(get, party, own.enrollmentId);
      }
      await expectRead(own);
      await expectRead(theirs);
    },
    forgedId: async (direction) => {
      const { own, theirs, neighbour } = await cardWorldFor(direction);
      for (const forged of [
        theirs.enrollmentId,
        neighbour.enrollmentId,
        own.student.userId,
        own.teacher.userId,
        theirs.student.userId,
        theirs.teacher.userId,
      ]) {
        await expectHiddenTo(get, own.student, forged);
        await expectHiddenTo(get, own.teacher, forged);
      }
      await expectRead(own);
    },
    guessedId: async (direction) => {
      const { own } = await cardWorldFor(direction);
      for (const guessed of [
        randomUUID(),
        randomUUID(),
        neighbourOf(own.enrollmentId),
        neighbourOf(own.enrollmentId).toUpperCase(),
      ]) {
        await expectHiddenTo(get, own.student, guessed);
      }
      await expectRead(own);
    },
    tamperedToken: async (direction) => {
      const { surface, own, theirs } = await cardWorldFor(direction);
      for (const token of tamperedTokens(
        direction,
        own.student.accessToken,
        theirs.student.sessionId,
      )) {
        const tampered = await surface.bearing(token);
        await expectUnauthenticated(() =>
          get({ ...own.student, caller: tampered }, own.enrollmentId),
        );
      }
      await expectRead(own);
    },
    clientSuppliedGender: async (direction) => {
      const { own, theirs } = await cardWorldFor(direction);
      await expectHiddenTo(get, own.student, theirs.enrollmentId, { gender: direction.other });
      await expectHiddenTo(get, own.teacher, theirs.enrollmentId, { gender: direction.other });
      await expectRead(own, { gender: direction.other });
    },
  },
};

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
  // 006:T018.
  getAttacks,
];

// ---------------------------------------------------------------------------------------------
// 006:T022 (B-P4, (2); SC-707): the suite-level check
// ---------------------------------------------------------------------------------------------

/** A UUID, removed before the digit checks: its hex groups are ids, never card digits. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** A PAN-like run: 13 digits or more in one run (a card number is 13 to 19). */
const PAN_RUN = /\d{13,}/;
/** A PAN written in groups of four, as a card prints it (`4111 1111 1111 1111`). */
const PAN_GROUPED = /(?<!\d)\d{4}(?:[ -]\d{4}){2}[ -]\d{1,7}(?!\d)/;
/** An expiry, MM/YY or MM/YYYY, not part of a longer path of digits. */
const EXPIRY = /(?<![\d/])(?:0[1-9]|1[0-2]) ?\/ ?(?:\d{2}|20\d{2})(?![\d/])/;
/** A card field's name as a JSON key: none is in any contract of the programme. */
const CARD_FIELD =
  /"(?:token|cardToken|card_token|pan|cardNumber|card_number|expiry|expiryMonth|expiryYear|expMonth|expYear|exp_month|exp_year|holderName|cardholderName|cardHolder|holder_name)"\s*:/i;

/** The card details SC-707 names that `text` carries: the token, a PAN, an expiry, a card field. */
export function cardDetailsIn(text: string, tokens: readonly string[]): string[] {
  const found: string[] = [];
  if (tokens.some((token) => text.includes(token))) found.push('token');
  const digits = text.replace(UUID, '<uuid>');
  if (PAN_RUN.test(digits) || PAN_GROUPED.test(digits)) found.push('pan');
  if (EXPIRY.test(digits)) found.push('expiry');
  if (CARD_FIELD.test(text)) found.push('field');
  return found;
}

/** The audit entries naming one of the run's enrollments or parties, whole, as JSON. */
async function auditEntriesOfTheRun(): Promise<string[]> {
  const rows = await cardsClient().auditLog.findMany({
    where: { targetId: { in: [...runIds] } },
    orderBy: { id: 'asc' },
    select: {
      action: true,
      targetType: true,
      targetId: true,
      targetLabel: true,
      reason: true,
      before: true,
      after: true,
    },
  });
  return rows.map((row) => JSON.stringify(row));
}

/**
 * 006:T022 (SC-707): run by `procedure-harness.spec.ts` after every registration's attacks, so it
 * reads what the programme attacks answered. The check finds no card detail in any programme answer
 * or refusal of the run, nor in an audit entry naming the run's enrollments or parties. A log line
 * is not read here: the world's logger is silent (the question in the B-P4 lane i report).
 */
export function describeProgrammeCardDetailCheck(): void {
  describe('SC-707: no card detail in what the programme attacks answered (006:T022)', () => {
    it.each([
      ['the token', '{"brand":"Visa fixture-token"}', 'token'],
      ['a PAN in one run', '{"brand":"4111111111111111"}', 'pan'],
      ['a PAN in groups of four', '{"brand":"4111 1111 1111 1111"}', 'pan'],
      ['an expiry MM/YY', '{"brand":"Visa 12/29"}', 'expiry'],
      ['an expiry MM/YYYY', '{"brand":"Visa 07/2031"}', 'expiry'],
      ['a card field', '{"card":{"last4":"4242","expiry":"x"}}', 'field'],
    ])('finds %s in a fixture', (_name, text, kind) => {
      expect(cardDetailsIn(text, ['fixture-token'])).toEqual([kind]);
    });

    it('finds none in a clean answer: ids, a checkout address, an instant, the card shown, amounts', () => {
      const token = 'fixture-token';
      expect(
        cardDetailsIn(
          JSON.stringify({
            enrollmentId: '0193a8f2-1234-5678-9012-345abcdef012',
            checkoutUrl:
              'http://127.0.0.1:61234/stand-in/checkout/fake_ord_0193a8f2-1234-5678-9012-345abcdef012',
            payBy: '2026-11-25T18:00:00.000Z',
            card: CARD,
            total_piasters: 1_600_000,
          }),
          [token],
        ),
      ).toEqual([]);
    });

    it(
      'finds none in the programme answers and the audit entries of the run',
      { tags: ['database'] },
      async () => {
        expect(responses.length, 'the programme attacks ran first, in this file').toBeGreaterThan(
          0,
        );
        expect(
          responses.some((answer) => answer.includes(`"last4":"${CARD.last4}"`)),
          'a saved card was read, so the check reads the card path',
        ).toBe(true);
        const leaks = responses.flatMap((answer) =>
          cardDetailsIn(answer, [CARD_TOKEN]).map((kind) => `${kind}: ${answer.slice(0, 200)}`),
        );
        expect(leaks).toEqual([]);
        const audits = await auditEntriesOfTheRun();
        expect(audits.flatMap((entry) => cardDetailsIn(entry, [CARD_TOKEN]))).toEqual([]);
      },
    );
  });
}
