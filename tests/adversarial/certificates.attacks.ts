// T009 of specs/005-certification — `certificates.list`'s and `certificates.link`'s attacks
// (contracts/app-surface.md, «Adversarial suite»; FR-607, FR-609; R-412, R-413; R-GENDER-2,
// R-GENDER-4; R-HONEST-6; R-SEC-3). Both are student-reachable (the participant kind), so they are
// registrations of the procedure harness. Each runs in the discovery world (`discovery-world.ts`),
// over the module's router mounted under `certificates` (`DiscoverySurface.certificates`), on each
// gender's session pair: a student and a lone visible teacher with a confirmed enrollment, whose
// ijazahs the world writes signed off, not yet signed off and revoked (`issueIjazah`); the other
// gender's pair holds one signed off.
//
// What every attack holds: an ijazah the caller is not a party of, the other gender's pair's above
// all and the same gender's other student's, answers `link` exactly as an id that never existed
// (404, `NOT_FOUND`, no field) and never appears in `list`; the pair's own ijazah is answered to both
// parties (a link to the signed-off one, `not_ready` and `revoked` with no link for the others), so
// no attack passes on a refusal of everything.
//
//   directCall            both parties list their own and link the signed-off one; the other
//                         gender's ijazah by its id, from either party, and the own one from the
//                         same gender's student who is not a party.
//   forgedId              the other pair's ijazah, the own enrollment's and a session's id, the
//                         parties' user ids, sent as an ijazah id.
//   guessedId             random ids, the other ijazah's neighbour and its upper-case spelling.
//   tamperedToken         a tampered bearer token: 401 before anything is read.
//   clientSuppliedGender  `link`: a `gender` field naming the other gender is ignored; `list`: it
//                         takes no input, so any input is refused before the service and the
//                         caller's own list is unchanged.
import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import {
  expectUnauthenticated,
  neighbourOf,
  refusalOf,
  tamperedTokens,
} from './discovery.attacks.js';
import { type CertificatesCaller, discoverySurface, type SessionPair } from './discovery-world.js';
import {
  type Direction,
  expectAnswersAsNonexistent,
  notApplicable,
  type ProcedureAttacks,
} from './procedure-harness.js';

const HOLDS = 'R-GENDER-2, R-GENDER-4, R-HONEST-6, R-SEC-3, FR-607, FR-609, R-413';

/** The pair's three ijazahs, by state. */
interface PairIjazahs {
  readonly signed: string;
  readonly unsigned: string;
  readonly revoked: string;
}

interface Party {
  readonly userId: string;
  readonly certificates: CertificatesCaller;
}

/** Each gender's pair's ijazahs, written once per world. */
const issued = new Map<string, Promise<PairIjazahs>>();

async function ijazahsOf(pair: SessionPair): Promise<PairIjazahs> {
  const made = issued.get(pair.enrollmentId);
  if (made !== undefined) return made;
  const making = (async () => {
    const surface = await discoverySurface();
    return {
      signed: await surface.issueIjazah(pair, 'signed'),
      unsigned: await surface.issueIjazah(pair, 'unsigned'),
      revoked: await surface.issueIjazah(pair, 'revoked'),
    };
  })();
  issued.set(pair.enrollmentId, making);
  return making;
}

/** The requester's pair, the other gender's, their ijazahs and every caller an attack needs. */
async function worldFor(direction: Direction) {
  const surface = await discoverySurface();
  const [own, theirs] = await Promise.all([
    surface.sessionPair(direction.requester),
    surface.sessionPair(direction.other),
  ]);
  const [ownIjazahs, theirIjazahs] = await Promise.all([ijazahsOf(own), ijazahsOf(theirs)]);
  const outsider = surface.student(direction.requester);
  const [student, teacher, stranger] = await Promise.all([
    surface.certificates(own.student.accessToken),
    surface.certificates(own.teacher.accessToken),
    surface.certificates(outsider.accessToken),
  ]);
  const parties: readonly Party[] = [
    { userId: own.student.userId, certificates: student },
    { userId: own.teacher.userId, certificates: teacher },
  ];
  return {
    surface,
    own,
    theirs,
    ownIjazahs,
    theirIjazahs,
    parties,
    stranger: { userId: outsider.userId, certificates: stranger },
  };
}

function linkOf(caller: CertificatesCaller, ijazahId: string, extra: object = {}) {
  return caller.certificates.link({ ijazahId, ...extra } as never);
}

/** The ijazah answers `link` as one that never existed. */
function expectIjazahHidden(caller: CertificatesCaller, ijazahId: string): Promise<void> {
  return expectAnswersAsNonexistent(
    () => linkOf(caller, ijazahId),
    () => linkOf(caller, randomUUID()),
  );
}

/** The pair's own ijazahs answered as theirs: a link, `not_ready` and `revoked` with no link. */
async function expectOwnAnswered(
  caller: CertificatesCaller,
  ids: PairIjazahs,
  extra: object = {},
): Promise<void> {
  const { link } = await linkOf(caller, ids.signed, extra);
  expect(link).toMatch(/certificates%2F|certificates\//);
  for (const [id, code] of [
    [ids.unsigned, 'not_ready'],
    [ids.revoked, 'revoked'],
  ] as const) {
    const refusal = await refusalOf(() => linkOf(caller, id, extra));
    expect(refusal.status, code).toBe(409);
    expect(refusal.body.code, code).toBe('CONFLICT');
    expect(refusal.body.details, code).toEqual([{ path: 'ijazahId', code }]);
  }
}

/** The caller's list: the own three, none of another pair's. */
async function expectOwnList(
  caller: CertificatesCaller,
  own: PairIjazahs,
  others: readonly string[],
): Promise<void> {
  const { items } = await caller.certificates.list();
  const ids = items.map((item) => item.ijazahId);
  expect(ids).toEqual(expect.arrayContaining([own.signed, own.unsigned, own.revoked]));
  for (const other of others) expect(ids).not.toContain(other);
  expect(items.find((item) => item.ijazahId === own.revoked)).toMatchObject({
    revoked: true,
    ready: false,
  });
  expect(JSON.stringify(items)).not.toMatch(/certificates\//);
}

const listAttacks: ProcedureAttacks = {
  path: 'certificates.list',
  holds: HOLDS,
  attacks: {
    directCall: async (direction) => {
      const { parties, stranger, ownIjazahs, theirIjazahs } = await worldFor(direction);
      for (const party of parties) {
        await expectOwnList(party.certificates, ownIjazahs, [theirIjazahs.signed]);
      }
      const { items } = await stranger.certificates.certificates.list();
      const seen = items.map((item) => item.ijazahId);
      for (const id of [...Object.values(ownIjazahs), ...Object.values(theirIjazahs)]) {
        expect(seen, 'a same-gender student who is not a party').not.toContain(id);
      }
    },
    forgedId: notApplicable(
      'certificates.list takes no input (its schema refuses any), so no id can be forged; the caller is the bearer’s (tamperedToken)',
    ),
    guessedId: notApplicable(
      'certificates.list takes no input (its schema refuses any), so no id can be guessed',
    ),
    tamperedToken: async (direction) => {
      const { surface, own, theirs } = await worldFor(direction);
      for (const token of tamperedTokens(
        direction,
        own.student.accessToken,
        theirs.student.sessionId,
      )) {
        const tampered = await surface.certificates(token);
        await expectUnauthenticated(() => tampered.certificates.list());
      }
    },
    clientSuppliedGender: async (direction) => {
      const { parties, ownIjazahs, theirIjazahs } = await worldFor(direction);
      for (const party of parties) {
        const refusal = await refusalOf(() =>
          (party.certificates.certificates.list as (input: unknown) => Promise<unknown>)({
            gender: direction.other,
            userId: theirIjazahs.signed,
          }),
        );
        expect(refusal.status).toBe(400);
        await expectOwnList(party.certificates, ownIjazahs, [theirIjazahs.signed]);
      }
    },
  },
};

const linkAttacks: ProcedureAttacks = {
  path: 'certificates.link',
  holds: HOLDS,
  attacks: {
    directCall: async (direction) => {
      const { parties, stranger, ownIjazahs, theirIjazahs } = await worldFor(direction);
      for (const party of parties) {
        await expectOwnAnswered(party.certificates, ownIjazahs);
        await expectIjazahHidden(party.certificates, theirIjazahs.signed);
      }
      for (const id of Object.values(ownIjazahs)) {
        await expectIjazahHidden(stranger.certificates, id);
      }
    },
    forgedId: async (direction) => {
      const { own, parties, theirIjazahs } = await worldFor(direction);
      for (const party of parties) {
        for (const forged of [
          theirIjazahs.signed,
          own.enrollmentId,
          own.sessions.open,
          own.student.userId,
          own.teacher.userId,
        ]) {
          await expectIjazahHidden(party.certificates, forged);
        }
      }
    },
    guessedId: async (direction) => {
      const { parties, theirIjazahs } = await worldFor(direction);
      for (const guessed of [
        randomUUID(),
        neighbourOf(theirIjazahs.signed),
        theirIjazahs.signed.toUpperCase(),
      ]) {
        for (const party of parties) await expectIjazahHidden(party.certificates, guessed);
      }
    },
    tamperedToken: async (direction) => {
      const { surface, own, theirs, ownIjazahs } = await worldFor(direction);
      for (const token of tamperedTokens(
        direction,
        own.student.accessToken,
        theirs.student.sessionId,
      )) {
        const tampered = await surface.certificates(token);
        await expectUnauthenticated(() => linkOf(tampered, ownIjazahs.signed));
      }
    },
    clientSuppliedGender: async (direction) => {
      const { parties, ownIjazahs, theirIjazahs } = await worldFor(direction);
      const withGender = { gender: direction.other };
      for (const party of parties) {
        await expectAnswersAsNonexistent(
          () => linkOf(party.certificates, theirIjazahs.signed, withGender),
          () => linkOf(party.certificates, randomUUID(), withGender),
        );
        await expectOwnAnswered(party.certificates, ownIjazahs, withGender);
      }
    },
  },
};

export const certificatesAttacks: readonly ProcedureAttacks[] = [listAttacks, linkAttacks];
