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
//   clientSuppliedGender  the input carrying the other gender is ignored; after an administrator's
//                         correction of the teacher's gender (`users.gender` changed in the world, as
//                         the server's record), the own enrollment answers as a nonexistent one, from
//                         either party, and again as theirs once restored.
import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import type { ChatListInput, ChatSendInput } from '../../packages/contracts/src/index.js';
import { expectUnauthenticated, neighbourOf, tamperedTokens } from './discovery.attacks.js';
import { type AppCaller, discoverySurface, type SessionPair } from './discovery-world.js';
import {
  type Direction,
  expectAnswersAsNonexistent,
  type ProcedureAttacks,
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

function attacksOn(procedure: Procedure): ProcedureAttacks {
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
        const { surface, own, theirs } = await pairsFor(direction);
        const withGender = { gender: direction.other };
        await expectAnswersAsNonexistent(
          () => call(own.student.caller, procedure, theirs.enrollmentId, withGender),
          () => call(own.student.caller, procedure, randomUUID(), withGender),
        );
        await expectOwnChat(own.student.caller, procedure, own.enrollmentId, withGender);
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
    },
  };
}

export const chatAttacks: readonly ProcedureAttacks[] = [attacksOn('list'), attacksOn('send')];
