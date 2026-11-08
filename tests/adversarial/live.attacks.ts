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
  unusedSessionsServices,
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

function sessionOf(userId: string, gender: Gender, suspended = false): UserSession {
  return {
    userId,
    sessionId: `${userId}-session`,
    role: 'student',
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
};

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
        sessions: unusedSessionsServices,
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
