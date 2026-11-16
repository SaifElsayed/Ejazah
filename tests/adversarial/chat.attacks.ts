// T037 of specs/004-sessions — `chat.list`'s and `chat.send`'s attacks, registered with the procedure
// harness as their router lands (FR-496, SC-407; FR-488, FR-432; R-GENDER-1, R-GENDER-2,
// R-GENDER-4). Each attack runs in the discovery world (`discovery-world.ts`), whose surface binds
// the chat services as `main.ts` does, over booking's side, on each gender's session pair: a student
// and a lone visible teacher of one gender with a confirmed enrollment (`sessionPair`).
//
// What every attack holds: an enrollment the requester is not a party of, the other gender's pair's
// above all, answers exactly as an id that never existed (404, `NOT_FOUND`, no field), from either
// procedure and either party; the requester's own enrollment is answered, so no attack passes on a
// refusal of everything.
//
//   directCall            both parties read and write their own chat, a message answered as theirs;
//                         the other gender's enrollment by its id, from either party.
//   forgedId              the other pair's enrollment, a session's id and the parties' user ids, sent
//                         as an enrollment id.
//   guessedId             ids never handed out: random ones, the other enrollment's neighbour and its
//                         upper-case spelling.
//   tamperedToken         a tampered bearer token: unauthenticated before any service.
//   clientSuppliedGender  the input carrying the other gender is ignored.
// T052 (FR-496's three kinds, Q2 (a)): otherSessionToken and replayedToken not applicable (no token
// is taken; `attachmentLink` issues a signed link that names the document, not a party, and both
// parties are answered one, so the other participant replaying it reaches nothing they could not
// ask for; a link issued before a gender correction lives until R-SEC-3's short expiry);
//   afterGenderCorrection after an administrator's correction of the teacher's gender (`users.gender`
//                         changed in the world, as the server's record), the own enrollment answers as
//                         a nonexistent one, from either party, and again as theirs once restored
//                         (moved from clientSuppliedGender unchanged).
import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import type {
  ChatAttachmentLinkInput,
  ChatListInput,
  ChatSendInput,
} from '../../packages/contracts/src/index.js';
import { expectUnauthenticated, neighbourOf, tamperedTokens } from './discovery.attacks.js';
import { type AppCaller, discoverySurface, type SessionPair } from './discovery-world.js';
import {
  type Direction,
  expectAnswersAsNonexistent,
  notApplicable,
  type SessionProcedureAttacks,
} from './procedure-harness.js';

const HOLDS = 'R-GENDER-1, R-GENDER-2, R-GENDER-4, FR-432, FR-488, FR-496, SC-407';

type Procedure = 'list' | 'send';

/** One call of `procedure` on `enrollmentId`, as the phone sends it; a send under a fresh key. */
function call(
  caller: AppCaller,
  procedure: Procedure,
  enrollmentId: string,
  extra: Record<string, unknown> = {},
): Promise<unknown> {
  return procedure === 'list'
    ? caller.chat.list({ enrollmentId, ...extra } as ChatListInput)
    : caller.chat.send({
        enrollmentId,
        body: 'السلام عليكم',
        idempotencyKey: `attack-${randomUUID()}`,
        ...extra,
      } as ChatSendInput);
}

/** The enrollment answers `procedure` as one that never existed. */
function expectChatHidden(
  caller: AppCaller,
  procedure: Procedure,
  enrollmentId: string,
): Promise<void> {
  return expectAnswersAsNonexistent(
    () => call(caller, procedure, enrollmentId),
    () => call(caller, procedure, randomUUID()),
  );
}

/** The requester's own enrollment is answered as theirs: a page, or the message sent as theirs. */
async function expectOwnChat(
  caller: AppCaller,
  procedure: Procedure,
  enrollmentId: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const answer = (await call(caller, procedure, enrollmentId, extra)) as {
    messages?: unknown;
    mine?: unknown;
  };
  if (procedure === 'list') expect(Array.isArray(answer.messages)).toBe(true);
  else expect(answer.mine).toBe(true);
}

/** The requester's pair and the other gender's, in the world built once per file. */
async function pairsFor(direction: Direction) {
  const surface = await discoverySurface();
  const [own, theirs] = await Promise.all([
    surface.sessionPair(direction.requester),
    surface.sessionPair(direction.other),
  ]);
  return { surface, own, theirs };
}

/** Both parties of `pair`, as callers. */
const partiesOf = (pair: SessionPair) => [pair.student, pair.teacher] as const;

function attacksOn(procedure: Procedure): SessionProcedureAttacks {
  return {
    path: `chat.${procedure}`,
    holds: HOLDS,
    attacks: {
      async directCall(direction) {
        const { own, theirs } = await pairsFor(direction);
        for (const party of partiesOf(own)) {
          await expectOwnChat(party.caller, procedure, own.enrollmentId);
          await expectChatHidden(party.caller, procedure, theirs.enrollmentId);
        }
      },
      async forgedId(direction) {
        const { own, theirs } = await pairsFor(direction);
        for (const party of partiesOf(own)) {
          for (const forged of [
            theirs.enrollmentId,
            own.sessions.open,
            own.student.userId,
            own.teacher.userId,
          ]) {
            await expectChatHidden(party.caller, procedure, forged);
          }
        }
      },
      async guessedId(direction) {
        const { own, theirs } = await pairsFor(direction);
        for (const guessed of [
          randomUUID(),
          neighbourOf(theirs.enrollmentId),
          theirs.enrollmentId.toUpperCase(),
        ]) {
          await expectChatHidden(own.student.caller, procedure, guessed);
        }
      },
      async tamperedToken(direction) {
        const { surface, own, theirs } = await pairsFor(direction);
        for (const token of tamperedTokens(
          direction,
          own.student.accessToken,
          theirs.student.sessionId,
        )) {
          const tampered = await surface.bearing(token);
          await expectUnauthenticated(() => call(tampered, procedure, own.enrollmentId));
        }
      },
      async clientSuppliedGender(direction) {
        const { own, theirs } = await pairsFor(direction);
        const withGender = { gender: direction.other };
        await expectAnswersAsNonexistent(
          () => call(own.student.caller, procedure, theirs.enrollmentId, withGender),
          () => call(own.student.caller, procedure, randomUUID(), withGender),
        );
        await expectOwnChat(own.student.caller, procedure, own.enrollmentId, withGender);
      },
      async afterGenderCorrection(direction) {
        const { surface, own } = await pairsFor(direction);
        // After an administrator's correction of the teacher's gender: the server's record.
        await surface.setGender(own.teacher.userId, direction.other);
        try {
          for (const party of partiesOf(own)) {
            await expectChatHidden(party.caller, procedure, own.enrollmentId);
          }
        } finally {
          await surface.setGender(own.teacher.userId, direction.requester);
        }
        await expectOwnChat(own.student.caller, procedure, own.enrollmentId);
      },
      otherSessionToken: notApplicable(
        `chat.${procedure} issues no token and takes none: it names an enrollment by id (forgedId, guessedId, a session id sent as one included) and its caller by the bearer (tamperedToken)`,
      ),
      replayedToken: notApplicable(
        `chat.${procedure} issues no token, so the other participant has none of the caller’s to replay; both parties are answered their own chat (directCall)`,
      ),
    },
  };
}

export const chatAttacks: readonly SessionProcedureAttacks[] = [
  attacksOn('list'),
  attacksOn('send'),
];

// T038 of specs/004-sessions — `chat.attachmentLink`'s attacks (FR-496, SC-407; FR-489, FR-432;
// R-GENDER-1, R-GENDER-2, R-GENDER-4; R-SEC-3), in the same world, on a document each pair's student
// uploads through `POST /uploads/chat` for the attack and removes after it, row and file, whatever
// the outcome (`discardChatDocuments`): a message of the other gender's pair, a forged or a guessed
// id, from either party, answers exactly as an id that never existed; the requester's own document
// is answered a link, so no attack passes on a refusal of everything.
//
//   directCall            both parties of the pair get a link to its document; the other gender's
//                         document by its id, from either party.
//   forgedId              the other pair's document, the own enrollment's and a session's id, the
//                         parties' user ids, sent as a message id.
//   guessedId             random ids, the other document's neighbour and its upper-case spelling.
//   tamperedToken         a tampered bearer token: unauthenticated before any service.
//   clientSuppliedGender  the input carrying the other gender is ignored.
// T052: otherSessionToken and replayedToken not applicable (their reasons below);
//   afterGenderCorrection after an administrator's correction of the teacher's gender the own
//                         document answers as a nonexistent one, from either party, and again as
//                         theirs once restored (moved from clientSuppliedGender unchanged).
const LINK_HOLDS = 'R-GENDER-1, R-GENDER-2, R-GENDER-4, R-SEC-3, FR-432, FR-489, FR-496, SC-407';

/** A PDF's leading bytes, padded past the sniffing head. */
const DOCUMENT = Buffer.concat([Buffer.from('%PDF-1.4\n', 'latin1'), Buffer.alloc(200, 0x20)]);

/** One link to `messageId`, as the phone asks it. */
function linkOf(caller: AppCaller, messageId: string, extra: Record<string, unknown> = {}) {
  return caller.chat.attachmentLink({ messageId, ...extra } as ChatAttachmentLinkInput);
}

/** The document answers the link as one that never existed. */
function expectDocumentHidden(caller: AppCaller, messageId: string): Promise<void> {
  return expectAnswersAsNonexistent(
    () => linkOf(caller, messageId),
    () => linkOf(caller, randomUUID()),
  );
}

/** The requester's own document is answered a link. */
async function expectOwnLink(caller: AppCaller, messageId: string, extra = {}): Promise<void> {
  const answer = await linkOf(caller, messageId, extra);
  expect(answer.url).toMatch(/chat%2F|chat\//);
}

/**
 * Runs `attack` with a document uploaded by each pair's student, both removed after it, row and
 * file, whatever the attack's outcome.
 */
async function withDocuments(
  direction: Direction,
  attack: (pairs: {
    readonly surface: Awaited<ReturnType<typeof discoverySurface>>;
    readonly own: SessionPair;
    readonly theirs: SessionPair;
    readonly ownDocument: string;
    readonly theirDocument: string;
  }) => Promise<void>,
): Promise<void> {
  const { surface, own, theirs } = await pairsFor(direction);
  const made: string[] = [];
  try {
    for (const pair of [own, theirs]) {
      const response = await surface.uploadChat(
        pair.student.accessToken,
        { enrollmentId: pair.enrollmentId, filename: 'درس.pdf' },
        DOCUMENT,
      );
      expect(response.status).toBe(201);
      made.push(((await response.json()) as { messageId: string }).messageId);
    }
    const [ownDocument, theirDocument] = made as [string, string];
    await attack({ surface, own, theirs, ownDocument, theirDocument });
  } finally {
    await surface.discardChatDocuments(made);
  }
}

const linkAttacks: SessionProcedureAttacks = {
  path: 'chat.attachmentLink',
  holds: LINK_HOLDS,
  attacks: {
    directCall: (direction) =>
      withDocuments(direction, async ({ own, ownDocument, theirDocument }) => {
        for (const party of partiesOf(own)) {
          await expectOwnLink(party.caller, ownDocument);
          await expectDocumentHidden(party.caller, theirDocument);
        }
      }),
    forgedId: (direction) =>
      withDocuments(direction, async ({ own, theirDocument }) => {
        for (const party of partiesOf(own)) {
          for (const forged of [
            theirDocument,
            own.enrollmentId,
            own.sessions.open,
            own.student.userId,
            own.teacher.userId,
          ]) {
            await expectDocumentHidden(party.caller, forged);
          }
        }
      }),
    guessedId: (direction) =>
      withDocuments(direction, async ({ own, theirDocument }) => {
        for (const guessed of [
          randomUUID(),
          neighbourOf(theirDocument),
          theirDocument.toUpperCase(),
        ]) {
          await expectDocumentHidden(own.student.caller, guessed);
        }
      }),
    tamperedToken: (direction) =>
      withDocuments(direction, async ({ surface, own, theirs, ownDocument }) => {
        for (const token of tamperedTokens(
          direction,
          own.student.accessToken,
          theirs.student.sessionId,
        )) {
          const tampered = await surface.bearing(token);
          await expectUnauthenticated(() => linkOf(tampered, ownDocument));
        }
      }),
    clientSuppliedGender: (direction) =>
      withDocuments(direction, async ({ own, ownDocument, theirDocument }) => {
        const withGender = { gender: direction.other };
        await expectAnswersAsNonexistent(
          () => linkOf(own.student.caller, theirDocument, withGender),
          () => linkOf(own.student.caller, randomUUID(), withGender),
        );
        await expectOwnLink(own.student.caller, ownDocument, withGender);
      }),
    otherSessionToken: notApplicable(
      'chat.attachmentLink takes no token: it names a message by id (forgedId, guessedId, an enrollment’s and a session’s id sent as one included) and its caller by the bearer (tamperedToken)',
    ),
    replayedToken: notApplicable(
      'chat.attachmentLink’s link names the document, not a party: both parties of the enrollment are answered a link to it (directCall), so the other participant replaying one reaches nothing they could not ask for; R-SEC-3’s expiry is the storage’s',
    ),
    afterGenderCorrection: (direction) =>
      withDocuments(direction, async ({ surface, own, ownDocument }) => {
        // After an administrator's correction of the teacher's gender: the server's record.
        await surface.setGender(own.teacher.userId, direction.other);
        try {
          for (const party of partiesOf(own)) {
            await expectDocumentHidden(party.caller, ownDocument);
          }
        } finally {
          await surface.setGender(own.teacher.userId, direction.requester);
        }
        await expectOwnLink(own.student.caller, ownDocument);
      }),
  },
};

export const chatDocumentAttacks: readonly SessionProcedureAttacks[] = [linkAttacks];
