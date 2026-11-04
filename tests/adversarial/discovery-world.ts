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
// changed in place as the world seeds every state (`setAccountStatus`), and a teacher deletes the
// account through identity's real deletion (`deleteAccount`, FR-141), for `checkout-standing.spec.ts`;
// an administrator suspends a teacher through identity's real `StandingService` (`suspend`), and both
// reach booking's T041 subscriber on the one `AccountConsequences`, bound as `main.ts` binds it.
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
  terminationSubscriber,
} from '../../apps/api/src/modules/booking/index.js';
import {
  createDiscoveryCatalog,
  revokeSubjects,
} from '../../apps/api/src/modules/catalog/index.js';
import {
  AccountConsequences,
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
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import {
  createPaymentPort,
  type PaymentConfig,
} from '../../apps/api/src/platform/ports/payment/index.js';
import { MemorySingleUseMarks } from '../../apps/api/src/platform/redis/single-use-marks.fixtures.js';
import {
  SettingError,
  type SettingsReader,
} from '../../apps/api/src/platform/settings/settings-reader.js';
import { appRouter } from '../../apps/api/src/surfaces/app.router.js';
import { type AppServices, createAppContext } from '../../apps/api/src/surfaces/context.js';
import { createAppCallerFactory } from '../../apps/api/src/surfaces/procedures.js';
import {
  unusedCatalogServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../apps/api/src/surfaces/services.fixtures.js';
import type {
  BookingSlotsInput,
  BookingSlotsOutput,
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
} from '../../packages/contracts/src/index.js';
import { addMinutes } from '../../packages/time/src/index.js';
import { gatewayStandIn, type GatewayStandIn } from '../support/gateway-stand-in';

type Gender = 'male' | 'female';

/** A hold's minutes: the checkout's ten and the grace's five (the seeded settings). */
const HOLD_MINUTES = 15;

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
  slot_hold_ttl_minutes: 10,
  slot_hold_grace_minutes: 5,
  first_session_lead_hours: 24,
  slot_release_buffer_weeks: 0,
  session_access_ttl_minutes: 15,
  session_refresh_ttl_days: 30,
  session_refresh_grace_seconds: 30,
  otp_code_ttl_minutes: 10,
  otp_max_attempts: 5,
  onboarding_token_ttl_minutes: 15,
  provider_nonce_ttl_minutes: 10,
  idempotency_key_ttl_hours: 24,
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
  /** T043: the teacher deletes the account through identity's real deletion (FR-141). */
  deleteAccount(teacherId: string): Promise<void>;
  /** T043: an administrator suspends the teacher through identity's real `StandingService` (FR-165). */
  suspend(teacherId: string): Promise<void>;
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
  const server = createServer((request, response) => {
    const url = request.url ?? '/';
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
  consequences.subscribe(terminationSubscriber({ orders: orderStandingsOf }));
  const identity: IdentityServices = createIdentityServices({
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
    log: { warn: () => undefined },
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
  });
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
    booking: createBookingServices({ database, settings }),
    // As `main.ts` binds it (T036): the checkout over the stand-in gateway, keyed in two steps.
    checkout: createCheckoutServices({
      database,
      settings,
      idempotency,
      payment,
      cipher,
      gateway: 'fake',
    }),
  };
  const rateLimiter = new RateLimiter({
    settings,
    counter: { hit: async () => 1 },
    subjectKey: Buffer.alloc(32, 1),
  });
  const resolve = resolveUserSession(identityBase);
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

  const seeder = new Seeder(database, created);
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

  const registerReplacement = async (teacherId: string): Promise<string> => {
    await identity.payout.register(teacherId, {
      details: { holderName: 'Adversarial', method: 'bank_account', accountNumber: 'EG0028T028' },
      idempotencyKey: randomUUID(),
    });
    const recipientRef = recipients.get(teacherId);
    if (recipientRef === undefined) throw new Error('the payout port was not asked to register');
    return recipientRef;
  };
  for (const teacher of teachers.filter(({ state }) => state === 'payoutReplaced')) {
    await registerReplacement(teacher.id);
  }

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
    world: { shared, teachers },
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
      // A world teacher has no password; one is set so the deletion's own proof holds (FR-140).
      await database.user.update({
        where: { id: teacherId },
        data: { passwordHash: await hashPassword(PASSWORD) },
      });
      await identity.deletion.deleteAccount(teacherId, {
        confirmation: 'DELETE',
        reauth: { kind: 'password', password: PASSWORD },
        idempotencyKey: randomUUID(),
      });
    },
    async suspend(teacherId) {
      await database.$transaction((tx) => standing.suspend(tx, admin, teacherId));
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
    // A replaced account was verified before; `replacePayout` clears it through the real path.
    payoutVerifiedAt: state === 'payoutUnverified' ? null : new Date('2026-10-20T09:00:00Z'),
    deletedAt: state === 'softDeleted' ? new Date('2026-10-30T09:00:00Z') : null,
  };
}

function nameOf(state: SeededTeacher['state'], index: number): string {
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
  #count = 0;

  constructor(database: Database, created: { users: string[]; subjects: string[] }) {
    this.#database = database;
    this.#created = created;
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

  async student(gender: Gender): Promise<{ userId: string; email: string }> {
    const email = `adversarial-${randomUUID()}@example.invalid`;
    const { id } = await this.#database.user.create({
      data: {
        email,
        passwordHash: await hashPassword(PASSWORD),
        gender,
        dateOfBirth: new Date('2004-05-01'),
        displayName: 'طالب',
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
    const displayName = nameOf(state, this.#count);
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
