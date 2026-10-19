// db/no-unfiltered-relation-read (R-DB-3) against a table of code (T026, research R-116).
//
// A soft-deleted row is excluded from every ordinary read (ERD §0). A repository that reaches
// `users`, `sessions`, `enrollments` or `ijazahs` through a relation must exclude them there: a
// list relation carries `where: { deletedAt: null }`; a single relation cannot take a `where` in
// Prisma, so the query that includes it filters its own rows by it (`where: { user: { deletedAt:
// null } }`, or with `is`). The models and their relations are read from `prisma/schema/` at lint
// time, so the cases name real relations.

import { loadRule, typescriptRuleTester } from '../support/rule-tester';

const repository = 'apps/api/src/modules/booking/enrollments.repository.ts';
const service = 'apps/api/src/modules/booking/enrollments.service.ts';

typescriptRuleTester().run(
  'db/no-unfiltered-relation-read',
  loadRule('no-unfiltered-relation-read.js'),
  {
    valid: [
      {
        name: 'scalar fields only',
        code: 'export const r = (tx) => tx.user.findMany({ select: { id: true, email: true } });',
        filename: repository,
      },
      {
        name: 'a list relation filtered on the relation',
        code: 'export const r = (tx) => tx.enrollment.findMany({ include: { sessions: { where: { deletedAt: null } } } });',
        filename: repository,
      },
      {
        name: 'the filter beside other conditions',
        code: "export const r = (tx) => tx.enrollment.findMany({ select: { id: true, sessions: { where: { status: 'scheduled', deletedAt: null }, select: { id: true } } } });",
        filename: repository,
      },
      {
        name: 'a single relation, the query filtering its own rows by it',
        code: 'export const r = (tx) => tx.teacherProfile.findMany({ where: { user: { deletedAt: null } }, include: { user: true } });',
        filename: repository,
      },
      {
        name: 'a single relation filtered with is',
        code: 'export const r = (tx) => tx.teacherProfile.findUnique({ where: { userId: "u", user: { is: { deletedAt: null } } }, select: { user: { select: { email: true } } } });',
        filename: repository,
      },
      {
        name: 'a relation to a model with no soft deletion',
        code: 'export const r = (tx) => tx.enrollment.findMany({ include: { package: true, slot: true } });',
        filename: repository,
      },
      {
        name: 'a nested single relation filtered by the list it sits in',
        code: 'export const r = (tx) => tx.enrollment.findMany({ include: { sessions: { where: { deletedAt: null, teacher: { deletedAt: null } }, include: { teacher: true } } } });',
        filename: repository,
      },
      {
        name: 'a filtered count',
        code: 'export const r = (tx) => tx.enrollment.findMany({ select: { _count: { select: { sessions: { where: { deletedAt: null } } } } } });',
        filename: repository,
      },
      {
        name: 'a single relation nested in a single relation, filtered by the query (review of B7, 4)',
        code: 'export const r = (tx) => tx.session.findMany({ where: { deletedAt: null, enrollment: { deletedAt: null, student: { deletedAt: null } } }, include: { enrollment: { include: { student: true } } } });',
        filename: repository,
      },
      {
        name: 'a nested single relation filtered through is (review of B7, 4)',
        code: 'export const r = (tx) => tx.session.findMany({ where: { enrollment: { is: { deletedAt: null, student: { is: { deletedAt: null } } } } }, include: { enrollment: { include: { student: true } } } });',
        filename: repository,
      },
      {
        name: 'an optional single relation filtered on itself, which Prisma accepts (review of B7, 4)',
        code: 'export const r = (tx) => tx.slotHold.findMany({ include: { enrollment: { where: { deletedAt: null } } } });',
        filename: repository,
      },
      {
        name: 'a selection held in a variable on a model that reaches no soft-deletable row (review of B7, 1)',
        code: 'const storedKey = { id: true, status: true };\nexport const r = (tx) => tx.idempotencyKey.findUnique({ where: { id: "k" }, select: storedKey });',
        filename: repository,
      },
      {
        name: 'a delegate held in a variable, reading scalars',
        code: 'export const r = (admins) => admins.findMany({ select: { id: true } });',
        filename: repository,
      },
      {
        // `sessions` is Enrollment's soft-deletable Session list and also User's UserSession and
        // AdminUser's AdminSession lists: without the model the name decides nothing, and a filter
        // demanded of a table with no `deletedAt` would not compile. Review's, as the header says.
        name: 'a relation name several models use differently, through a delegate held in a variable',
        code: 'export const r = (delegate) => delegate.findMany({ include: { sessions: true } });',
        filename: repository,
      },
      {
        name: 'outside a repository file, where no query is written (R-API-2)',
        code: 'export const r = (tx) => tx.enrollment.findMany({ include: { sessions: true } });',
        filename: service,
      },
    ],
    invalid: [
      {
        name: 'a list relation included whole',
        code: 'export const r = (tx) => tx.enrollment.findMany({ include: { sessions: true } });',
        filename: repository,
        errors: [{ messageId: 'unfilteredList', data: { relation: 'sessions', model: 'Session' } }],
      },
      {
        name: 'a list relation selected whole',
        code: 'export const r = (tx) => tx.user.findUnique({ where: { id: "u" }, select: { enrollmentsAsStudent: true } });',
        filename: repository,
        errors: [
          {
            messageId: 'unfilteredList',
            data: { relation: 'enrollmentsAsStudent', model: 'Enrollment' },
          },
        ],
      },
      {
        name: 'a list relation filtered on something else',
        code: 'export const r = (tx) => tx.enrollment.findMany({ include: { ijazahs: { where: { revokedAt: null } } } });',
        filename: repository,
        errors: [{ messageId: 'unfilteredList', data: { relation: 'ijazahs', model: 'Ijazah' } }],
      },
      {
        name: 'a list relation asking for the deleted rows',
        code: 'export const r = (tx) => tx.enrollment.findMany({ include: { sessions: { where: { deletedAt: { not: null } } } } });',
        filename: repository,
        errors: [{ messageId: 'unfilteredList', data: { relation: 'sessions', model: 'Session' } }],
      },
      {
        name: 'a single relation with no filter on the query',
        code: 'export const r = (tx) => tx.teacherProfile.findMany({ include: { user: true } });',
        filename: repository,
        errors: [{ messageId: 'unfilteredSingle', data: { relation: 'user', model: 'User' } }],
      },
      {
        name: 'a single relation nested in a filtered list',
        code: 'export const r = (tx) => tx.enrollment.findMany({ include: { sessions: { where: { deletedAt: null }, include: { student: true } } } });',
        filename: repository,
        errors: [{ messageId: 'unfilteredSingle', data: { relation: 'student', model: 'User' } }],
      },
      {
        name: 'a relation reached through a delegate held in a variable, judged by its name',
        code: 'export const r = (users) => users.findMany({ include: { enrollmentsAsStudent: true } });',
        filename: repository,
        errors: [
          {
            messageId: 'unfilteredList',
            data: { relation: 'enrollmentsAsStudent', model: 'Enrollment' },
          },
        ],
      },
      {
        name: 'an unfiltered count of a list relation',
        code: 'export const r = (tx) => tx.enrollment.findMany({ select: { _count: { select: { sessions: true } } } });',
        filename: repository,
        errors: [{ messageId: 'unfilteredList', data: { relation: 'sessions', model: 'Session' } }],
      },
      {
        name: 'every count at once, which counts the deleted rows',
        code: 'export const r = (tx) => tx.enrollment.findMany({ include: { _count: true } });',
        filename: repository,
        errors: [{ messageId: 'unfilteredCount', data: { model: 'Enrollment' } }],
      },
      {
        name: 'an include held in a variable (review of B7, 1)',
        code: 'const include = { sessions: true };\nexport const r = (tx) => tx.enrollment.findMany({ include });',
        filename: repository,
        errors: [{ messageId: 'opaqueSelection', data: { key: 'include' } }],
      },
      {
        name: 'an include spread from elsewhere (review of B7, 1)',
        code: 'const base = { sessions: true };\nexport const r = (tx) => tx.enrollment.findMany({ include: { ...base } });',
        filename: repository,
        errors: [{ messageId: 'opaqueSelection', data: { key: 'include' } }],
      },
      {
        name: 'the whole argument held in a variable (review of B7, 1)',
        code: 'export const r = (tx, args) => tx.enrollment.findMany(args);',
        filename: repository,
        errors: [{ messageId: 'opaqueArguments' }],
      },
      {
        name: 'a nested relation selection held in a variable (review of B7, 1)',
        code: 'const select = { id: true };\nexport const r = (tx) => tx.enrollment.findMany({ include: { sessions: { where: { deletedAt: null }, select } } });',
        filename: repository,
        errors: [{ messageId: 'opaqueSelection', data: { key: 'select' } }],
      },
      {
        name: 'a nested single relation the query does not filter by (review of B7, 4)',
        code: 'export const r = (tx) => tx.session.findMany({ where: { enrollment: { deletedAt: null } }, include: { enrollment: { include: { student: true } } } });',
        filename: repository,
        errors: [{ messageId: 'unfilteredSingle', data: { relation: 'student', model: 'User' } }],
      },
      {
        name: 'an opaque include after an opaque query on a model of the same cycle (review of B7, round 2, 1)',
        code: 'export const a = (tx, args) => tx.adminUser.findUnique(args);\nexport const b = (tx, inc) => tx.adminSession.findUnique({ where: { id: "s" }, include: inc });',
        filename: repository,
        errors: [
          { messageId: 'opaqueArguments' },
          { messageId: 'opaqueSelection', data: { key: 'include' } },
        ],
      },
      {
        name: 'the rows a write returns',
        code: "export const r = (tx) => tx.enrollment.update({ where: { id: 'e' }, data: { status: 'active' }, include: { sessions: true } });",
        filename: repository,
        errors: [{ messageId: 'unfilteredList', data: { relation: 'sessions', model: 'Session' } }],
      },
    ],
  },
);
