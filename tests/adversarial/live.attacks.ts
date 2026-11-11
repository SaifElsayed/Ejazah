// T063 of specs/004-sessions — `live.events`' attacks, registered with the procedure harness as its
// router lands (FR-428, FR-496; research R-324; contracts/app-surface.md, "`live`"). T066 adds a chat
// and a cancellation between A and B that never reach C, both directions.
//
// The world is the real user surface over HTTP (`createApplication` with the real `appRouter`), as
// the phone reaches it: a registry over the in-process bus, the bearer resolved per request, and,
// for each gender, an active student and a suspended one. Every attack runs in both directions
// (FR-064): the requester's gender against the other's.
//
//   directCall            an anonymous open refused UNAUTHENTICATED and a restricted standing
//                         ACCOUNT_RESTRICTED, no stream opened; the requester's own stream receives
//                         an event addressed to them and never one addressed to the other gender's
//                         student (the server addresses every event; the client chooses no topic).
//                         T066: a chat and a cancellation between A and B, the requester's student
//                         and teacher, sent through the real `chat.send` and `sessions.cancellation`
//                         over HTTP, reach A's and B's streams only, never C's: the other gender's
//                         student, nor a stranger of A's own gender.
//   forgedId              an input naming another user, or another sign-in session, refused: the
//                         channel takes no input, so there is no topic to forge.
//   guessedId             not applicable: the channel takes no id at all.
//   tamperedToken         the requester's bearer in the URL (`connectionParams`) refused before
//                         tRPC, and a bearer with its signature changed refused UNAUTHENTICATED.
//   clientSuppliedGender  an input carrying the other gender refused as an input; the events are the
//                         server's to address.
import { expect, vi } from 'vitest';

import { addHours } from '../../packages/time/src/index.js';
import { createApplication } from '../../apps/api/src/app.module.js';
import {
  type ChatDependencies,
  type ChatEnrollments,
  createChatServices,
} from '../../apps/api/src/modules/chat/index.js';

/** The chat store the services take, through the module's public entry (R-API-3). */
type ChatStore = NonNullable<ChatDependencies['store']>;
import {
  type CancellationStore,
  createSessionsServices,
  type EnrollmentSide,
  type SessionsStore,
} from '../../apps/api/src/modules/sessions/index.js';
import type { Transaction } from '../../apps/api/src/platform/db/prisma.repository.js';
import type { Transactions } from '../../apps/api/src/platform/db/transaction.repository.js';
import type { IdempotentRequest } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import { RateLimiter } from '../../apps/api/src/platform/guards/rate-limit.guard.js';
import { InProcessLiveBus } from '../../apps/api/src/platform/live/live-bus.js';
import { LiveRegistry } from '../../apps/api/src/platform/live/live-registry.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import type { UserSession } from '../../apps/api/src/surfaces/context.js';
import {
  unusedAdminServices,
  unusedBookingServices,
  unusedCatalogServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../apps/api/src/surfaces/services.fixtures.js';
import { type Direction, notApplicable, type ProcedureAttacks } from './procedure-harness.js';

const HOLDS = 'FR-428, FR-496, R-SEC-2, R-324';

type Gender = Direction['requester'];

const STUDENT: Readonly<Record<Gender, string>> = {
  male: '0199d0a0-0000-7000-8000-0000000e1001',
  female: '0199d0a0-0000-7000-8000-0000000e1002',
};
const SUSPENDED: Readonly<Record<Gender, string>> = {
  male: '0199d0a0-0000-7000-8000-0000000e1003',
  female: '0199d0a0-0000-7000-8000-0000000e1004',
};
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000e1e01';
// T066: for each gender, a teacher with an enrollment of that gender's student (A and B), its one
// session, and a stranger student of the same gender (a C beside the other gender's student).
const TEACHER: Readonly<Record<Gender, string>> = {
  male: '0199d0a0-0000-7000-8000-0000000e1005',
  female: '0199d0a0-0000-7000-8000-0000000e1006',
};
const STRANGER: Readonly<Record<Gender, string>> = {
  male: '0199d0a0-0000-7000-8000-0000000e1007',
  female: '0199d0a0-0000-7000-8000-0000000e1008',
};
const ENROLLMENT_OF: Readonly<Record<Gender, string>> = {
  male: '0199d0a0-0000-7000-8000-0000000e1e11',
  female: '0199d0a0-0000-7000-8000-0000000e1e12',
};
const SESSION_OF: Readonly<Record<Gender, string>> = {
  male: '0199d0a0-0000-7000-8000-0000000e1511',
  female: '0199d0a0-0000-7000-8000-0000000e1512',
};
const GENDERS = ['male', 'female'] as const;

function sessionOf(
  userId: string,
  gender: Gender,
  suspended = false,
  role: 'student' | 'teacher' = 'student',
): UserSession {
  return {
    userId,
    sessionId: `${userId}-session`,
    role,
    gender,
    preferredLanguage: 'ar',
    accountStatus: suspended ? 'suspended' : 'active',
    accessExpiresAt: new Date(addHours(new Date(), 1)),
  };
}

/** The bearer each fixture account presents: one token per account, `<kind>-<gender>`. */
const bearers: Readonly<Record<string, UserSession>> = {
  'student-male': sessionOf(STUDENT.male, 'male'),
  'student-female': sessionOf(STUDENT.female, 'female'),
  'suspended-male': sessionOf(SUSPENDED.male, 'male', true),
  'suspended-female': sessionOf(SUSPENDED.female, 'female', true),
  'teacher-male': sessionOf(TEACHER.male, 'male', false, 'teacher'),
  'teacher-female': sessionOf(TEACHER.female, 'female', false, 'teacher'),
  'stranger-male': sessionOf(STRANGER.male, 'male'),
  'stranger-female': sessionOf(STRANGER.female, 'female'),
};

/** Every fixture account's gender, as identity's records hold it. */
const GENDER_OF: ReadonlyMap<string, Gender> = new Map(
  Object.values(bearers).map(({ userId, gender }) => [userId, gender]),
);

const transactions: Transactions = { run: (work) => work({} as Transaction) };

/** The kernel's idempotency as the services see it: one outcome per key, replayed after. */
function keyedOnce() {
  const outcomes = new Map<string, unknown>();
  return {
    run: async <T>(request: IdempotentRequest, effect: (tx: Transaction) => Promise<T>) => {
      const key = `${request.scope}:${request.actorId}:${request.key}`;
      if (outcomes.has(key)) return outcomes.get(key) as T;
      const outcome = await transactions.run(effect);
      outcomes.set(key, outcome);
      return outcome;
    },
  };
}

const partiesOf = async (_tx: Transaction, userIds: readonly string[]) =>
  new Map(
    userIds.flatMap((userId) => {
      const gender = GENDER_OF.get(userId);
      return gender === undefined ? [] : [[userId, { gender }] as const];
    }),
  );

/** The real `chat.send` over the two enrollments, its messages kept in memory (T066). */
function chatOver() {
  let sent = 0;
  const enrollments: ChatEnrollments = {
    enrollmentFor: async (_tx, id) => {
      const gender = GENDERS.find((one) => ENROLLMENT_OF[one] === id);
      return gender === undefined
        ? null
        : {
            id,
            status: 'confirmed',
            studentUserId: STUDENT[gender],
            teacherUserId: TEACHER[gender],
          };
    },
    lockEnrollments: async () => undefined,
  };
  const store: ChatStore = {
    partiesOf,
    lockSender: async () => undefined,
    messagePage: async () => [],
    insertMessage: async (_tx, row) => {
      sent += 1;
      return {
        id: `0199d0a0-0000-7000-8000-0000000ef${String(sent).padStart(3, '0')}`,
        senderUserId: row.senderUserId,
        body: row.body,
        attachmentFilename: null,
        attachmentMime: null,
        sentAt: row.sentAt,
        purgedAt: null,
      };
    },
    attachmentOf: async () => null,
    insertAttachment: async () => {
      throw new Error('no document in this attack');
    },
  };
  return createChatServices({
    transactions,
    idempotency: keyedOnce(),
    settings: { read: async () => Promise.reject(new Error('chat.send reads no setting')) },
    enrollments,
    store,
    clock: async () => new Date(),
    storage: { temporaryLink: async () => 'https://files.invalid/none' },
  });
}

type RequestRow = Awaited<ReturnType<CancellationStore['requestById']>> & object;

/** The real `sessions.cancellation` over the two sessions, its requests kept in memory (T066). */
function cancellationOver(settings: SettingsReader) {
  const startsAt = new Date(addHours(new Date(), 24));
  const requests = new Map<string, RequestRow>();
  const sessionRow = (sessionId: string) => {
    const gender = GENDERS.find((one) => SESSION_OF[one] === sessionId);
    return gender === undefined
      ? null
      : {
          id: sessionId,
          enrollmentId: ENROLLMENT_OF[gender],
          studentUserId: STUDENT[gender],
          teacherUserId: TEACHER[gender],
          sequenceNumber: 1,
          makeupForSequenceNumber: null,
          localDate: '2026-11-20',
          startTimeLocal: '17:00:00',
          timezone: 'Africa/Cairo',
          startsAt,
          endsAt: new Date(addHours(startsAt, 1)),
          status: 'scheduled' as const,
        };
  };
  const ofParty = (sessionId: string, userId: string) => {
    const row = sessionRow(sessionId);
    return row !== null && (row.studentUserId === userId || row.teacherUserId === userId)
      ? row
      : null;
  };
  const store: CancellationStore = {
    sessionOfParty: async (_tx, sessionId, userId) => ofParty(sessionId, userId),
    requestOfParty: async (_tx, requestId, userId) => {
      const found = requests.get(requestId);
      return found !== undefined && ofParty(found.sessionId, userId) !== null ? found : null;
    },
    partiesOf,
    lockAccounts: async () => undefined,
    lockTeacherSlots: async () => undefined,
    lockSessions: async () => undefined,
    lockRemediesOf: async () => undefined,
    lockRequests: async () => undefined,
    pendingRequestOf: async (_tx, sessionId) =>
      [...requests.values()].find((row) => row.sessionId === sessionId && row.status === 'pending')
        ?.id ?? null,
    requestById: async (_tx, id) => requests.get(id) ?? null,
    insertRequest: async (_tx, row) => {
      const id = `0199d0a0-0000-7000-8000-0000000ec${String(requests.size + 1).padStart(3, '0')}`;
      requests.set(id, { id, ...row, status: 'pending' });
      return id;
    },
    answerRequest: async (_tx, id, answer) => {
      const found = requests.get(id);
      if (found?.status !== 'pending') return false;
      requests.set(id, { ...found, status: answer });
      return true;
    },
    cancelByAgreement: async () => true,
    recordEvents: async () => undefined,
  };
  return createSessionsServices({
    transactions,
    settings,
    video: {} as Parameters<typeof createSessionsServices>[0]['video'],
    enrollmentSide: { lockEnrollments: async () => undefined } as unknown as EnrollmentSide,
    store: {} as SessionsStore,
    idempotency: keyedOnce(),
    cancellationStore: store,
    clock: async () => new Date(),
    remedyOffer: { offerLocked: async () => null },
  });
}

interface LiveWorld {
  readonly origin: string;
  readonly registry: LiveRegistry;
  readonly bus: InProcessLiveBus;
}

let world: Promise<LiveWorld> | undefined;

/** The world, built once per file; its server is left to the worker's end. */
function liveWorld(): Promise<LiveWorld> {
  world ??= (async () => {
    const rows: Record<string, unknown> = {
      rate_limit_live_channel: { limit: 1_000, window_seconds: 60 },
      rate_limit_signed_in_default: { limit: 1_000, window_seconds: 60 },
      live_channel_max_connections_per_user: 3,
      // T066: `chat.send`'s own limit.
      rate_limit_chat_message: { limit: 1_000, window_seconds: 60 },
    };
    const settings: SettingsReader = {
      read: async (key, schema) => schema.parse(rows[key]),
    };
    const log = createLogger({ level: 'fatal' });
    const bus = new InProcessLiveBus();
    const registry = new LiveRegistry({ bus, settings, log });
    const application = await createApplication({
      log,
      readiness: { databaseReachable: async () => {} },
      securityHeaders: { allowedOrigins: [], mode: 'test' },
      maxRequestBodyBytes: 64 * 1024,
      administration: {
        transactions: { run: () => Promise.reject(new Error('no administrative call here')) },
        auditWriter: { write: () => Promise.reject(new Error('no administrative call here')) },
      },
      rateLimiter: new RateLimiter({
        settings,
        counter: { hit: async () => 1 },
        subjectKey: Buffer.alloc(32, 8),
      }),
      sessions: { user: async (bearer) => bearers[bearer] ?? null, admin: async () => null },
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
        // T066: the real cancellation and chat, over the fixture's enrollments and sessions.
        sessions: cancellationOver(settings),
        chat: chatOver(),
      },
      adminServices: unusedAdminServices,
      live: { bus, registry },
    });
    await application.listen(0, '127.0.0.1');
    (application.getHttpServer() as { unref(): void }).unref();
    const origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
    return { origin, registry, bus };
  })();
  return world;
}

interface Opened {
  readonly status: number;
  readonly frames: Array<{ readonly event: string | undefined; readonly data: string }>;
  readonly ended: () => boolean;
  readonly close: () => void;
}

/** Opens `live.events` at `url` with `bearer` in the `Authorization` header. */
async function open(bearer: string | null, url = '/trpc/live.events'): Promise<Opened> {
  const { origin } = await liveWorld();
  const controller = new AbortController();
  const response = await fetch(`${origin}${url}`, {
    headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` },
    signal: controller.signal,
  });
  const frames: Array<{ event: string | undefined; data: string }> = [];
  let ended = false;
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    try {
      for (;;) {
        const read = await reader?.read();
        if (read === undefined || read.done) break;
        buffer += decoder.decode(read.value, { stream: true });
        let end = buffer.indexOf('\n\n');
        while (end >= 0) {
          const raw = buffer.slice(0, end).replace(/^\n+/, '');
          buffer = buffer.slice(end + 2);
          if (raw !== '') {
            frames.push({
              event: /^event: (.*)$/m.exec(raw)?.[1],
              data: /^data: (.*)$/m.exec(raw)?.[1] ?? '',
            });
          }
          end = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // Closed by the attack.
    }
    ended = true;
  })();
  await vi.waitFor(() => expect(frames.length > 0 || ended).toBe(true));
  return { status: response.status, frames, ended: () => ended, close: () => controller.abort() };
}

/** The codes a stream was refused with, in its serialized errors. */
function refusalsOf(opened: Opened): unknown[] {
  return opened.frames
    .filter((frame) => frame.event === 'serialized-error')
    .map((frame) => (JSON.parse(frame.data) as { code?: unknown }).code);
}

/** The events a stream carried, connection and pings left out. */
function eventsOf(opened: Opened): unknown[] {
  return opened.frames
    .filter((frame) => frame.event === undefined)
    .map((frame) => JSON.parse(frame.data) as unknown);
}

/** A mutation of the user surface over HTTP, as the phone sends it; its answer's data. */
async function mutate(bearer: string, path: string, input: unknown): Promise<unknown> {
  const { origin } = await liveWorld();
  const response = await fetch(`${origin}/trpc/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const answer = (await response.json()) as { result?: { data?: unknown } };
  expect(response.status, `${path} answered`).toBe(200);
  return answer.result?.data;
}

/**
 * T066 (FR-496): a chat and a cancellation between A (the requester's student) and B (the
 * requester's teacher) reach A's and B's streams and never C's, the other gender's student, nor a
 * stranger of A's own gender; `mine` is each recipient's own.
 */
async function chatAndCancellationStayBetween(direction: Direction): Promise<void> {
  const own = direction.requester;
  const a = await open(`student-${own}`);
  const b = await open(`teacher-${own}`);
  const others = [await open(`student-${direction.other}`), await open(`stranger-${own}`)];
  const enrollmentId = ENROLLMENT_OF[own];
  const sessionId = SESSION_OF[own];
  try {
    await sendBetween(own, enrollmentId, sessionId);
    const chat = (body: string, mine: boolean) =>
      expect.objectContaining({
        type: 'chat',
        enrollmentId,
        message: expect.objectContaining({ body, mine }),
      });
    const session = { type: 'session', sessionId, enrollmentId };
    // Once A and B have each been sent their three, C's streams are read first: none reached them.
    await vi.waitFor(() => {
      expect(eventsOf(a).length).toBeGreaterThanOrEqual(3);
      expect(eventsOf(b).length).toBeGreaterThanOrEqual(3);
    });
    for (const other of others) expect(eventsOf(other)).toEqual([]);
    // A: both messages (its own as mine), then the answer to its request.
    await vi.waitFor(() =>
      expect(eventsOf(a)).toEqual([
        chat('السلام عليكم', true),
        chat('وعليكم السلام', false),
        session,
      ]),
    );
    // B: both messages (its own as mine), then the request it was asked.
    await vi.waitFor(() =>
      expect(eventsOf(b)).toEqual([
        chat('السلام عليكم', false),
        chat('وعليكم السلام', true),
        session,
      ]),
    );
  } finally {
    // Closed whatever the outcome, so a failure here never leaves a stream for the next attack.
    for (const stream of [a, b, ...others]) stream.close();
  }
}

/** A sends, B answers, A asks to cancel, B declines: each through the real procedure over HTTP. */
async function sendBetween(own: Gender, enrollmentId: string, sessionId: string): Promise<void> {
  await mutate(`student-${own}`, 'chat.send', {
    enrollmentId,
    body: 'السلام عليكم',
    idempotencyKey: `live-attack-chat-a-${own}`,
  });
  await mutate(`teacher-${own}`, 'chat.send', {
    enrollmentId,
    body: 'وعليكم السلام',
    idempotencyKey: `live-attack-chat-b-${own}`,
  });
  const requested = (await mutate(`student-${own}`, 'sessions.cancellation.request', {
    sessionId,
    reason: 'سفر',
    idempotencyKey: `live-attack-cancel-${own}`,
  })) as { requestId: string };
  await mutate(`teacher-${own}`, 'sessions.cancellation.answer', {
    requestId: requested.requestId,
    accept: false,
  });
}

/** Opens with an input, which the channel refuses: it takes none. */
async function expectInputRefused(bearer: string, input: unknown, userId: string): Promise<void> {
  const { registry } = await liveWorld();
  const opened = await open(
    bearer,
    `/trpc/live.events?input=${encodeURIComponent(JSON.stringify(input))}`,
  );
  await vi.waitFor(() => expect(opened.ended()).toBe(true));
  expect(refusalsOf(opened)).toEqual(['VALIDATION_FAILED']);
  expect(registry.count(userId)).toBe(0);
}

export const liveAttacks: readonly ProcedureAttacks[] = [
  {
    path: 'live.events',
    holds: HOLDS,
    attacks: {
      async directCall(direction) {
        const { bus, registry } = await liveWorld();
        const anonymous = await open(null);
        await vi.waitFor(() => expect(anonymous.ended()).toBe(true));
        expect(refusalsOf(anonymous)).toEqual(['UNAUTHENTICATED']);

        const restricted = await open(`suspended-${direction.requester}`);
        await vi.waitFor(() => expect(restricted.ended()).toBe(true));
        expect(refusalsOf(restricted)).toEqual(['ACCOUNT_RESTRICTED']);
        expect(registry.count(SUSPENDED[direction.requester])).toBe(0);

        const own = await open(`student-${direction.requester}`);
        const theirs = { type: 'enrollment', enrollmentId: ENROLLMENT } as const;
        bus.publish({ to: [STUDENT[direction.other]], event: theirs });
        const mine = { type: 'session', sessionId: ENROLLMENT, enrollmentId: ENROLLMENT } as const;
        bus.publish({ to: [STUDENT[direction.requester]], event: mine });
        await vi.waitFor(() => expect(eventsOf(own)).toEqual([mine]));
        own.close();
        await vi.waitFor(() => expect(registry.count(STUDENT[direction.requester])).toBe(0));

        await chatAndCancellationStayBetween(direction);
        await vi.waitFor(() => expect(registry.count(STUDENT[direction.requester])).toBe(0));
      },
      async forgedId(direction) {
        const bearer = `student-${direction.requester}`;
        const userId = STUDENT[direction.requester];
        await expectInputRefused(bearer, { userId: STUDENT[direction.other] }, userId);
        await expectInputRefused(bearer, { sessionId: `${STUDENT[direction.other]}-session` }, userId);
      },
      guessedId: notApplicable(
        'live.events takes no id: the server addresses every event to the user ids its own transaction read',
      ),
      async tamperedToken(direction) {
        const { origin, registry } = await liveWorld();
        const bearer = `student-${direction.requester}`;
        const params = encodeURIComponent(JSON.stringify({ authorization: `Bearer ${bearer}` }));
        const inUrl = await fetch(`${origin}/trpc/live.events?connectionParams=${params}`);
        expect(inUrl.status).toBe(400);
        expect(await inUrl.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

        const tampered = await open(`${bearer}x`);
        await vi.waitFor(() => expect(tampered.ended()).toBe(true));
        expect(refusalsOf(tampered)).toEqual(['UNAUTHENTICATED']);
        expect(registry.count(STUDENT[direction.requester])).toBe(0);
      },
      async clientSuppliedGender(direction) {
        await expectInputRefused(
          `student-${direction.requester}`,
          { gender: direction.other },
          STUDENT[direction.requester],
        );
      },
    },
  },
];
