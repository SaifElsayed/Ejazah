// api/table-ownership (R-API-6) against a table of type-checked code (T047).
//
// The fixture proves one access: booking's repository reading `reviews` through a module-level
// client. This table proves the rest of the contract row and its notes
// (`specs/001-foundations/contracts/lint-rules.md`), and every way around the rule the two reviews
// of PR #27 found:
//
//   - who may reach a table: only a repository file of the module, or of the kernel, that owns it.
//     A service querying its own module's table is refused, and so are a spec file that is not a
//     repository spec and a kernel file that is not a repository reading the kernel's table; the
//     kernel's repository under `platform/db/` reading a module's table is a foreign table. A
//     `<name>.repository.spec.<extension>` file is a repository file of its module and gains
//     nothing else, and a file named `.repository.ts` with nothing in front is not one.
//   - what the database client is: a module-level client, a client passed as a parameter, the
//     transaction client, and a client returned by `$extends`, whose delegates are mapped members
//     that no `PrismaClient` declaration carries — also behind the standard library's `Omit`,
//     `Readonly` and `Pick`, which is how an extended client's transaction client arrives. The
//     client module and its namespaces are not the client, and a property an intersection adds
//     beside the client is not a delegate, while an extended client inside an intersection keeps
//     the delegates its mapped part holds.
//   - every spelling that reaches a member: dot access, a computed literal key, a literal-typed
//     key, declaration destructuring (plain, renamed, nested, computed, as a parameter) and
//     assignment-expression destructuring. A key the rule cannot resolve is refused, and so is the
//     client handed to `Reflect.get`, `Reflect.ownKeys`, `Object.values`, `Object.entries` or
//     `Object.getOwnPropertyDescriptors`.
//   - client members, refused by default: every `$` member other than `$transaction` outside
//     `apps/api/src/platform/db/` (`$queryRawTyped`, `$connect` and `$extends` with the rest, so
//     nothing is on a list that a new entry point could miss), and the `Unsafe` pair everywhere in
//     `apps/api`, the kernel's `db` folder included.
//
// And the places the rule must stay silent: a repository on its own module's tables, the kernel's
// `idempotency_keys`, `$transaction`, a member with the same name on something that is not the
// database client, and every file outside `apps/api`. The all-tables case walks all 39 manifest
// tables through the rule from a job file, which is how the delegate-to-table mapping is proved
// against the real manifest rather than against a copy of it.
//
// Each case declares a small `@prisma/client` in its own code, the way the fixture stub does, so
// the rule meets the shape it will meet in generated code — the delegates are members of a class
// named `PrismaClient` inside that module — without a generated client existing (T055–T063).
// Cases are scripts, with no top-level import or export, so the declaration is ambient as in the
// stub; inside a module file it would be an augmentation of a package that does not exist.
//
// The spec uses exactly eight virtual file names, which is the cap typescript-eslint puts on the
// files one process may open in the default project (`tests/support/rule-tester.ts`): a ninth
// name fails every case with that cap's error. A new case reuses one of the eight. The second
// review of PR #27 needed a service's spec file and a kernel repository under `platform/db/`, so
// the eight were rearranged: the kernel is now one repository inside `platform/db/` and one
// non-repository file outside it (which carries the nameless `.repository.ts` case too), and the
// entrypoint `apps/api/src/worker.ts` was dropped, because a job is outside every module in the
// same way and `jobs/expire-holds.ts` keeps those cases. The final check of PR #27 restored the
// case that a file under `platform/db/` that is not a repository may use the client's `$` members,
// so the least-used name, the service's spec file `booking.service.spec.ts`, became
// `platform/db/lock-row.spec.ts`: a spec file that is not a repository spec, which its one case
// still needs, and a non-repository file inside `platform/db/`, which the restored case needs.

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
  // Phase 1 (T003, specs/002-identity/data-model.md §1).
  user_sessions: 'userSession',
  user_session_retired_tokens: 'userSessionRetiredToken',
  auth_identities: 'authIdentity',
  teacher_credentials: 'teacherCredential',
  session_remedies: 'sessionRemedy',
  admin_sessions: 'adminSession',
  admin_recovery_codes: 'adminRecoveryCode',
  // T097 (FR-155).
  banned_identifiers: 'bannedIdentifier',
  // Phase 2's T004 (specs/003-booking/data-model.md §2.5).
  enrollment_events: 'enrollmentEvent',
};

describe('module-tables.json maps onto Prisma delegates (T047)', () => {
  it('holds the ERD’s 42 tables, each under one owner (33 of Phase 0, the six of T003, the one of T094, the one of T097, the one of Phase 2’s T004)', () => {
    const tables = ownedTables.map(({ table }) => table);
    expect(tables).toHaveLength(42);
    expect(new Set(tables).size).toBe(42);
  });

  it('gives 42 distinct delegates, one per table', () => {
    expect(Object.keys(expectedDelegates).sort()).toEqual(
      ownedTables.map(({ table }) => table).sort(),
    );
    expect(new Set(Object.values(expectedDelegates)).size).toBe(42);
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
    // What `$extends` returns. In generated code it is a mapped type declared in the client
    // module, so its delegates are not members any `PrismaClient` declaration carries; the rule
    // has to recognise the client by the type, and this is the shape that makes it.
    "  type ExtendedClient = { readonly [K in 'review' | 'enrollment']: Delegate } & {",
    '    $extends(extension: unknown): ExtendedClient;',
    '    $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;',
    // Its interactive transaction client is the standard library's `Omit` of it, so neither the
    // alias nor a `PrismaClient` declaration is left to recognise it by (second review, Major 3).
    "    $transaction<T>(run: (tx: Omit<ExtendedClient, '$transaction' | '$extends'>) => Promise<T>): Promise<T>;",
    '  };',
    // Namespaces the generated module exports beside the client; neither is the client.
    "  export namespace $Enums { const Gender: { readonly male: 'male'; readonly female: 'female' }; }",
    '  export namespace Prisma { function raw(text: string): unknown; }',
    '  export class PrismaClient {',
    members,
    "    $transaction<T>(run: (tx: Omit<PrismaClient, '$transaction'>) => Promise<T>): Promise<T>;",
    '    $connect(): Promise<void>;',
    '    $extends(extension: unknown): ExtendedClient;',
    // The raw SQL surface, declared here because the fixture stub declares none of it: the
    // tagged pair takes a template, the `Unsafe` pair a string, and `$queryRawTyped` stands for
    // any entry point the rule was never told about.
    '    $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;',
    '    $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;',
    '    $queryRawTyped(query: { readonly sql: string }): Promise<unknown>;',
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

// The eight virtual file names. The default project opens no more (see the header).
const bookingRepository = virtualFile('apps/api/src/modules/booking/booking.repository.ts');
const bookingRepositorySpec = virtualFile(
  'apps/api/src/modules/booking/booking.repository.spec.ts',
);
const bookingService = virtualFile('apps/api/src/modules/booking/booking.service.ts');
// The kernel's repository, inside `platform/db/`: a repository file, and where `$` members live.
const kernelRepository = virtualFile('apps/api/src/platform/db/prisma.repository.ts');
// A spec file inside `platform/db/` that is neither a repository nor a repository spec: it may use
// `$` members, and it may not reach a table.
const kernelDbSpec = virtualFile('apps/api/src/platform/db/lock-row.spec.ts');
// A kernel file outside `platform/db/` that is not a repository file. Its name is `.repository.ts`
// with nothing in front, which since the second review (Nit 11) is not a repository name, so this
// one file proves that too.
const kernelFile = virtualFile('apps/api/src/platform/idempotency/.repository.ts');
const job = virtualFile('apps/api/src/jobs/expire-holds.ts');
const seed = virtualFile('prisma/seed.ts');

const reviewsFromBooking = {
  messageId: 'foreignTable',
  data: { module: 'booking', table: 'reviews', delegate: 'review', owner: 'reviews' },
} as const;

const enrollmentsOutsideARepository = {
  messageId: 'notRepository',
  data: { delegate: 'enrollment', table: 'enrollments', owner: 'booking' },
} as const;

typeAwareRuleTester().run('api/table-ownership', loadRule('table-ownership.js'), {
  valid: [
    {
      name: 'a module’s repository reading its own table, through the delegate’s own fields too',
      code: withClient(
        'async function own() { return prisma.enrollment.findMany(); }\nown();\nvoid prisma.enrollment.fields.id;',
      ),
      filename: bookingRepository,
    },
    {
      name: 'a module’s own tables inside a transaction, the one client member a module may use',
      code: withClient(
        'prisma.$transaction(async (tx) => { await tx.slotHold.findMany(); return tx.enrollment.findMany(); });',
      ),
      filename: bookingRepository,
    },
    {
      name: 'the kernel’s repository owns idempotency_keys',
      code: withClient('prisma.idempotencyKey.findMany();'),
      filename: kernelRepository,
    },
    {
      name: 'a repository spec file is a repository file of its module',
      code: withClient(
        'prisma.$transaction(async (tx) => tx.slotHold.findMany());\nconst { enrollment } = prisma;\nenrollment.findMany();',
      ),
      filename: bookingRepositorySpec,
    },
    {
      name: 'tagged raw SQL and other client members inside the kernel’s db folder',
      code: withClient(
        'prisma.$queryRaw`select 1`;\nprisma.$transaction(async (tx) => tx.$executeRaw`select 1`);\nprisma.$connect();\nprisma.$queryRawTyped({ sql: "select 1" });\nvoid prisma.$extends({});',
      ),
      filename: kernelRepository,
    },
    {
      name: 'tagged raw SQL and other client members in a kernel db file that is not a repository (final check D)',
      code: withClient(
        'prisma.$queryRaw`select 1`;\nprisma.$transaction(async (tx) => tx.$executeRaw`select 1`);\nprisma.$connect();\nprisma.$queryRawTyped({ sql: "select 1" });\nvoid prisma.$extends({});',
      ),
      filename: kernelDbSpec,
    },
    {
      name: 'a callee object named like an Object.prototype member is not a reflective read (final check B)',
      code: "const { hasOwnProperty } = Object.prototype;\nconst o = { a: 1 };\nvoid hasOwnProperty.call(o, 'a');\ndeclare const constructor: { make(x: number): number };\nvoid constructor.make(1);",
      filename: bookingService,
    },
    {
      name: 'a member called review on something that is not the database client',
      code: 'declare const form: { review: { findMany(): void }; $queryRawUnsafe(text: string): void };\ndeclare const key: string;\nform.review.findMany();\nform["review"].findMany();\nform.$queryRawUnsafe("x");\nvoid form[key];',
      filename: bookingRepository,
    },
    {
      name: 'a module destructuring its own delegates in its own repository, by any spelling',
      code: withClient(
        'const { enrollment, slotHold: holds } = prisma;\nenrollment.findMany();\nholds.findMany();\nprisma["slotHold"].findMany();\nlet again;\n({ enrollment: again } = prisma);\nagain.findMany();',
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
    {
      name: 'an extended client’s transaction client on the module’s own table (Major 3)',
      code: withClient(
        "declare const extended: ReturnType<import('@prisma/client').PrismaClient['$extends']>;\nextended.$transaction(async (tx) => tx.enrollment.findMany());",
      ),
      filename: bookingRepository,
    },
    {
      name: 'the client module and its namespaces are not the client (Minor 5)',
      code: withClient(
        "declare const db: typeof import('@prisma/client');\nvoid db.PrismaClient;\nvoid db.Prisma.raw('x');\nvoid db.$Enums.Gender.male;",
      ),
      filename: bookingRepository,
    },
    {
      name: 'a property an intersection adds beside the client is not a delegate (Minor 5)',
      code: withClient(
        'declare const plus: typeof prisma & { extra: number; $note: string };\nvoid plus.extra;\nvoid plus.$note;',
      ),
      filename: bookingRepository,
    },
  ],
  invalid: [
    {
      name: 'the fixture’s shape: booking reading reviews, naming the owner',
      code: withClient('prisma.review.findMany();'),
      filename: bookingRepository,
      errors: [reviewsFromBooking],
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
      filename: kernelFile,
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
      filename: bookingRepository,
      errors: [{ messageId: 'unknownDelegate', data: { delegate: 'lessonPlan' } }],
    },

    // Who may reach a table: a repository file of its owner, and no other file.
    {
      name: 'a service querying its own module’s table through an injected client (Saif 9)',
      code: withClient(
        "function enrollments(db: import('@prisma/client').PrismaClient) { return db.enrollment.findMany(); }\nenrollments(prisma);",
      ),
      filename: bookingService,
      errors: [enrollmentsOutsideARepository],
    },
    {
      name: 'a service destructuring its own module’s delegate',
      code: withClient('const { enrollment } = prisma;\nenrollment.findMany();'),
      filename: bookingService,
      errors: [enrollmentsOutsideARepository],
    },
    {
      name: 'the kernel’s own table from a kernel file that is not a repository, named .repository.ts with nothing in front (Nit 11)',
      code: withClient('prisma.idempotencyKey.findMany();'),
      filename: kernelFile,
      errors: [
        {
          messageId: 'notRepository',
          data: { delegate: 'idempotencyKey', table: 'idempotency_keys', owner: 'platform' },
        },
      ],
    },
    {
      name: 'a repository spec file reading another owner’s table (Saif 16)',
      code: withClient('prisma.review.findMany();'),
      filename: bookingRepositorySpec,
      errors: [reviewsFromBooking],
    },
    {
      name: 'a repository spec file gains no client member',
      code: withClient('prisma.$executeRaw`truncate enrollments`;'),
      filename: bookingRepositorySpec,
      errors: [{ messageId: 'clientMember', data: { member: '$executeRaw' } }],
    },

    // Every spelling that reaches a member.
    {
      name: 'a computed access with a literal key (Omar 3, Saif 8)',
      code: withClient("prisma['review'].findMany();"),
      filename: bookingRepository,
      errors: [reviewsFromBooking],
    },
    {
      name: 'a computed access with a literal-typed key (Saif 8)',
      code: withClient("const k = 'review' as const;\nprisma[k].findMany();"),
      filename: bookingRepository,
      errors: [reviewsFromBooking],
    },
    {
      name: 'a key typed as a union of literals is each of them',
      code: withClient("declare const k: 'review' | 'enrollment';\nprisma[k].findMany();"),
      filename: bookingRepository,
      errors: [reviewsFromBooking],
    },
    {
      name: 'a template literal key with nothing to substitute',
      code: withClient('prisma[`review`].findMany();'),
      filename: bookingRepository,
      errors: [reviewsFromBooking],
    },
    {
      name: 'a key the rule cannot resolve is refused, on a table the file owns or not (Omar 3)',
      code: withClient('declare const someString: string;\nvoid prisma[someString];'),
      filename: bookingRepository,
      errors: [{ messageId: 'unresolvedMember' }],
    },
    {
      name: 'an unresolved key on a transaction client',
      code: withClient(
        'declare const someString: string;\nprisma.$transaction(async (tx) => tx[someString]);',
      ),
      filename: bookingRepository,
      errors: [{ messageId: 'unresolvedMember' }],
    },
    {
      name: 'a delegate destructured out of the client, reported on the property',
      code: withClient('const { review } = prisma;\nreview.findMany();'),
      filename: bookingRepository,
      errors: [reviewsFromBooking],
    },
    {
      name: 'a delegate destructured under another name out of a transaction client, reported on the property',
      code: withClient(
        'prisma.$transaction(async (tx) => {\n  const { review: r } = tx;\n  return r.findMany();\n});',
      ),
      filename: bookingRepository,
      errors: [
        {
          ...reviewsFromBooking,
          // The whole `review: r` property, not just its key: the report lands on the pattern
          // property, so the fix is pointed at the destructuring.
          line: clientLines + 2,
          column: 11,
          endColumn: 20,
        },
      ],
    },
    {
      name: 'a delegate destructured under a computed key (Saif 8)',
      code: withClient("const { ['review']: r } = prisma;\nr.findMany();"),
      filename: bookingRepository,
      errors: [reviewsFromBooking],
    },
    {
      name: 'a destructuring whose computed key cannot be resolved',
      code: withClient(
        'declare const someString: string;\nconst { [someString]: r } = prisma;\nvoid r;',
      ),
      filename: bookingRepository,
      errors: [{ messageId: 'unresolvedMember' }],
    },
    {
      name: 'an assignment-expression destructuring (Saif 8)',
      code: withClient('let r;\n({ review: r } = prisma);\nr.findMany();'),
      filename: bookingRepository,
      errors: [reviewsFromBooking],
    },
    {
      name: 'a nested assignment-expression destructuring reaches the client under its key',
      code: withClient(
        'declare const context: { readonly db: typeof prisma };\nlet r;\n({ db: { review: r } } = context);\nr.findMany();',
      ),
      filename: bookingRepository,
      errors: [reviewsFromBooking],
    },
    {
      name: 'a delegate destructured in a parameter',
      code: withClient(
        "function read({ review }: import('@prisma/client').PrismaClient) { return review.findMany(); }\nread(prisma);",
      ),
      filename: bookingService,
      errors: [reviewsFromBooking],
    },
    {
      name: 'a nested destructuring reports the delegate once, not its members',
      code: withClient('const { review: { findMany } } = prisma;\nfindMany();'),
      filename: kernelFile,
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

    // A client returned by `$extends` is the database client.
    {
      name: 'a delegate of an extended client, which no PrismaClient declaration carries',
      code: withClient(
        "declare const extended: ReturnType<import('@prisma/client').PrismaClient['$extends']>;\nextended.review.findMany();\nextended['review'].findMany();\nconst { review } = extended;\nvoid review;",
      ),
      filename: bookingRepository,
      errors: [reviewsFromBooking, reviewsFromBooking, reviewsFromBooking],
    },
    {
      name: 'an extended client in a service, on the module’s own table and on its members',
      code: withClient(
        "declare const extended: ReturnType<import('@prisma/client').PrismaClient['$extends']>;\ndeclare const someString: string;\nextended.enrollment.findMany();\nextended.$queryRawUnsafe('select 1');\nvoid extended.$extends({});\nvoid extended[someString];",
      ),
      filename: bookingService,
      errors: [
        enrollmentsOutsideARepository,
        { messageId: 'rawSqlUnsafe', data: { member: '$queryRawUnsafe' } },
        { messageId: 'clientMember', data: { member: '$extends' } },
        { messageId: 'unresolvedMember' },
      ],
    },

    // An extended client behind the standard library's wrappers (second review, Major 3).
    {
      name: 'another module’s table from an extended client’s transaction client (Major 3)',
      code: withClient(
        "declare const extended: ReturnType<import('@prisma/client').PrismaClient['$extends']>;\nextended.$transaction(async (tx) => tx.review.findMany());",
      ),
      filename: bookingRepository,
      errors: [reviewsFromBooking],
    },
    {
      name: 'an Unsafe raw query from an extended client’s transaction client (Major 3)',
      code: withClient(
        "declare const extended: ReturnType<import('@prisma/client').PrismaClient['$extends']>;\nextended.$transaction(async (tx) => tx.$queryRawUnsafe('delete from reviews'));",
      ),
      filename: bookingRepository,
      errors: [{ messageId: 'rawSqlUnsafe', data: { member: '$queryRawUnsafe' } }],
    },
    {
      name: 'an unresolved key on an extended client’s transaction client (Major 3)',
      code: withClient(
        "declare const extended: ReturnType<import('@prisma/client').PrismaClient['$extends']>;\ndeclare const someString: string;\nextended.$transaction(async (tx) => tx[someString]);",
      ),
      filename: bookingRepository,
      errors: [{ messageId: 'unresolvedMember' }],
    },
    {
      name: 'an extended client under Readonly and Pick in a service (Major 3)',
      code: withClient(
        "declare const extended: ReturnType<import('@prisma/client').PrismaClient['$extends']>;\ndeclare const frozen: Readonly<typeof extended>;\nfrozen.review.findMany();\ndeclare const picked: Pick<typeof extended, 'review'>;\npicked.review.findMany();",
      ),
      filename: bookingService,
      errors: [reviewsFromBooking, reviewsFromBooking],
    },
    {
      name: 'the real delegates are still refused through an intersection with extra members (Minor 5)',
      code: withClient(
        'declare const plus: typeof prisma & { extra: number };\nplus.review.findMany();\nvoid plus.extra;',
      ),
      filename: bookingRepository,
      errors: [reviewsFromBooking],
    },
    {
      name: 'an extended client inside an intersection keeps its delegates; the added parts are not delegates (final check A)',
      code: withClient(
        "declare const extended: ReturnType<import('@prisma/client').PrismaClient['$extends']>;\ndeclare const ext: typeof extended & { extra: number; $note: string };\next.review.findMany();\nvoid ext.extra;\nvoid ext.$note;",
      ),
      filename: bookingRepository,
      errors: [reviewsFromBooking],
    },
    {
      name: 'a type parameter constrained to an extended client inside an intersection (final check A)',
      code: withClient(
        "declare const extended: ReturnType<import('@prisma/client').PrismaClient['$extends']>;\nfunction f<E extends typeof extended & { extra: number }>(e: E) { return e.review.findMany(); }\nvoid f;",
      ),
      filename: bookingRepository,
      errors: [reviewsFromBooking],
    },

    // A call that reads every member of the client names none of them (Minor 6).
    {
      name: 'the client handed to Reflect.get and Reflect.ownKeys (Minor 6)',
      code: withClient("void Reflect.get(prisma, 'review');\nvoid Reflect.ownKeys(prisma);"),
      filename: bookingRepository,
      errors: [{ messageId: 'unresolvedMember' }, { messageId: 'unresolvedMember' }],
    },
    {
      name: 'the client handed to Object.values, Object.entries and Object.getOwnPropertyDescriptors (Minor 6)',
      code: withClient(
        'void Object.values(prisma);\nvoid Object.entries(prisma);\nvoid Object.getOwnPropertyDescriptors(prisma);',
      ),
      filename: bookingRepository,
      errors: [
        { messageId: 'unresolvedMember' },
        { messageId: 'unresolvedMember' },
        { messageId: 'unresolvedMember' },
      ],
    },

    // Who may reach a table, the two shapes the second review found untested (Minor 7).
    {
      name: 'a spec file that is not a repository spec, on its own module’s table, inside platform/db too (Minor 7)',
      code: withClient('prisma.idempotencyKey.findMany();'),
      filename: kernelDbSpec,
      errors: [
        {
          messageId: 'notRepository',
          data: { delegate: 'idempotencyKey', table: 'idempotency_keys', owner: 'platform' },
        },
      ],
    },
    {
      name: 'the kernel’s repository under platform/db reading a module’s table (Minor 7)',
      code: withClient('prisma.review.findMany();'),
      filename: kernelRepository,
      errors: [
        {
          messageId: 'foreignTable',
          data: { module: 'platform', table: 'reviews', delegate: 'review', owner: 'reviews' },
        },
      ],
    },

    // Client members are refused by default.
    {
      name: 'a tagged raw query in a module repository',
      code: withClient('prisma.$queryRaw`select 1`;'),
      filename: bookingRepository,
      errors: [{ messageId: 'clientMember', data: { member: '$queryRaw' } }],
    },
    {
      name: 'a raw entry point the rule was never told about (Omar 4, Saif 14)',
      code: withClient('prisma.$queryRawTyped({ sql: "select 1" });'),
      filename: bookingRepository,
      errors: [{ messageId: 'clientMember', data: { member: '$queryRawTyped' } }],
    },
    {
      name: 'every other $ member outside the kernel’s db folder: $connect and $extends',
      code: withClient('prisma.$connect();\nvoid prisma.$extends({});'),
      filename: kernelFile,
      errors: [
        { messageId: 'clientMember', data: { member: '$connect' } },
        { messageId: 'clientMember', data: { member: '$extends' } },
      ],
    },
    {
      name: 'an unsafe raw statement, refused in a kernel folder that is not db',
      code: withClient('prisma.$executeRawUnsafe("delete from reviews");'),
      filename: kernelFile,
      errors: [{ messageId: 'rawSqlUnsafe', data: { member: '$executeRawUnsafe' } }],
    },
    {
      name: 'the Unsafe pair inside the kernel’s db folder, by any spelling (Omar 5)',
      code: withClient(
        'prisma.$queryRawUnsafe("select 1");\nprisma.$transaction(async (tx) => tx.$executeRawUnsafe("select 1"));\nprisma["$queryRawUnsafe"]("select 1");\nconst { $executeRawUnsafe: run } = prisma;\nvoid run;',
      ),
      filename: kernelRepository,
      errors: [
        { messageId: 'rawSqlUnsafe', data: { member: '$queryRawUnsafe' } },
        { messageId: 'rawSqlUnsafe', data: { member: '$executeRawUnsafe' } },
        { messageId: 'rawSqlUnsafe', data: { member: '$queryRawUnsafe' } },
        { messageId: 'rawSqlUnsafe', data: { member: '$executeRawUnsafe' } },
      ],
    },
    {
      name: 'an unsafe raw query through a computed literal key (Saif 8)',
      code: withClient("prisma['$queryRawUnsafe']('delete from reviews');"),
      filename: bookingRepository,
      errors: [{ messageId: 'rawSqlUnsafe', data: { member: '$queryRawUnsafe' } }],
    },
    {
      name: 'a raw query through a transaction client from a job',
      code: withClient('prisma.$transaction(async (tx) => tx.$queryRaw`select 1`);'),
      filename: job,
      errors: [{ messageId: 'clientMember', data: { member: '$queryRaw' } }],
    },
    {
      name: 'raw SQL destructured out of the client is the same access',
      code: withClient('const { $queryRawUnsafe: raw } = prisma;\nraw("select 1");'),
      filename: bookingRepository,
      errors: [{ messageId: 'rawSqlUnsafe', data: { member: '$queryRawUnsafe' } }],
    },
    {
      name: 'a row lock written as raw SQL in a module repository, on its own table (Saif 15)',
      code: withClient(
        'prisma.$transaction(async (tx) => tx.$queryRaw`select id from enrollments for update`);',
      ),
      filename: bookingRepository,
      errors: [{ messageId: 'clientMember', data: { member: '$queryRaw' } }],
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
      name: 'all 41 manifest tables, each reached through the delegate Prisma would generate',
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
