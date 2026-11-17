// T028 — the world the adversarial cases of `discovery` run in (FR-410, SC-304, SC-314; R-GENDER-1,
// R-GENDER-2, R-GENDER-3, R-GENDER-5; SRS §3.7.1 as amended 2026-10-31, ADR 0006, ADR 0007).
//
// THE REAL SURFACE. Every case calls the user surface's real `appRouter` through its caller kinds:
// the student kind, the declared rate limit, the input and output schemas, and the one error
// formatter. Its `discovery` services are the ones `main.ts` binds: catalog's
// `createDiscoveryCatalog(settings, storage)` composed by booking's `createDiscoveryServices`, each
// catalog call in a read transaction of its own over `transactionsOver(database)`. The caller is the
// session the identity module's own resolver reads from a bearer token issued by a real sign-in, so
// the requester's gender is the account's, from the database, never from input (R-GENDER-4). The
// settings are the seeded values of `prisma/seed.ts` read through a fixed reader, as the other
// database specs read them, so no case depends on the seed.
//
// THE TEACHERS. Seeded once per spec file and committed, since every procedure reads in a
// transaction of its own: for each gender, three visible teachers (two whose names fold to one
// spelling and share a prefix, written once with every variant FR-333 folds and once plain, and a
// third whose name does not begin with it) and one teacher in each excluded state of SRS §3.7.1 and
// `002:T143`: the account suspended or banned; the application pending, rejected, suspended, revoked
// or banned; the payout account never verified; the payout account replaced and not yet verified
// again (through the identity module's real `teacher.payout.register`, FR-193, FR-315); and the
// account soft-deleted. Every excluded teacher's name shares the visible ones' prefix (SC-314). A
// teacher of the other gender, in any state, is excluded too, so each direction meets every state.
// Every name begins with the world's own `prefix` (eight hex characters, then a space; `ijazah_fold`
// leaves them as they are), so no other world, of this run or another, bears one of its names
// (003:T079, decision 10 of specs/004-sessions/plan.md); every name search types it first
// (`nameQuery`).
//
// Every teacher teaches the world's shared subject and one private subject no one else teaches,
// with an active package of each track in the shared subject and one in the private subject; the
// shared subject's approved credential carries a riwaya of its own for an excluded teacher (so a
// leaked value is told apart) and a common one for a visible teacher, and the private subject's
// carries the common riwaya for everyone (so the riwaya filter has a candidate to leak). Other specs
// commit teachers to this database at the same time, so every exact answer is read inside the
// world's own subjects; an answer across all subjects is checked for leaks only, and the tab of all
// subjects against the predicate's teachers read in SQL from the SRS text (`allTabIds`).
// T070: the shared subject's Arabic name is written with every variant FR-333 folds, then a tag of
// its own, so a search by a subject's name is attacked in both directions, and a search typed with
// its whole name and tag is an exact answer across all subjects.
// T032: every teacher, in every state, also has one active slot of the packages' length (Thursday
// 09:00 in Cairo), and its package and slot ids are kept, so `booking.slots` is attacked in the same
// world (`booking.attacks.ts`).
// T036: the surface's `checkout` is the one `main.ts` binds, over the stand-in gateway this file
// already serves, so `checkout.hold`, `checkout.retry` and `checkout.pay` are attacked in the same world
// (`checkout.attacks.ts`).
// T043: a refusal is read back for "nothing written" (`checkoutRows`), a teacher's standing is
// changed in place as the world seeds every state (`setAccountStatus`), and a teacher's account is
// deleted through identity's real deletion (`deleteAccount`, FR-141), for `checkout-standing.spec.ts`
// (since T080 of specs/004-sessions refuses the person's own deletion over an ongoing enrollment, an
// administrator's at the owner's request, T081, as the administrator kind runs it);
// an administrator suspends a teacher through identity's real `StandingService` (`suspend`), and both
// reach booking's T041 subscriber on the one `AccountConsequences`, bound as `main.ts` binds it.
// T049: the surface's `booking` services carry the lists, so `enrollments.list` and
// `enrollments.get` are attacked in the same world (`enrollments.attacks.ts`).
// T011 of specs/004-sessions: the surface's `sessions` services are the ones `main.ts` binds, over
// the video stand-in the configuration chooses (its calls recorded, `video`), so `sessions.get`
// and `sessions.join` are attacked in the same world (`sessions.attacks.ts`): for each gender, a
// pair of its own (`sessionPair`), a lone visible teacher signed in and a student, both named
// through the world's prefix, with a confirmed enrollment and three sessions, one inside its join
// period, one not yet open and one over; and an administrator's gender correction is the server's
// record changed in place (`setGender`; the note under T011, K2).
//
// NOTHING STAYS VISIBLE. At the end of the file every account the world created is soft-deleted and
// every subject deactivated, so a later run, or another spec, never meets these teachers.
//
// THE GATEWAY. A replaced payout account becomes verified only by a signed `recipient_verified`
// event (FR-PAYG-14, FR-PAYG-16): the stand-in's harness (`tests/support/gateway-stand-in.ts`, the
// only way a spec produces a gateway event, SC-302) sends it over HTTP to the payments module's real
// webhook route, mounted under `PAYMENT_WEBHOOK_PATH` on a server of this file, as
// `tests/payments/webhook-forgery.spec.ts` mounts it.
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll } from 'vitest';

import {
  createBookingServices,
  createDiscoveryServices,
  createEnrollmentSide,
  createOngoingEnrollments,
  terminationSubscriber,
} from '../../apps/api/src/modules/booking/index.js';
import {
  createDiscoveryCatalog,
  revokeSubjects,
} from '../../apps/api/src/modules/catalog/index.js';
// T006 of specs/005-certification (rule d): the ijazah request, bound as `main.ts` binds it.
import {
  createIjazahRequestService,
  ijazahRequestsRouter,
} from '../../apps/api/src/modules/certification/index.js';
// T037 of specs/004-sessions.
import {
  CHAT_UPLOAD_PATH,
  createChatServices,
  createChatUploadRoute,
} from '../../apps/api/src/modules/chat/index.js';
import {
  AccountConsequences,
  createCertificateNameService,
  createIdentityServices,
  type IdentityServices,
  resolveUserSession,
  StandingService,
  standingStoreOver,
} from '../../apps/api/src/modules/identity/index.js';
import {
  createCheckoutServices,
  createPaymentWebhookRoute,
  orderStandingsOf,
  PAYMENT_WEBHOOK_PATH,
} from '../../apps/api/src/modules/payments/index.js';
import {
  createSessionsServices,
  sessionsStore,
} from '../../apps/api/src/modules/sessions/index.js';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption.js';
import { hashPassword } from '../../apps/api/src/platform/crypto/hashing.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { transactionsOver } from '../../apps/api/src/platform/db/transaction.repository.js';
import { RateLimiter } from '../../apps/api/src/platform/guards/rate-limit.guard.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import {
  bindToTransaction,
  RequestLive,
  unboundBus,
} from '../../apps/api/src/platform/live/live-publisher.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import {
  createPaymentPort,
  type PaymentConfig,
} from '../../apps/api/src/platform/ports/payment/index.js';
import { createVideoPort } from '../../apps/api/src/platform/ports/video/index.js';
import type { VideoPort } from '../../apps/api/src/platform/ports/video/video.port.js';
import { MemorySingleUseMarks } from '../../apps/api/src/platform/redis/single-use-marks.fixtures.js';
import {
  SettingError,
  type SettingsReader,
} from '../../apps/api/src/platform/settings/settings-reader.js';
import { appRouter } from '../../apps/api/src/surfaces/app.router.js';
import { type AppServices, createAppContext } from '../../apps/api/src/surfaces/context.js';
import { createAppCallerFactory, createAppRouter } from '../../apps/api/src/surfaces/procedures.js';
// T038 of specs/004-sessions: the chat's documents kept in memory, each operation recorded.
import { multipart, storageStub } from '../../apps/api/src/surfaces/upload-fixtures.js';
import {
  unusedCatalogServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../apps/api/src/surfaces/services.fixtures.js';
import type {
  BookingSlotsInput,
  BookingSlotsOutput,
  ChatAttachmentLinkInput,
  ChatAttachmentLinkOutput,
  ChatListInput,
  ChatListOutput,
  ChatSendInput,
  ChatSendOutput,
  CheckoutContinueInput,
  CheckoutContinueOutput,
  CheckoutCurrentOutput,
  CheckoutHoldInput,
  CheckoutHoldOutput,
  CheckoutPayInput,
  CheckoutPayOutput,
  CheckoutRetryInput,
  CheckoutRetryOutput,
  CheckoutStatusInput,
  CheckoutStatusOutput,
  DiscoveryBrowseInput,
  DiscoveryBrowseOutput,
  DiscoveryFiltersInput,
  DiscoveryFiltersOutput,
  DiscoveryTeacherInput,
  DiscoveryTeacherOutput,
  EnrollmentsGetInput,
  EnrollmentsGetOutput,
  EnrollmentsListInput,
  EnrollmentsListOutput,
  IjazahRequestsGetInput,
  IjazahRequestsGetOutput,
  IjazahRequestsPreviewInput,
  IjazahRequestsPreviewOutput,
  IjazahRequestsSendInput,
  IjazahRequestsSendOutput,
  SessionsCancellationAnswerInput,
  SessionsCancellationAnswerOutput,
  SessionsCancellationRequestInput,
  SessionsCancellationRequestOutput,
  SessionsComplaintRaiseInput,
  SessionsComplaintRaiseOutput,
  SessionsDisputeRaiseInput,
  SessionsDisputeRaiseOutput,
  SessionsGetInput,
  SessionsGetOutput,
  SessionsJoinInput,
  SessionsJoinOutput,
  SessionsRemedyAcceptInput,
  SessionsRemedyAcceptOutput,
  SessionsRemedyAnswerCounterInput,
  SessionsRemedyAnswerCounterOutput,
  SessionsRemedyChooseInput,
  SessionsRemedyChooseOutput,
  SessionsRemedyCounterInput,
  SessionsRemedyCounterOptionsInput,
  SessionsRemedyCounterOptionsOutput,
  SessionsRemedyCounterOutput,
} from '../../packages/contracts/src/index.js';
import { addDays, addMinutes } from '../../packages/time/src/index.js';
import { gatewayStandIn, type GatewayStandIn } from '../support/gateway-stand-in';

type Gender = 'male' | 'female';

/** A hold's minutes: the checkout's ten and the grace's five (the seeded settings). */
const HOLD_MINUTES = 15;

/** T011: a pair's sessions are an hour, the packages' length. */
const SESSION_MINUTES = 60;
/** T011: the open session starts in five minutes, inside the seeded fifteen of early join. */
const OPEN_SESSION_STARTS_IN_MINUTES = 5;
/** T011: the session not yet open starts in three days. */
const LATER_SESSION_STARTS_IN_MINUTES = 4_320;
/** T011: the session over started three hours ago, so it ended two hours ago. */
const PAST_SESSION_STARTS_IN_MINUTES = -180;
/** T026: the session ended for disputes started six hours ago, so it ended five hours ago. */
const ENDED_SESSION_STARTS_IN_MINUTES = -360;

/** The stand-in the configuration chooses, as `ports.module.ts` builds it, its calls recorded. */
function recordedVideo(encryptionKey: string): RecordedVideo {
  const port = createVideoPort({ VIDEO_PROVIDER: 'fake', ENCRYPTION_KEY: encryptionKey });
  const calls: RecordedVideo['calls'] = [];
  return {
    calls,
    createRoom: (...args) => {
      calls.push({ operation: 'createRoom', args });
      return port.createRoom(...args);
    },
    createSessionToken: (...args) => {
      calls.push({ operation: 'createSessionToken', args });
      return port.createSessionToken(...args);
    },
    verifyAndParseParticipantEvent: (...args) => port.verifyAndParseParticipantEvent(...args),
    endRoom: (...args) => port.endRoom(...args),
  };
}

export const GENDERS: readonly Gender[] = ['male', 'female'];

/** Every state of SRS §3.7.1 and `002:T143` that keeps a teacher of the requester's gender hidden. */
export const EXCLUDED_STATES = [
  'accountSuspended',
  'accountBanned',
  'verificationPending',
  'verificationRejected',
  'verificationSuspended',
  'verificationRevoked',
  'verificationBanned',
  'payoutUnverified',
  'payoutReplaced',
  'softDeleted',
] as const;

export type ExcludedState = (typeof EXCLUDED_STATES)[number];

/** The three visible teachers of each gender: two that the search finds, one it must not. */
export type VisibleRole = 'variantName' | 'plainName' | 'otherName';

/** The prefix every name but `otherName` begins with, written with every variant FR-333 folds. */
export const VARIANT_NAME = 'أُسامـة إِبراهيم آل مصطفى هانئ لؤي Yusuf';
/** The same name as `ijazah_fold` answers it, as a student may type it (R-203). */
export const PLAIN_NAME = 'اسامه ابراهيم ال مصطفي هاني لوي yusuf';
/** A visible name that holds the prefix but does not begin with it: a prefix search skips it. */
export const OTHER_NAME = 'عبدالله اسامه ابراهيم';

/**
 * The shared subject's Arabic name before its tag, written with every variant FR-333 folds (T070:
 * a search by a subject's name, R-203). It begins with no letter a name search above begins with, so
 * those searches meet no subject.
 */
export const SUBJECT_VARIANT = 'مَتْن أُصول إِقراء آل الهُدى قارئ مُؤدّى قراءة التجويـد';
/** The same name as `ijazah_fold` answers it, as a student may type it. */
export const SUBJECT_PLAIN = 'متن اصول اقراء ال الهدي قاري مودي قراءه التجويد';
/** The shared subject's English name before its tag. */
export const SUBJECT_ENGLISH = 'Matn Tajweed';

/** What a student types to find the world's teachers by name: the world's prefix, then `typed`. */
export function nameQuery(world: World, typed: string): string {
  return `${world.prefix} ${typed}`;
}

/** What a student types to find the shared subject: `spelling` of its name, then its own tag. */
export function sharedSubjectQuery(world: World, spelling: string): string {
  return `${spelling} ${world.shared.nameAr.slice(SUBJECT_VARIANT.length + 1)}`;
}

/** The riwaya a visible teacher's shared-subject credential and every private one carry. */
export const COMMON_RIWAYA = 'حفص عن عاصم';
/** The riwaya of `otherName`'s shared-subject credential, a second visible value. */
export const OTHER_RIWAYA = 'ورش عن نافع';

/** Every teacher's slot (T032): Thursday 09:00, the `time` column written whole as text. */
const SLOT_DAY = 4;
const SLOT_START = new Date('1970-01-01T09:00:00Z');

/** Every teacher's rating and review count, so a cursor can be written at any of them. */
export const WORLD_RATING = '4.50';
export const WORLD_REVIEW_COUNT = 3;

export interface SubjectRow {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string;
}

export interface SeededTeacher {
  readonly id: string;
  readonly gender: Gender;
  readonly state: VisibleRole | ExcludedState;
  readonly displayName: string;
  /** The riwaya of the teacher's credential in the shared subject. */
  readonly sharedRiwaya: string;
  /** A subject only this teacher teaches. */
  readonly privateSubject: SubjectRow;
  /** The teacher's three active packages (T032). */
  readonly packageIds: readonly string[];
  /** The teacher's one active slot, Thursday 09:00 for 60 minutes in Cairo (T032). */
  readonly slotId: string;
}

export interface World {
  /** What every teacher's name of this world begins with, before a space (`nameQuery`). */
  readonly prefix: string;
  readonly shared: SubjectRow;
  readonly teachers: readonly SeededTeacher[];
}

const VISIBLE_ROLES: readonly VisibleRole[] = ['variantName', 'plainName', 'otherName'];

export function isVisibleRole(state: SeededTeacher['state']): state is VisibleRole {
  return (VISIBLE_ROLES as readonly string[]).includes(state);
}

/** The world's teachers a requester of `gender` may see: the own gender's visible three. */
export function visibleTo(world: World, gender: Gender): SeededTeacher[] {
  return world.teachers.filter(
    (teacher) => teacher.gender === gender && isVisibleRole(teacher.state),
  );
}

/** Every other teacher of the world: the other gender's in any state, and the own excluded ones. */
export function excludedFrom(world: World, gender: Gender): SeededTeacher[] {
  return world.teachers.filter(
    (teacher) => teacher.gender !== gender || !isVisibleRole(teacher.state),
  );
}

/** The seeded values of `prisma/seed.ts` the surface reads (data-model §4). */
const SETTINGS: Readonly<Record<string, unknown>> = {
  discovery_page_size: 20,
  document_link_ttl_seconds: 300,
  rate_limit_search: { limit: 60, window_seconds: 60 },
  rate_limit_payment_initiation: { limit: 10, window_seconds: 600 },
  // Every signed-in call with no limit of its own is counted by it since T062 (FR-470).
  rate_limit_signed_in_default: { limit: 150, window_seconds: 60 },
  // 004:T060: `sessions.complaint.raise` declares its own limit (FR-452).
  rate_limit_absence_complaint: { limit: 5, window_seconds: 3600 },
  slot_hold_ttl_minutes: 10,
  slot_hold_grace_minutes: 5,
  first_session_lead_hours: 24,
  slot_release_buffer_weeks: 0,
  // 003:T104 (ADR 0025 D1): the teacher's share setting, read when an order is created.
  teacher_share_percent: 70,
  // 004:T070: a closed enrollment's slot is held through its kind's window (the seed's values, T069).
  enrollment_restore_window_days: 14,
  ban_restore_window_days: 14,
  session_access_ttl_minutes: 15,
  session_refresh_ttl_days: 30,
  session_refresh_grace_seconds: 30,
  otp_code_ttl_minutes: 10,
  otp_max_attempts: 5,
  onboarding_token_ttl_minutes: 15,
  provider_nonce_ttl_minutes: 10,
  idempotency_key_ttl_hours: 24,
  early_join_lead_minutes: 15,
  video_empty_timeout_seconds: 300,
  video_departure_timeout_seconds: 20,
  // T026: `sessions.dispute.raise`'s window.
  dispute_window_hours: 72,
  // T037 of specs/004-sessions: `chat.list`'s page and `chat.send`'s limit.
  chat_page_size: 50,
  rate_limit_chat_message: { limit: 30, window_seconds: 60 },
  // T038: the chat's documents, as seeded (`document_link_ttl_seconds` is above).
  upload_max_bytes: 10_485_760,
  rate_limit_upload: { limit: 20, window_seconds: 600 },
  // T006 of specs/005-certification: `teacher.ijazahRequests.send`'s limit, as seeded.
  rate_limit_ijazah_request: { limit: 10, window_seconds: 3600 },
};

const settings: SettingsReader = {
  async read(key, schema) {
    if (!Object.hasOwn(SETTINGS, key)) throw new SettingError(key, 'missing');
    const parsed = schema.safeParse(SETTINGS[key]);
    if (!parsed.success) throw new SettingError(key, 'invalid');
    return parsed.data;
  },
};

/** The storage port's signed link: a fixed address, since no world teacher has a photo. */
const storage = {
  temporaryLink: async (key: string, seconds: number) =>
    `https://files.invalid/${key}?expires=${String(seconds)}`,
  remove: async () => undefined,
};

const PASSWORD = 'a long adversarial passphrase 28';
const SPEC_CLIENT = '203.0.113.28';
const MAX_BODY_BYTES = 1_048_576;
const TIMEOUTS = { statementTimeoutMs: 30_000, idleInTransactionTimeoutMs: 60_000 } as const;
const POOL_MAX = 4;

const callerFactory = createAppCallerFactory(appRouter);
// T006 of specs/005-certification: `teacher.ijazahRequests`, mounted as `app.router.ts` mounts it.
const ijazahRequestsCallerFactory = createAppCallerFactory(
  createAppRouter({ teacher: createAppRouter({ ijazahRequests: ijazahRequestsRouter }) }),
);

/** The `discovery` and `booking` namespaces of the user surface as one bearer reaches them. */
export interface AppCaller {
  readonly discovery: {
    browse(input: DiscoveryBrowseInput): Promise<DiscoveryBrowseOutput>;
    filters(input: DiscoveryFiltersInput): Promise<DiscoveryFiltersOutput>;
    teacher(input: DiscoveryTeacherInput): Promise<DiscoveryTeacherOutput>;
  };
  readonly booking: {
    slots(input: BookingSlotsInput): Promise<BookingSlotsOutput>;
  };
  readonly checkout: {
    hold(input: CheckoutHoldInput): Promise<CheckoutHoldOutput>;
    pay(input: CheckoutPayInput): Promise<CheckoutPayOutput>;
    retry(input: CheckoutRetryInput): Promise<CheckoutRetryOutput>;
    current(input: Record<string, never>): Promise<CheckoutCurrentOutput>;
    continue(input: CheckoutContinueInput): Promise<CheckoutContinueOutput>;
    status(input: CheckoutStatusInput): Promise<CheckoutStatusOutput>;
  };
  /** T049: the student's own enrollments, attacked in `enrollments.attacks.ts`. */
  readonly enrollments: {
    list(input: EnrollmentsListInput): Promise<EnrollmentsListOutput>;
    get(input: EnrollmentsGetInput): Promise<EnrollmentsGetOutput>;
  };
  /** T011 of specs/004-sessions: a session read and joined, attacked in `sessions.attacks.ts`. */
  readonly sessions: {
    get(input: SessionsGetInput): Promise<SessionsGetOutput>;
    join(input: SessionsJoinInput): Promise<SessionsJoinOutput>;
    /** T021: a cancellation asked and answered, attacked in `sessions-cancellation.attacks.ts`. */
    readonly cancellation: {
      request(input: SessionsCancellationRequestInput): Promise<SessionsCancellationRequestOutput>;
      answer(input: SessionsCancellationAnswerInput): Promise<SessionsCancellationAnswerOutput>;
    };
    /** T026: a dispute raised, attacked in `sessions.attacks.ts`. */
    readonly dispute: {
      raise(input: SessionsDisputeRaiseInput): Promise<SessionsDisputeRaiseOutput>;
    };
    /** T031: a remedy chosen, accepted and counter-proposed, attacked in `sessions-remedy.attacks.ts`. */
    readonly remedy: {
      choose(input: SessionsRemedyChooseInput): Promise<SessionsRemedyChooseOutput>;
      accept(input: SessionsRemedyAcceptInput): Promise<SessionsRemedyAcceptOutput>;
      counterOptions(
        input: SessionsRemedyCounterOptionsInput,
      ): Promise<SessionsRemedyCounterOptionsOutput>;
      counter(input: SessionsRemedyCounterInput): Promise<SessionsRemedyCounterOutput>;
      /** T032: the teacher's answer to a counter-proposal. */
      answerCounter(
        input: SessionsRemedyAnswerCounterInput,
      ): Promise<SessionsRemedyAnswerCounterOutput>;
    };
    /** T060: the student's complaint of the teacher's absence, attacked in `sessions.attacks.ts`. */
    readonly complaint: {
      raise(input: SessionsComplaintRaiseInput): Promise<SessionsComplaintRaiseOutput>;
    };
  };
  /** T037 of specs/004-sessions: an enrollment's chat read and written, attacked in `chat.attacks.ts`. */
  readonly chat: {
    list(input: ChatListInput): Promise<ChatListOutput>;
    send(input: ChatSendInput): Promise<ChatSendOutput>;
    /** T038: a signed link to a message's document, attacked in `chat.attacks.ts`. */
    attachmentLink(input: ChatAttachmentLinkInput): Promise<ChatAttachmentLinkOutput>;
  };
}

/** The video stand-in the surface's sessions services use, with what it was asked to make recorded. */
export interface RecordedVideo extends VideoPort {
  readonly calls: { readonly operation: string; readonly args: readonly unknown[] }[];
}

/** A party of a session pair, signed in. */
export interface SessionParty {
  readonly userId: string;
  readonly accessToken: string;
  readonly sessionId: string;
  readonly caller: AppCaller;
}

/**
 * T011 of specs/004-sessions: a student and a lone visible teacher of one gender, both signed in,
 * with a confirmed enrollment and three of its sessions: `open` inside its join period (starting
 * five minutes after the pair was made), `later` not yet open (three days on) and `past` over (it
 * ended two hours before); T026's `ended`, over five hours before, inside its dispute window and
 * raised by `sessions.attacks.ts`' dispute registration alone, so no other attack reads its status.
 */
export interface SessionPair {
  readonly enrollmentId: string;
  readonly sessions: {
    readonly open: string;
    readonly later: string;
    readonly past: string;
    readonly ended: string;
  };
  readonly student: SessionParty;
  readonly teacher: SessionParty;
}

/** A signed-in student and the bearer token the sign-in issued. */
export interface Student {
  readonly userId: string;
  readonly accessToken: string;
  readonly sessionId: string;
  readonly caller: AppCaller;
}

export interface DiscoverySurface {
  readonly world: World;
  /** The signed-in student of `gender`. */
  student(gender: Gender): Student;
  /** The caller a bearer resolves to through the identity module's resolver; anonymous if refused. */
  bearing(accessToken: string): Promise<AppCaller>;
  /** A visible teacher of `gender` alone in a fresh subject, for one case's own changes. */
  loneTeacher(gender: Gender): Promise<{ teacher: SeededTeacher; subject: SubjectRow }>;
  /**
   * Replaces the teacher's payout account through `teacher.payout.register` (FR-193): the account
   * is unverified until the gateway speaks. Answers the new recipient's `recipient_verified` event
   * delivered to the webhook, and the webhook's status.
   */
  replacePayout(teacherId: string): Promise<{ verify(): Promise<number> }>;
  /** The ids of the visible teachers of `gender` with an active package, in SQL from SRS §3.7.1. */
  allTabIds(gender: Gender): Promise<readonly string[]>;
  /**
   * T079: when the teacher's latest payout registration and first package were written, by the
   * database's clock, so a spec can show a replaced account was never offered while verified.
   */
  payoutReplacementOrder(
    teacherId: string,
  ): Promise<{ readonly replacedAt: Date | null; readonly firstPackageAt: Date | null }>;
  /**
   * T036: ends the student's active holds that carry no enrollment, so a later case of the file
   * meets the world's slots free again (a hold outlives its case by its fifteen minutes).
   */
  endHolds(gender: Gender): Promise<void>;
  /**
   * T036: the student's enrollment awaiting payment, on a hold of a lone visible teacher's slot, as
   * `checkout.pay` writes them (until `checkout.pay` lands, written here); one per gender, made on
   * first use. Retry is attacked on it.
   */
  pendingEnrollment(
    gender: Gender,
  ): Promise<{ readonly enrollmentId: string; readonly holdId: string }>;
  /**
   * T043: every row the student's checkout writes, with its state, read back so a refusal can be
   * shown to have written nothing (FR-353): the holds of the student and of `slotIds`, the student's
   * enrollments, their orders and events, and the student's idempotency keys.
   */
  checkoutRows(gender: Gender, slotIds: readonly string[]): Promise<CheckoutRows>;
  /** T043: the teacher's account standing changed in place, as the world seeds every state. */
  setAccountStatus(teacherId: string, status: AccountStatus): Promise<void>;
  /**
   * T043: the teacher's account deleted through identity's real deletion (FR-141); since T080 of
   * specs/004-sessions, an administrator's at the owner's request (T081, Q-R12 (a)).
   */
  deleteAccount(teacherId: string): Promise<void>;
  /** T043: an administrator suspends the teacher through identity's real `StandingService` (FR-165). */
  suspend(teacherId: string): Promise<void>;
  /** T011 of specs/004-sessions: the pair of `gender`, made on first use (`SessionPair`). */
  sessionPair(gender: Gender): Promise<SessionPair>;
  /**
   * T031 of specs/004-sessions: a new session of the pair of `gender`, a Teacher-No-Show over ten
   * days before, with its remedy `proposed`: offered an hour ago, its choice window open a week, its
   * proposal on a Sunday of its own years ahead, so booking it meets no other session. Each call a
   * new one, so an attack that books keeps no other attack's remedy from being open.
   */
  remedySession(gender: Gender): Promise<string>;
  /** T011: the video stand-in the sessions services ask, with its calls. */
  readonly video: RecordedVideo;
  /** T011 (K2): the account's gender changed in place, as the server's record after a correction. */
  setGender(userId: string, gender: Gender): Promise<void>;
  /**
   * T038 of specs/004-sessions: `POST /uploads/chat` on the world's server, as the phone sends it:
   * the bearer, then the fields in order, then one file.
   */
  uploadChat(
    accessToken: string,
    fields: Readonly<Record<string, string>>,
    file: Buffer,
  ): Promise<Response>;
  /** T038: the chat's in-memory storage, each operation recorded. */
  readonly chatStorage: ReturnType<typeof storageStub>;
  /** T038: removes a spec's chat documents, their rows by id and their files by their exact keys. */
  discardChatDocuments(messageIds: readonly string[]): Promise<void>;
  /**
   * T006 of specs/005-certification: `teacher.ijazahRequests` as a bearer reaches it, over the
   * module's router mounted under `teacher.ijazahRequests` as `app.router.ts` mounts it (the
   * integration's line), on this world's services and caller kinds.
   */
  ijazahRequests(accessToken: string): Promise<IjazahRequestsCaller>;
  /**
   * T006 of specs/005-certification: the teacher's application marked approved, as an approved
   * teacher's is (a world teacher is seeded with none), so the teacher kind's `admits: 'approved'`
   * reads the session's standing as approved (`session.service.ts`, the teacher standing).
   */
  approveApplication(teacherId: string): Promise<void>;
}

/** T006 of specs/005-certification: the ijazah request's procedures, as a bearer calls them. */
export interface IjazahRequestsCaller {
  readonly teacher: {
    readonly ijazahRequests: {
      preview(input: IjazahRequestsPreviewInput): Promise<IjazahRequestsPreviewOutput>;
      send(input: IjazahRequestsSendInput): Promise<IjazahRequestsSendOutput>;
      get(input: IjazahRequestsGetInput): Promise<IjazahRequestsGetOutput>;
    };
  };
}

/** An account standing a case moves a teacher to (SRS §3.7.1, `002:T143`). */
export type AccountStatus = 'active' | 'suspended' | 'verification_required';

/** The rows of `checkoutRows`, each a row's id and its state, in id order. */
export interface CheckoutRows {
  readonly holds: readonly string[];
  readonly enrollments: readonly string[];
  readonly payments: readonly string[];
  readonly events: readonly string[];
  readonly idempotencyKeys: readonly string[];
}

interface Built extends DiscoverySurface {
  readonly database: Database;
  readonly server: Server;
  readonly created: { readonly users: string[]; readonly subjects: string[] };
}

let building: Promise<Built> | undefined;

/** The world and the real surface, built once per spec file on its first use. */
export function discoverySurface(): Promise<DiscoverySurface> {
  building ??= build();
  return building;
}

afterAll(async () => {
  if (building === undefined) return;
  const built = await building;
  const at = new Date();
  await built.database.user.updateMany({
    where: { id: { in: built.created.users }, deletedAt: null },
    data: { deletedAt: at },
  });
  await built.database.subject.updateMany({
    where: { id: { in: built.created.subjects } },
    data: { isActive: false },
  });
  await new Promise((resolve) => built.server.close(resolve));
  await closeDatabase(built.database);
});

async function build(): Promise<Built> {
  const database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: POOL_MAX,
    ...TIMEOUTS,
  });
  const created = { users: [] as string[], subjects: [] as string[] };
  const log = createLogger({ level: 'fatal' });
  const encryptionKey = randomBytes(32).toString('base64');

  // The webhook is bound once the origin is known: the stand-in's port is built from it.
  let route: ReturnType<typeof createPaymentWebhookRoute> | undefined;
  // T038 of specs/004-sessions: the chat's upload route, bound once the services are.
  let chatUpload: ReturnType<typeof createChatUploadRoute> | undefined;
  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    if (chatUpload !== undefined && url === CHAT_UPLOAD_PATH) {
      request.url = '/';
      chatUpload(request, response);
      return;
    }
    if (
      route === undefined ||
      (url !== PAYMENT_WEBHOOK_PATH && !url.startsWith(`${PAYMENT_WEBHOOK_PATH}/`))
    ) {
      response.statusCode = 404;
      response.end();
      return;
    }
    request.url = url.slice(PAYMENT_WEBHOOK_PATH.length) || '/';
    route(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  const config: PaymentConfig = {
    PAYMENT_GATEWAY: 'fake',
    PAYMENT_MODE: 'test',
    ENCRYPTION_KEY: encryptionKey,
    API_PUBLIC_ORIGIN: origin,
  };
  const payment = createPaymentPort(config);
  route = createPaymentWebhookRoute({
    database,
    payment,
    log,
    maxBodyBytes: MAX_BODY_BYTES,
    // Only recipient events are delivered here; a paid order event would be T038's.
    confirmations: { enqueue: () => Promise.reject(new Error('discovery world: not reached')) },
  });
  const stand: GatewayStandIn = gatewayStandIn({ origin, config, payment });

  // The recipient reference the port answered each registration, so the case can verify it.
  const recipients = new Map<string, string>();
  const unreachable = () => Promise.reject(new Error('discovery world: not reached'));
  const identityBase = { database, settings, encryptionKey };
  const cipher = new ColumnCipher(encryptionKey);
  const idempotency = new IdempotencyService<Transaction>({
    store: new IdempotencyRepository(database),
    settings,
  });
  // The one registry of an account's end, booking's T041 subscriber bound as `main.ts` binds it.
  const consequences = new AccountConsequences();
  consequences.subscribe(
    terminationSubscriber({
      orders: orderStandingsOf,
      log: { info: () => undefined, warn: () => undefined },
    }),
  );
  const identity: IdentityServices = {
    ...createIdentityServices({
      ...identityBase,
      cipher,
      marks: new MemorySingleUseMarks(() => new Date()),
      signIn: {
        verifyIdentityToken: unreachable,
        exchangeAuthorization: unreachable,
        revoke: unreachable,
      },
      email: { deliver: async () => undefined },
      storage,
      log: { warn: () => undefined, info: () => undefined },
      payment: {
        async registerPayoutRecipient(teacherUserId, details) {
          const recipientRef = await payment.registerPayoutRecipient(teacherUserId, details);
          recipients.set(teacherUserId, recipientRef);
          return recipientRef;
        },
      },
      idempotency,
      consequences,
      report: () => undefined,
      // T080 of specs/004-sessions (rule d): booking's count bound as `main.ts` binds it.
      ongoingEnrollments: createOngoingEnrollments({ settings }),
    }),
    // T004 of specs/005-certification (rule d): the certificate name, its port a no-op as `main.ts`
    // binds it until T006.
    certificateName: createCertificateNameService({
      idempotency,
      log: { info: () => undefined },
      awaitingNameRelease: { release: async () => undefined },
    }),
  };
  // T043: the suspension as the panel's admin services build it, on the same registry (FR-165).
  const standing = new StandingService({
    store: standingStoreOver(database),
    consequences,
    revokeSubjects,
    // Read by a reinstatement only (T113), which no case here makes.
    hasOpenIdentityRequest: async () => false,
  });

  // As `main.ts` binds them (T025, T026, T027): catalog's discovery through catalog's entry, each
  // call in a read transaction of its own, composed by booking with the nearest free slots.
  const catalog = createDiscoveryCatalog(settings, storage);
  const reads = transactionsOver(database);
  const video = recordedVideo(encryptionKey);
  // T038: the chat's documents and their links, in memory.
  const chatStorage = storageStub();
  // T006 of specs/005-certification (rule d): the ijazah request over its own in-memory storage,
  // the enrollment reads' port bound to it, as `main.ts` binds them.
  const certification = createIjazahRequestService({
    database,
    // No world teacher holds a signature, so nothing is ever read or put.
    storage: {
      read: () => Promise.reject(new Error('no signature in this world')),
      put: () => Promise.reject(new Error('no signature in this world')),
      remove: async () => undefined,
    },
    idempotency,
    log,
    // 005:T032 (rule d): no world ijazah is re-frozen, so nothing is enqueued.
    renders: { enqueue: () => Promise.reject(new Error('no ijazah in this world')) },
  });
  const services: AppServices = {
    settings,
    publicConfig: { supportEmail: 'support@ijazah.invalid' },
    subjects: { listActive: unreachable },
    identity,
    verification: unusedVerificationServices,
    catalog: unusedCatalogServices,
    teacherProfile: unusedTeacherProfileServices,
    discovery: createDiscoveryServices({
      catalog: {
        browse: (requester, input) => reads.run((tx) => catalog.browse(tx, requester, input)),
        filters: (requester, input) => reads.run((tx) => catalog.filters(tx, requester, input)),
        teacher: (requester, input) => reads.run((tx) => catalog.teacher(tx, requester, input)),
      },
      database,
      settings,
    }),
    // As `main.ts` binds it (T032): the booking sheet's slots over the owners' entries.
    booking: createBookingServices({
      database,
      settings,
      ijazahRequests: { of: (tx, enrollmentIds) => certification.of(tx, enrollmentIds) },
    }),
    // As `main.ts` binds it (T036): the checkout over the stand-in gateway, keyed in two steps.
    checkout: createCheckoutServices({
      database,
      settings,
      idempotency,
      payment,
      cipher,
      gateway: 'fake',
    }),
    // As `main.ts` binds it (T011 of specs/004-sessions): over the video port and booking's side.
    sessions: createSessionsServices({
      transactions: reads,
      settings,
      video,
      enrollmentSide: createEnrollmentSide({ settings }),
      store: sessionsStore,
      // T021: `sessions.cancellation.request` keyed as `main.ts` keys it; T026: `sessions.dispute.raise`
      // run in its transaction.
      idempotency,
    }),
    // As `main.ts` binds it (T037 of specs/004-sessions): over booking's side, `chat.send` keyed.
    chat: createChatServices({
      transactions: reads,
      idempotency,
      settings,
      enrollments: createEnrollmentSide({ settings }),
      // T038: `chat.attachmentLink`'s signed links.
      storage: chatStorage,
    }),
    // T006 of specs/005-certification (rule d).
    certification: { ijazahRequests: certification },
  };
  const rateLimiter = new RateLimiter({
    settings,
    counter: { hit: async () => 1 },
    subjectKey: Buffer.alloc(32, 1),
  });
  const resolve = resolveUserSession(identityBase);
  // As `main.ts` mounts it (T038 of specs/004-sessions): over the identity resolver and the guard.
  chatUpload = createChatUploadRoute({
    sessions: resolve,
    guard: { settings, rateLimiter },
    log,
    storage: chatStorage,
    transactions: reads,
    enrollments: createEnrollmentSide({ settings }),
  });
  const bearing = async (accessToken: string): Promise<AppCaller> =>
    callerFactory(
      createAppContext({
        session: await resolve(accessToken),
        log,
        rateLimiter,
        clientAddress: SPEC_CLIENT,
        services,
      }),
    );

  const registerReplacement = async (teacherId: string): Promise<string> => {
    await identity.payout.register(teacherId, {
      details: { holderName: 'Adversarial', method: 'bank_account', accountNumber: 'EG0028T028' },
      idempotencyKey: randomUUID(),
    });
    const recipientRef = recipients.get(teacherId);
    if (recipientRef === undefined) throw new Error('the payout port was not asked to register');
    return recipientRef;
  };

  const prefix = randomUUID().slice(0, 8);
  const seeder = new Seeder(database, created, registerReplacement, prefix);
  const [admin, shared] = await Promise.all([
    seeder.admin(),
    seeder.subject({
      nameAr: SUBJECT_VARIANT,
      nameEn: SUBJECT_ENGLISH,
    }),
  ]);
  const teachers: SeededTeacher[] = [];
  for (const gender of GENDERS) {
    for (const role of VISIBLE_ROLES) {
      teachers.push(await seeder.teacher({ gender, state: role, shared, admin }));
    }
    for (const state of EXCLUDED_STATES) {
      teachers.push(await seeder.teacher({ gender, state, shared, admin }));
    }
  }

  const signedIn = async (userId: string, email: string): Promise<SessionParty> => {
    const { accessToken } = await identity.emailAuth.signIn(email, PASSWORD);
    const session = await resolve(accessToken);
    if (session === null) throw new Error('the issued token did not resolve');
    return {
      userId,
      accessToken,
      sessionId: session.sessionId,
      caller: await bearing(accessToken),
    };
  };
  const pairs = new Map<Gender, Promise<SessionPair>>();
  // T031: `remedySession`'s calls, one after the other.
  let remedies: Promise<unknown> = Promise.resolve();
  const makePair = async (gender: Gender): Promise<SessionPair> => {
    const { userId: studentId, email: studentEmail } = await seeder.student(
      gender,
      `${prefix} طالب`,
    );
    const subject = await seeder.subject();
    const teacher = await seeder.teacher({
      gender,
      state: 'plainName',
      shared: subject,
      admin,
      sharedRiwaya: `رواية ${randomUUID()}`,
    });
    // A world teacher has no password; one is set so the pair's teacher signs in (as `deleteAccount`).
    const { email: teacherEmail } = await database.user.update({
      where: { id: teacher.id },
      data: { passwordHash: await hashPassword(PASSWORD) },
      select: { email: true },
    });
    if (teacherEmail === null) throw new Error('a world teacher without an address');
    const [packageId] = teacher.packageIds;
    if (packageId === undefined) throw new Error('a world teacher without a package');
    const now = new Date();
    const { id: enrollmentId } = await database.enrollment.create({
      data: {
        studentUserId: studentId,
        teacherUserId: teacher.id,
        packageId,
        slotId: teacher.slotId,
        snapshotPricePiasters: BigInt(100_000),
        snapshotSessionCount: 4,
        snapshotDurationMinutes: SESSION_MINUTES,
        snapshotSubjectId: subject.id,
        snapshotSlotTimezone: 'Africa/Cairo',
        snapshotTrack: 'recitation',
        status: 'confirmed',
        confirmedAt: now,
        purchasedAt: now,
        quotedFirstSessionLocalDate: new Date('2026-12-03T00:00:00Z'),
      },
      select: { id: true },
    });
    const session = async (sequenceNumber: number, startsInMinutes: number): Promise<string> => {
      const startsAt = new Date(addMinutes(now, startsInMinutes));
      const { id } = await database.session.create({
        data: {
          enrollmentId,
          teacherUserId: teacher.id,
          studentUserId: studentId,
          sequenceNumber,
          // The local fields as the schedule's text; the join reads the instants (R-TIME-1).
          scheduledDateLocal: new Date('2026-12-03T00:00:00Z'),
          scheduledStartTimeLocal: SLOT_START,
          timezone: 'Africa/Cairo',
          scheduledStartAt: startsAt,
          scheduledEndAt: new Date(addMinutes(startsAt, SESSION_MINUTES)),
          status: 'scheduled',
        },
        select: { id: true },
      });
      return id;
    };
    const sessions = {
      past: await session(1, PAST_SESSION_STARTS_IN_MINUTES),
      open: await session(2, OPEN_SESSION_STARTS_IN_MINUTES),
      later: await session(3, LATER_SESSION_STARTS_IN_MINUTES),
      ended: await session(4, ENDED_SESSION_STARTS_IN_MINUTES),
    };
    return {
      enrollmentId,
      sessions,
      student: await signedIn(studentId, studentEmail),
      teacher: await signedIn(teacher.id, teacherEmail),
    };
  };

  const students = new Map<Gender, Student>();
  const pending = new Map<Gender, Promise<{ enrollmentId: string; holdId: string }>>();
  for (const gender of GENDERS) {
    const { userId, email } = await seeder.student(gender);
    const { accessToken } = await identity.emailAuth.signIn(email, PASSWORD);
    const session = await resolve(accessToken);
    if (session === null) throw new Error('the issued token did not resolve');
    students.set(gender, {
      userId,
      accessToken,
      sessionId: session.sessionId,
      caller: await bearing(accessToken),
    });
  }

  return {
    database,
    server,
    created,
    world: { prefix, shared, teachers },
    student(gender) {
      const student = students.get(gender);
      if (student === undefined) throw new Error(`no ${gender} student`);
      return student;
    },
    bearing,
    async loneTeacher(gender) {
      const subject = await seeder.subject();
      const teacher = await seeder.teacher({
        gender,
        state: 'plainName',
        shared: subject,
        admin,
        sharedRiwaya: `رواية ${randomUUID()}`,
      });
      return { teacher, subject };
    },
    async replacePayout(teacherId) {
      const recipientRef = await registerReplacement(teacherId);
      return { verify: () => stand.deliver(stand.recipientVerified(recipientRef)) };
    },
    async endHolds(gender) {
      const student = students.get(gender);
      if (student === undefined) throw new Error(`no ${gender} student`);
      await database.slotHold.updateMany({
        where: { studentUserId: student.userId, releasedAt: null, enrollmentId: null },
        data: { releasedAt: new Date() },
      });
    },
    pendingEnrollment(gender) {
      const made = pending.get(gender);
      if (made !== undefined) return made;
      const making = (async () => {
        const student = students.get(gender);
        if (student === undefined) throw new Error(`no ${gender} student`);
        const subject = await seeder.subject();
        const teacher = await seeder.teacher({
          gender,
          state: 'plainName',
          shared: subject,
          admin,
          sharedRiwaya: `رواية ${randomUUID()}`,
        });
        const [packageId] = teacher.packageIds;
        if (packageId === undefined) throw new Error('a world teacher without a package');
        await database.slotHold.updateMany({
          where: { studentUserId: student.userId, releasedAt: null, enrollmentId: null },
          data: { releasedAt: new Date() },
        });
        return database.$transaction(async (tx) => {
          const { id: enrollmentId } = await tx.enrollment.create({
            data: {
              studentUserId: student.userId,
              teacherUserId: teacher.id,
              packageId,
              slotId: teacher.slotId,
              snapshotPricePiasters: BigInt(100_000),
              snapshotSessionCount: 4,
              snapshotDurationMinutes: 60,
              snapshotSubjectId: subject.id,
              snapshotSlotTimezone: 'Africa/Cairo',
              snapshotTrack: 'recitation',
              status: 'pending_payment',
              purchasedAt: new Date(),
              quotedFirstSessionLocalDate: new Date('2026-12-03T00:00:00Z'),
            },
            select: { id: true },
          });
          const { id: holdId } = await tx.slotHold.create({
            data: {
              slotId: teacher.slotId,
              studentUserId: student.userId,
              packageId,
              sessionCount: 4,
              enrollmentId,
              // The checkout's ten minutes and the grace's five, from now (FR-BOOK-9).
              expiresAt: new Date(addMinutes(new Date(), HOLD_MINUTES)),
            },
            select: { id: true },
          });
          return { enrollmentId, holdId };
        });
      })();
      pending.set(gender, making);
      return making;
    },
    async checkoutRows(gender, slotIds) {
      const student = students.get(gender);
      if (student === undefined) throw new Error(`no ${gender} student`);
      const byId = { orderBy: { id: 'asc' as const } };
      const [holds, enrollments, keys] = await Promise.all([
        database.slotHold.findMany({
          where: { OR: [{ studentUserId: student.userId }, { slotId: { in: [...slotIds] } }] },
          select: { id: true, releasedAt: true, enrollmentId: true },
          ...byId,
        }),
        database.enrollment.findMany({
          where: { studentUserId: student.userId },
          select: { id: true, status: true, cancellationReason: true },
          ...byId,
        }),
        database.idempotencyKey.findMany({
          where: { actorId: student.userId },
          select: { id: true },
          ...byId,
        }),
      ]);
      const enrollmentIds = enrollments.map(({ id }) => id);
      const [payments, events] = await Promise.all([
        database.payment.findMany({
          where: { enrollmentId: { in: enrollmentIds } },
          select: { id: true, status: true },
          ...byId,
        }),
        database.enrollmentEvent.findMany({
          where: { enrollmentId: { in: enrollmentIds } },
          select: { id: true },
          ...byId,
        }),
      ]);
      return {
        holds: holds.map(
          (row) =>
            `${row.id} ${row.releasedAt?.toISOString() ?? 'active'} ${row.enrollmentId ?? '-'}`,
        ),
        enrollments: enrollments.map(
          (row) => `${row.id} ${row.status} ${row.cancellationReason ?? '-'}`,
        ),
        payments: payments.map((row) => `${row.id} ${row.status}`),
        events: events.map(({ id }) => id),
        idempotencyKeys: keys.map(({ id }) => id),
      };
    },
    async setAccountStatus(teacherId, status) {
      await database.user.update({ where: { id: teacherId }, data: { accountStatus: status } });
    },
    async deleteAccount(teacherId) {
      // T081 of specs/004-sessions: as the administrator kind runs `users.delete`, on its
      // transaction with its request's list bound, flushed after the commit.
      const live = new RequestLive(unboundBus, { warn: () => undefined });
      await database.$transaction(async (tx) => {
        const unbind = bindToTransaction(tx, live);
        try {
          await identity.deletion.deleteByAdministrator(tx, admin, {
            targetUserId: teacherId,
            reason: 'طلب صاحب الحساب الحذف عبر الدعم',
            idempotencyKey: randomUUID(),
          });
        } finally {
          unbind();
        }
      });
      live.flush();
    },
    async suspend(teacherId) {
      await database.$transaction((tx) => standing.suspend(tx, admin, teacherId));
    },
    sessionPair(gender) {
      const made = pairs.get(gender);
      if (made !== undefined) return made;
      const making = makePair(gender);
      pairs.set(gender, making);
      return making;
    },
    remedySession(gender) {
      // One at a time, so two calls never draw the same sequence number.
      const making = remedies.then(async () => {
        let pairMaking = pairs.get(gender);
        if (pairMaking === undefined) {
          pairMaking = makePair(gender);
          pairs.set(gender, pairMaking);
        }
        const pair = await pairMaking;
        const { _max } = await database.session.aggregate({
          where: { enrollmentId: pair.enrollmentId },
          _max: { sequenceNumber: true },
        });
        const sequenceNumber = (_max.sequenceNumber ?? 0) + 1;
        const now = new Date();
        const startsAt = new Date(addMinutes(now, -(14_400 + 120 * sequenceNumber)));
        const { id: sessionId } = await database.session.create({
          data: {
            enrollmentId: pair.enrollmentId,
            teacherUserId: pair.teacher.userId,
            studentUserId: pair.student.userId,
            sequenceNumber,
            scheduledDateLocal: new Date('2026-12-03T00:00:00Z'),
            scheduledStartTimeLocal: SLOT_START,
            timezone: 'Africa/Cairo',
            scheduledStartAt: startsAt,
            scheduledEndAt: new Date(addMinutes(startsAt, SESSION_MINUTES)),
            status: 'teacher_no_show',
          },
          select: { id: true },
        });
        await database.sessionRemedy.create({
          data: {
            sessionId,
            kind: 'makeup',
            status: 'proposed',
            offeredAt: new Date(addMinutes(now, -60)),
            choiceClosesAt: new Date(addDays(now, 7)),
            snapshotAnswerWindowHours: 72,
            snapshotFirstSessionLeadHours: 24,
            proposedDate: new Date(addDays(new Date('2040-01-01T00:00:00Z'), 7 * sequenceNumber)),
          },
        });
        return sessionId;
      });
      remedies = making.catch(() => undefined);
      return making;
    },
    video,
    async setGender(userId, gender) {
      await database.user.update({ where: { id: userId }, data: { gender } });
    },
    uploadChat(accessToken, fields, file) {
      const payload = multipart([
        ...Object.entries(fields).map(([name, value]) => ({ name, value })),
        { name: 'file', filename: 'upload.bin', type: 'application/octet-stream', bytes: file },
      ]);
      return fetch(`${origin}${CHAT_UPLOAD_PATH}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': payload.contentType },
        body: new Uint8Array(payload.body),
      });
    },
    chatStorage,
    async approveApplication(teacherId) {
      await database.teacherProfile.update({
        where: { userId: teacherId },
        data: { applicationStatus: 'approved' },
        select: { id: true },
      });
    },
    // T006 of specs/005-certification: the module's router on this world's context.
    ijazahRequests: async (accessToken) =>
      ijazahRequestsCallerFactory(
        createAppContext({
          session: await resolve(accessToken),
          log,
          rateLimiter,
          clientAddress: SPEC_CLIENT,
          services,
        }),
      ),
    async discardChatDocuments(messageIds) {
      if (messageIds.length === 0) return;
      const rows = await database.chatMessage.findMany({
        where: { id: { in: [...messageIds] } },
        select: { attachmentKey: true },
      });
      await database.chatMessage.deleteMany({ where: { id: { in: [...messageIds] } } });
      for (const { attachmentKey } of rows) {
        if (attachmentKey !== null) await chatStorage.remove(attachmentKey);
      }
    },
    async allTabIds(gender) {
      // SRS §3.7.1's five conjuncts as written, and FR-332's "with an active package".
      const rows = await database.$queryRaw<{ id: string }[]>`
        SELECT u.id::text AS id FROM users u JOIN teacher_profiles t ON t.user_id = u.id
         WHERE u.gender::text = ${gender}
           AND t.verification_status::text = 'approved'
           AND u.deleted_at IS NULL
           AND t.payout_verified_at IS NOT NULL
           AND u.account_status::text NOT IN ('suspended', 'banned')
           AND EXISTS (SELECT 1 FROM packages p WHERE p.teacher_user_id = u.id AND p.is_active)
         ORDER BY u.id`;
      return rows.map(({ id }) => id);
    },
    async payoutReplacementOrder(teacherId) {
      const [row] = await database.$queryRaw<
        { replaced_at: Date | null; first_package_at: Date | null }[]
      >`
        SELECT (SELECT max(k.created_at) FROM idempotency_keys k
                 WHERE k.actor_id = ${teacherId} AND k.scope = 'teacher.payout.register') AS replaced_at,
               (SELECT min(p.created_at) FROM packages p
                 WHERE p.teacher_user_id = ${teacherId}::uuid) AS first_package_at`;
      return {
        replacedAt: row?.replaced_at ?? null,
        firstPackageAt: row?.first_package_at ?? null,
      };
    },
  };
}

/** What a seeded teacher's rows hold, by its state. */
function columnsOf(state: SeededTeacher['state']) {
  return {
    accountStatus:
      state === 'accountSuspended'
        ? ('suspended' as const)
        : state === 'accountBanned'
          ? ('banned' as const)
          : ('active' as const),
    verificationStatus:
      state === 'verificationPending'
        ? ('pending' as const)
        : state === 'verificationRejected'
          ? ('rejected' as const)
          : state === 'verificationSuspended'
            ? ('suspended' as const)
            : state === 'verificationRevoked'
              ? ('revoked' as const)
              : state === 'verificationBanned'
                ? ('banned' as const)
                : ('approved' as const),
    // A replaced account was verified before; `Seeder.teacher` clears it through the real path.
    payoutVerifiedAt: state === 'payoutUnverified' ? null : new Date('2026-10-20T09:00:00Z'),
    deletedAt: state === 'softDeleted' ? new Date('2026-10-30T09:00:00Z') : null,
  };
}

function nameOf(prefix: string, state: SeededTeacher['state'], index: number): string {
  return `${prefix} ${spellingOf(state, index)}`;
}

function spellingOf(state: SeededTeacher['state'], index: number): string {
  if (state === 'variantName') return VARIANT_NAME;
  if (state === 'plainName') return PLAIN_NAME;
  if (state === 'otherName') return OTHER_NAME;
  // Every excluded name begins with the visible prefix, in one spelling or the other (SC-314).
  return `${index % 2 === 0 ? VARIANT_NAME : PLAIN_NAME} ${state}`;
}

/** Writes and commits the world's rows, remembering each account and subject it creates. */
class Seeder {
  readonly #database: Database;
  readonly #created: { readonly users: string[]; readonly subjects: string[] };
  readonly #replacePayout: (teacherId: string) => Promise<unknown>;
  readonly #prefix: string;
  #count = 0;

  constructor(
    database: Database,
    created: { users: string[]; subjects: string[] },
    replacePayout: (teacherId: string) => Promise<unknown>,
    prefix: string,
  ) {
    this.#database = database;
    this.#created = created;
    this.#replacePayout = replacePayout;
    this.#prefix = prefix;
  }

  async admin(): Promise<string> {
    const { id } = await this.#database.adminUser.create({
      data: {
        email: `adversarial-${randomUUID()}@example.invalid`,
        mfaSecretEncrypted: Buffer.from('spec'),
        displayName: 'Adversarial administrator',
        isActive: true,
      },
      select: { id: true },
    });
    return id;
  }

  /** An active subject, its names `names` (by default «مادة», "Subject") then a tag of its own. */
  async subject(names = { nameAr: 'مادة', nameEn: 'Subject' }): Promise<SubjectRow> {
    const tag = randomUUID().slice(0, 8);
    const row = await this.#database.subject.create({
      data: { nameAr: `${names.nameAr} ${tag}`, nameEn: `${names.nameEn} ${tag}`, isActive: true },
      select: { id: true, nameAr: true, nameEn: true },
    });
    this.#created.subjects.push(row.id);
    return row;
  }

  async student(gender: Gender, displayName = 'طالب'): Promise<{ userId: string; email: string }> {
    const email = `adversarial-${randomUUID()}@example.invalid`;
    const { id } = await this.#database.user.create({
      data: {
        email,
        passwordHash: await hashPassword(PASSWORD),
        gender,
        dateOfBirth: new Date('2004-05-01'),
        displayName,
        preferredLanguage: 'ar',
        timezone: 'Africa/Cairo',
        accountStatus: 'active',
        roles: { create: { role: 'student', status: 'active' } },
      },
      select: { id: true },
    });
    this.#created.users.push(id);
    return { userId: id, email };
  }

  async teacher({
    gender,
    state,
    shared,
    admin,
    sharedRiwaya,
  }: {
    readonly gender: Gender;
    readonly state: SeededTeacher['state'];
    readonly shared: SubjectRow;
    readonly admin: string;
    readonly sharedRiwaya?: string;
  }): Promise<SeededTeacher> {
    this.#count += 1;
    const columns = columnsOf(state);
    const displayName = nameOf(this.#prefix, state, this.#count);
    const { id } = await this.#database.user.create({
      data: {
        email: `adversarial-${randomUUID()}@example.invalid`,
        gender,
        dateOfBirth: new Date('1985-03-01'),
        displayName,
        preferredLanguage: 'ar',
        timezone: 'Africa/Cairo',
        accountStatus: columns.accountStatus,
        deletedAt: columns.deletedAt,
        roles: { create: { role: 'teacher', status: 'active' } },
      },
      select: { id: true },
    });
    this.#created.users.push(id);
    await this.#database.teacherProfile.create({
      data: {
        userId: id,
        bio: 'نبذة',
        qualificationSummary: 'إجازة',
        verificationStatus: columns.verificationStatus,
        payoutVerifiedAt: columns.payoutVerifiedAt,
        averageRating: WORLD_RATING,
        reviewCount: WORLD_REVIEW_COUNT,
      },
      select: { id: true },
    });
    // T079: replaced before any package exists, so no world, this one or another run's, ever lists
    // the teacher as verified and offered under a name the excluded checks refuse.
    if (state === 'payoutReplaced') await this.#replacePayout(id);
    const privateSubject = await this.subject();
    const riwaya =
      sharedRiwaya ??
      (state === 'otherName'
        ? OTHER_RIWAYA
        : isVisibleRole(state)
          ? COMMON_RIWAYA
          : `رواية ${state} ${gender} ${randomUUID().slice(0, 8)}`);
    await this.#database.teacherSubject.createMany({
      data: [shared, privateSubject].map((subject) => ({
        teacherUserId: id,
        subjectId: subject.id,
      })),
    });
    const packages = await this.#database.package.createManyAndReturn({
      select: { id: true },
      data: [
        { subjectId: shared.id, track: 'recitation' as const },
        { subjectId: shared.id, track: 'ijazah_track' as const },
        { subjectId: privateSubject.id, track: 'recitation' as const },
      ].map(({ subjectId, track }) => ({
        teacherUserId: id,
        subjectId,
        track,
        sessionCount: 4,
        sessionDurationMinutes: 60,
        pricePiasters: BigInt(100_000),
        isActive: true,
      })),
    });
    // T032: one slot of the packages' length, whatever the teacher's state, for `booking.slots`.
    const { id: slotId } = await this.#database.availabilitySlot.create({
      data: {
        teacherUserId: id,
        dayOfWeek: SLOT_DAY,
        startTimeLocal: SLOT_START,
        durationMinutes: 60,
        timezone: 'Africa/Cairo',
        isActive: true,
      },
      select: { id: true },
    });
    await this.#credential(id, shared, riwaya, admin);
    await this.#credential(id, privateSubject, COMMON_RIWAYA, admin);
    return {
      id,
      gender,
      state,
      displayName,
      sharedRiwaya: riwaya,
      privateSubject,
      packageIds: packages.map((row) => row.id),
      slotId,
    };
  }

  async #credential(
    teacherId: string,
    on: SubjectRow,
    riwaya: string,
    adminId: string,
  ): Promise<void> {
    const { id: documentId } = await this.#database.verificationDocument.create({
      data: {
        userId: teacherId,
        documentType: 'credential',
        storageKeyEncrypted: Buffer.from('spec'),
      },
      select: { id: true },
    });
    await this.#database.teacherCredential.create({
      data: {
        teacherUserId: teacherId,
        subjectId: on.id,
        documentId,
        status: 'approved',
        riwaya,
        submittedWithApplication: true,
        reviewedByAdminId: adminId,
        reviewedAt: new Date('2026-10-18T09:00:00Z'),
      },
      select: { id: true },
    });
  }
}

/** The tab of `subjectId` in a first page's tabs, or of all subjects when null. */
export function tabCount(answer: DiscoveryBrowseOutput, subjectId: string | null): number {
  const tab = answer.tabs?.find((entry) => entry.subjectId === subjectId);
  if (tab === undefined) throw new Error(`no tab ${String(subjectId)} in the answer`);
  return tab.count;
}
