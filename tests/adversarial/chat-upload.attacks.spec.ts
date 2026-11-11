// T038 of specs/004-sessions — `POST /uploads/chat`'s attacks (FR-496, SC-407; FR-489, FR-490,
// FR-432; R-GENDER-1, R-GENDER-2, R-GENDER-4; R-SEC-5), the route's own, since the procedure harness
// registers tRPC procedures only (`procedure-harness.ts`, `coverageFailures`). Each runs in both
// directions in the discovery world, the route mounted on its server as `main.ts` mounts it, on
// each gender's session pair (a student and a lone visible teacher with a confirmed enrollment).
//
// What every attack holds: an enrollment the uploader is not a party of, the other gender's pair's
// above all, answers byte for byte as an id that never existed (404, `NOT_FOUND`, no field), from
// either party; the uploader's own enrollment is answered 201, so no attack passes on a refusal of
// everything. Every document a case stores is removed after it, its row by id and its file by its
// exact key, and a corrected gender is restored in `finally`, so a failing case leaves the shared
// world as it found it (the review's conditions of 2026-11-11).
//
//   directCall            both parties upload to their own enrollment; the other gender's enrollment
//                         by its id, from either party; an image refused ATTACHMENT_REFUSED.
//   forgedId              the other pair's enrollment, a session's id and the parties' user ids.
//   guessedId             random ids, the other enrollment's neighbour and its upper-case spelling.
//   tamperedToken         a tampered bearer token: 401 before anything is read.
//   clientSuppliedGender  a `gender` field naming the other gender is ignored; after an
//                         administrator's correction of the teacher's gender the own enrollment
//                         answers as a nonexistent one, from either party, and 201 once restored.
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { neighbourOf, tamperedTokens } from './discovery.attacks.js';
import { discoverySurface, type SessionPair, type SessionParty } from './discovery-world.js';
import { type Direction, directions } from './procedure-harness.js';

/** A PDF's leading bytes, padded past the sniffing head. */
const DOCUMENT = Buffer.concat([Buffer.from('%PDF-1.4\n', 'latin1'), Buffer.alloc(200, 0x20)]);
// A real 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const ATTACK_TIMEOUT_MS = 180_000;

/** The messages the current case stored, removed after it whatever its outcome. */
const made: string[] = [];

afterEach(async () => {
  const surface = await discoverySurface();
  await surface.discardChatDocuments(made.splice(0));
});

async function pairsFor(direction: Direction) {
  const surface = await discoverySurface();
  const [own, theirs] = await Promise.all([
    surface.sessionPair(direction.requester),
    surface.sessionPair(direction.other),
  ]);
  return { surface, own, theirs };
}

const partiesOf = (pair: SessionPair) => [pair.student, pair.teacher] as const;

/** One upload as the phone sends it: the enrollment, the name, then the file. */
async function upload(
  accessToken: string,
  enrollmentId: string,
  file = DOCUMENT,
  extra: Readonly<Record<string, string>> = {},
): Promise<{ readonly status: number; readonly body: string }> {
  const surface = await discoverySurface();
  const response = await surface.uploadChat(
    accessToken,
    { enrollmentId, filename: 'درس.pdf', ...extra },
    file,
  );
  const body = await response.text();
  if (response.status === 201) made.push((JSON.parse(body) as { messageId: string }).messageId);
  return { status: response.status, body };
}

/** The enrollment answers the upload byte for byte as one that never existed. */
async function expectUploadHidden(
  party: SessionParty,
  enrollmentId: string,
  extra: Readonly<Record<string, string>> = {},
): Promise<void> {
  const absent = await upload(party.accessToken, randomUUID(), DOCUMENT, extra);
  expect(absent.status, 'a nonexistent enrollment answers 404 (R-GENDER-2)').toBe(404);
  expect(JSON.parse(absent.body)).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  const hidden = await upload(party.accessToken, enrollmentId, DOCUMENT, extra);
  expect(
    hidden,
    'a hidden enrollment answers byte for byte as a nonexistent one (R-GENDER-2)',
  ).toStrictEqual(absent);
}

/** The uploader's own enrollment is answered 201, the message stored. */
async function expectOwnUpload(
  party: SessionParty,
  enrollmentId: string,
  extra: Readonly<Record<string, string>> = {},
): Promise<void> {
  const answer = await upload(party.accessToken, enrollmentId, DOCUMENT, extra);
  expect(answer.status).toBe(201);
  expect(JSON.parse(answer.body)).toMatchObject({
    attachment: { filename: 'درس.pdf', mime: 'application/pdf' },
  });
}

const HOLDS = 'R-GENDER-1, R-GENDER-2, R-GENDER-4, R-SEC-5, FR-432, FR-489, FR-490, FR-496, SC-407';

describe(
  `the attacks on POST /uploads/chat (${HOLDS})`,
  {
    tags: ['database'],
    timeout: ATTACK_TIMEOUT_MS,
  },
  () => {
    for (const direction of directions) {
      it(`directCall: ${direction.name}`, async () => {
        const { surface, own, theirs } = await pairsFor(direction);
        for (const party of partiesOf(own)) {
          await expectOwnUpload(party, own.enrollmentId);
          await expectUploadHidden(party, theirs.enrollmentId);
        }
        const before = surface.chatStorage.calls.length;
        const image = await upload(own.student.accessToken, own.enrollmentId, PNG);
        expect(image.status).toBe(400);
        expect(JSON.parse(image.body)).toEqual({
          error: { code: 'ATTACHMENT_REFUSED', message: 'This file cannot be sent in the chat.' },
        });
        expect(surface.chatStorage.calls.slice(before)).toEqual([]);
      });

      it(`forgedId: ${direction.name}`, async () => {
        const { own, theirs } = await pairsFor(direction);
        for (const party of partiesOf(own)) {
          for (const forged of [
            theirs.enrollmentId,
            own.sessions.open,
            own.student.userId,
            own.teacher.userId,
          ]) {
            await expectUploadHidden(party, forged);
          }
        }
      });

      it(`guessedId: ${direction.name}`, async () => {
        const { own, theirs } = await pairsFor(direction);
        for (const guessed of [
          randomUUID(),
          neighbourOf(theirs.enrollmentId),
          theirs.enrollmentId.toUpperCase(),
        ]) {
          await expectUploadHidden(own.student, guessed);
        }
      });

      it(`tamperedToken: ${direction.name}`, async () => {
        const { surface, own, theirs } = await pairsFor(direction);
        const before = surface.chatStorage.calls.length;
        for (const token of tamperedTokens(
          direction,
          own.student.accessToken,
          theirs.student.sessionId,
        )) {
          const answer = await upload(token, own.enrollmentId);
          expect(answer.status).toBe(401);
          expect(JSON.parse(answer.body)).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
        }
        expect(surface.chatStorage.calls.slice(before)).toEqual([]);
      });

      it(`clientSuppliedGender: ${direction.name}`, async () => {
        const { surface, own, theirs } = await pairsFor(direction);
        const withGender = { gender: direction.other };
        await expectUploadHidden(own.student, theirs.enrollmentId, withGender);
        await expectOwnUpload(own.student, own.enrollmentId, withGender);
        // After an administrator's correction of the teacher's gender: the server's record.
        await surface.setGender(own.teacher.userId, direction.other);
        try {
          for (const party of partiesOf(own)) {
            await expectUploadHidden(party, own.enrollmentId);
          }
        } finally {
          await surface.setGender(own.teacher.userId, direction.requester);
        }
        await expectOwnUpload(own.student, own.enrollmentId);
      });
    }
  },
);
