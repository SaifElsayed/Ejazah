// api/table-ownership (R-API-6) against a table of type-checked code (T047).
//
// The fixture proves one access: booking's repository reading `reviews` through a module-level
// client. This table proves the other ways a module reaches a table — a transaction client, a
// client passed in as a parameter, a delegate kept in a local, a delegate destructured out of the
// client (plain, renamed, nested, as a parameter) — and the places the rule must stay silent: a
// module's own table, read directly or destructured, the kernel's `idempotency_keys`, `$`-prefixed
// client members that name no table, a member with the same name on something that is not the
// database client, and every file outside `apps/api`. Raw SQL has its own rows: `$queryRaw`,
// `$executeRaw` and the `Unsafe` pair are refused anywhere in `apps/api` except under
// `apps/api/src/platform/db/`, the kernel folder that owns the typed helpers (decision of
// 2026-09-28, note under T047). The all-tables case walks all 33 manifest tables through the rule
// from a job file, which is how the delegate-to-table mapping is proved against the real manifest
// rather than against a copy of it.
//
// Each case declares a small `@prisma/client` in its own code, the way the fixture stub does, so
// the rule meets the shape it will meet in generated code — the delegates are members of a class
// named `PrismaClient` inside that module — without a generated client existing (T055–T063).
// Cases are scripts, with no top-level import or export, so the declaration is ambient as in the
// stub; inside a module file it would be an augmentation of a package that does not exist.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repositoryRoot } from '../support/lint-contract';
import { loadRule, typeAwareRuleTester, virtualFile } from '../support/rule-tester';

const manifest = JSON.parse(
  readFileSync(path.join(repositoryRoot, 'packages', 'config', 'module-tables.json'), 'utf8'),
) as Record<string, unknown>;

/** Every table in the manifest with its owner, `$comment` skipped (note under T016). */
const ownedTables = Object.entries(manifest)
  .filter(([owner]) => !owner.startsWith('$'))
  .flatMap(([owner, tables]) => (tables as string[]).map((table) => ({ owner, table })));

/** Prisma's convention in reverse, written out independently of the rule so the two can disagree. */
const expectedDelegates: Readonly<Record<string, string>> = {
  users: 'user',
  user_roles: 'userRole',
  teacher_profiles: 'teacherProfile',
  otp_codes: 'otpCode',
  device_push_tokens: 'devicePushToken',
  terms_acceptances: 'termsAcceptance',
  verification_documents: 'verificationDocument',
  verification_requests: 'verificationRequest',
  subjects: 'subject',
  teacher_subjects: 'teacherSubject',
  packages: 'package',
  availability_slots: 'availabilitySlot',
  isnad_entries: 'isnadEntry',
  teacher_signatures: 'teacherSignature',
  slot_holds: 'slotHold',
  enrollments: 'enrollment',
  payments: 'payment',
  payment_events: 'paymentEvent',
  sessions: 'session',
  session_participant_events: 'sessionParticipantEvent',
  cancellation_requests: 'cancellationRequest',
  chat_messages: 'chatMessage',
  ijazahs: 'ijazah',
  ijazah_bars: 'ijazahBar',
  reviews: 'review',
  disputes: 'dispute',
  gender_flags: 'genderFlag',
  user_reports: 'userReport',
  notifications: 'notification',
  admin_users: 'adminUser',
  audit_logs: 'auditLog',
  settings: 'setting',
  idempotency_keys: 'idempotencyKey',
};

describe('module-tables.json maps onto Prisma delegates (T047)', () => {
  it('holds the ERD’s 33 tables, each under one owner', () => {
    const tables = ownedTables.map(({ table }) => table);
    expect(tables).toHaveLength(33);
    expect(new Set(tables).size).toBe(33);
  });

  it('gives 33 distinct delegates, one per table', () => {
    expect(Object.keys(expectedDelegates).sort()).toEqual(
      ownedTables.map(({ table }) => table).sort(),
    );
    expect(new Set(Object.values(expectedDelegates)).size).toBe(33);
  });
});

function client(delegates: readonly string[]): string {
  const members = delegates.map((delegate) => `    readonly ${delegate}: Delegate;`).join('\n');
  return [
    "declare module '@prisma/client' {",
    '  interface Delegate {',
    '    findMany(args?: unknown): Promise<unknown[]>;',
    '    readonly fields: { readonly id: unknown };',
    '  }',
    '  export class PrismaClient {',
    members,
    "    $transaction<T>(run: (tx: Omit<PrismaClient, '$transaction'>) => Promise<T>): Promise<T>;",
    '    $connect(): Promise<void>;',
    // The raw SQL surface, declared here because the fixture stub declares none of it: the
    // tagged pair takes a template, the `Unsafe` pair a string.
    '    $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;',
    '    $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;',
    '    $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;',
    '    $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;',
    '  }',
    '}',
    "declare const prisma: import('@prisma/client').PrismaClient;",
  ].join('\n');
}

const shortClient = client(['review', 'enrollment', 'slotHold', 'idempotencyKey', 'lessonPlan']);

/** Lines the client preamble occupies, so a case can pin a report to its own line. */
const clientLines = shortClient.split('\n').length;

function withClient(code: string): string {
  return `${shortClient}\n${code}`;
}

const bookingRepository = virtualFile('apps/api/src/modules/booking/booking.repository.ts');
const bookingService = virtualFile('apps/api/src/modules/booking/booking.service.ts');
const reviewsRepository = virtualFile('apps/api/src/modules/reviews/reviews.repository.ts');
const kernel = virtualFile('apps/api/src/platform/idempotency/idempotency.repository.ts');
const kernelDb = virtualFile('apps/api/src/platform/db/lock-row.ts');
const job = virtualFile('apps/api/src/jobs/expire-holds.ts');
const worker = virtualFile('apps/api/src/worker.ts');
const seed = virtualFile('prisma/seed.ts');

typeAwareRuleTester().run('api/table-ownership', loadRule('table-ownership.js'), {
  valid: [
    {
      name: 'a module reading its own table',
      code: withClient('async function own() { return prisma.enrollment.findMany(); }\nown();'),
      filename: bookingRepository,
    },
    {
      name: 'a module’s own tables inside a transaction',
      code: withClient(
        'prisma.$transaction(async (tx) => { await tx.slotHold.findMany(); return tx.enrollment.findMany(); });',
      ),
      filename: bookingRepository,
    },
    {
      name: 'the reviews module reading reviews, through the delegate’s own fields too',
      code: withClient('prisma.review.findMany();\nvoid prisma.review.fields.id;'),
      filename: reviewsRepository,
    },
    {
      name: 'the kernel owns idempotency_keys',
      code: withClient('prisma.idempotencyKey.findMany();'),
      filename: kernel,
    },
    {
      name: 'a $ member that names no table and no SQL',
      code: withClient('prisma.$transaction(async () => 0);\nprisma.$connect();'),
      filename: bookingRepository,
    },
    {
      name: 'raw SQL inside the kernel’s db folder, the one place a typed helper may write it',
      code: withClient(
        'prisma.$queryRaw`select 1`;\nprisma.$transaction(async (tx) => tx.$executeRaw`select 1`);',
      ),
      filename: kernelDb,
    },
    {
      name: 'a member called review on something that is not the database client',
      code: 'declare const form: { review: { findMany(): void } };\nform.review.findMany();',
      filename: bookingRepository,
    },
    {
      name: 'a module destructuring its own delegate in its own repository',
      code: withClient(
        'const { enrollment, slotHold: holds } = prisma;\nenrollment.findMany();\nholds.findMany();',
      ),
      filename: bookingRepository,
    },
    {
      name: 'the seed, outside apps/api, may touch any table and write any SQL',
      code: withClient(
        'prisma.review.findMany();\nprisma.idempotencyKey.findMany();\nprisma.$queryRawUnsafe("select 1");',
      ),
      filename: seed,
    },
  ],
  invalid: [
    {
      name: 'the fixture’s shape: booking reading reviews, naming the owner',
      code: withClient('prisma.review.findMany();'),
      filename: bookingRepository,
      errors: [
        {
          messageId: 'foreignTable',
          data: { module: 'booking', table: 'reviews', delegate: 'review', owner: 'reviews' },
        },
      ],
    },
    {
      name: 'another module’s table from a transaction client',
      code: withClient('prisma.$transaction(async (tx) => tx.review.findMany());'),
      filename: bookingRepository,
      errors: [{ messageId: 'foreignTable' }],
    },
    {
      name: 'a client passed in as a parameter',
      code: withClient(
        "function read(db: import('@prisma/client').PrismaClient) { return db.idempotencyKey.findMany(); }\nread(prisma);",
      ),
      filename: bookingService,
      errors: [
        {
          messageId: 'foreignTable',
          data: {
            module: 'booking',
            table: 'idempotency_keys',
            delegate: 'idempotencyKey',
            owner: 'platform',
          },
        },
      ],
    },
    {
      name: 'a delegate kept in a local is the same access',
      code: withClient('const reviews = prisma.review;\nreviews.findMany();'),
      filename: kernel,
      errors: [
        {
          messageId: 'foreignTable',
          data: { module: 'platform', table: 'reviews', delegate: 'review', owner: 'reviews' },
        },
      ],
    },
    {
      name: 'a delegate with no table in the manifest',
      code: withClient('prisma.lessonPlan.findMany();'),
      filename: reviewsRepository,
      errors: [{ messageId: 'unknownDelegate', data: { delegate: 'lessonPlan' } }],
    },
    {
      name: 'a delegate destructured out of the client, reported on the property',
      code: withClient('const { review } = prisma;\nreview.findMany();'),
      filename: bookingRepository,
      errors: [
        {
          messageId: 'foreignTable',
          data: { module: 'booking', table: 'reviews', delegate: 'review', owner: 'reviews' },
        },
      ],
    },
    {
      name: 'a delegate destructured under another name out of a transaction client, reported on the property',
      code: withClient(
        'prisma.$transaction(async (tx) => {\n  const { review: r } = tx;\n  return r.findMany();\n});',
      ),
      filename: bookingRepository,
      errors: [
        {
          messageId: 'foreignTable',
          data: { module: 'booking', table: 'reviews', delegate: 'review', owner: 'reviews' },
          // The whole `review: r` property, not just its key: the report lands on the pattern
          // property, so the fix is pointed at the destructuring.
          line: clientLines + 2,
          column: 11,
          endColumn: 20,
        },
      ],
    },
    {
      name: 'a delegate destructured in a parameter',
      code: withClient(
        "function read({ review }: import('@prisma/client').PrismaClient) { return review.findMany(); }\nread(prisma);",
      ),
      filename: bookingService,
      errors: [
        {
          messageId: 'foreignTable',
          data: { module: 'booking', table: 'reviews', delegate: 'review', owner: 'reviews' },
        },
      ],
    },
    {
      name: 'a nested destructuring reports the delegate once, not its members',
      code: withClient('const { review: { findMany } } = prisma;\nfindMany();'),
      filename: kernel,
      errors: [
        {
          messageId: 'foreignTable',
          data: { module: 'platform', table: 'reviews', delegate: 'review', owner: 'reviews' },
        },
      ],
    },
    {
      name: 'a job destructuring a table it may not touch from outside every module',
      code: withClient('const { slotHold } = prisma;\nslotHold.findMany();'),
      filename: job,
      errors: [
        {
          messageId: 'outsideModules',
          data: { delegate: 'slotHold', table: 'slot_holds', owner: 'booking' },
        },
      ],
    },
    {
      name: 'a tagged raw query in a module repository',
      code: withClient('prisma.$queryRaw`select 1`;'),
      filename: bookingRepository,
      errors: [{ messageId: 'rawSql', data: { member: '$queryRaw' } }],
    },
    {
      name: 'an unsafe raw statement, refused even in a kernel folder that is not db',
      code: withClient('prisma.$executeRawUnsafe("delete from reviews");'),
      filename: kernel,
      errors: [{ messageId: 'rawSqlUnsafe', data: { member: '$executeRawUnsafe' } }],
    },
    {
      name: 'a raw query through a transaction client from a job',
      code: withClient('prisma.$transaction(async (tx) => tx.$queryRaw`select 1`);'),
      filename: job,
      errors: [{ messageId: 'rawSql', data: { member: '$queryRaw' } }],
    },
    {
      name: 'raw SQL destructured out of the client is the same access',
      code: withClient('const { $queryRawUnsafe: raw } = prisma;\nraw("select 1");'),
      filename: bookingRepository,
      errors: [{ messageId: 'rawSqlUnsafe', data: { member: '$queryRawUnsafe' } }],
    },
    {
      name: 'a job reading a table directly instead of through its owner',
      code: withClient('prisma.slotHold.findMany();'),
      filename: job,
      errors: [
        {
          messageId: 'outsideModules',
          data: { delegate: 'slotHold', table: 'slot_holds', owner: 'booking' },
        },
      ],
    },
    {
      name: 'an entrypoint reading a table directly',
      code: withClient('prisma.enrollment.findMany();'),
      filename: worker,
      errors: [
        {
          messageId: 'outsideModules',
          data: { delegate: 'enrollment', table: 'enrollments', owner: 'booking' },
        },
      ],
    },
    {
      name: 'all 33 manifest tables, each reached through the delegate Prisma would generate',
      code: [
        client(Object.values(expectedDelegates)),
        ...ownedTables.map(({ table }) => `prisma.${expectedDelegates[table]}.findMany();`),
      ].join('\n'),
      filename: job,
      errors: ownedTables.map(({ owner, table }) => ({
        messageId: 'outsideModules',
        data: { delegate: expectedDelegates[table], table, owner },
      })),
    },
  ],
});
