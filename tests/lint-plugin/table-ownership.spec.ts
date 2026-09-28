// api/table-ownership (R-API-6) against a table of type-checked code (T047).
//
// The fixture proves one access: booking's repository reading `reviews` through a module-level
// client. This table proves the other ways a module reaches a table — a transaction client, a
// client passed in as a parameter, a delegate kept in a local — and the places the rule must stay
// silent: a module's own table, the kernel's `idempotency_keys`, `$`-prefixed client members,
// a member with the same name on something that is not the database client, and every file
// outside `apps/api`. The last case walks all 33 manifest tables through the rule from a job
// file, which is how the delegate-to-table mapping is proved against the real manifest rather
// than against a copy of it.
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
    '    $queryRaw(query: TemplateStringsArray): Promise<unknown>;',
    '  }',
    '}',
    "declare const prisma: import('@prisma/client').PrismaClient;",
  ].join('\n');
}

const shortClient = client(['review', 'enrollment', 'slotHold', 'idempotencyKey', 'lessonPlan']);

function withClient(code: string): string {
  return `${shortClient}\n${code}`;
}

const bookingRepository = virtualFile('apps/api/src/modules/booking/booking.repository.ts');
const bookingService = virtualFile('apps/api/src/modules/booking/booking.service.ts');
const reviewsRepository = virtualFile('apps/api/src/modules/reviews/reviews.repository.ts');
const kernel = virtualFile('apps/api/src/platform/idempotency/idempotency.repository.ts');
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
      name: 'raw SQL through a $ member names no table',
      code: withClient('prisma.$queryRaw`select 1`;'),
      filename: job,
    },
    {
      name: 'a member called review on something that is not the database client',
      code: 'declare const form: { review: { findMany(): void } };\nform.review.findMany();',
      filename: bookingRepository,
    },
    {
      name: 'the seed, outside apps/api, may touch any table',
      code: withClient('prisma.review.findMany();\nprisma.idempotencyKey.findMany();'),
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
