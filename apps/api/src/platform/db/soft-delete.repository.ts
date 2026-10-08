// T148: soft-deleted rows are excluded from ordinary reads (FR-026, SC-004, ERD §0 and §15.10,
// data-model.md §4, R-DB-3). The one client of prisma.repository.ts (T102) is built with this
// extension; its test is T053 (`tests/db-integrity/soft-delete.spec.ts`).
//
// WHAT IT DOES. On `users`, `sessions`, `enrollments` and `ijazahs` it adds `deleted_at IS NULL` to
// every read — `findMany`, `findFirst`, `findUnique`, their `OrThrow` forms, `count`, `aggregate`,
// `groupBy` — and to `update`, `updateMany`, `updateManyAndReturn` and `upsert`, so a write
// matches no soft-deleted row: an upsert over one takes its `create` branch and leaves it as it
// was. The condition joins the caller's own through `AND`, so a caller's `deletedAt` condition is
// never overwritten, and a `findUnique` keeps its operation: since Prisma 5 a unique `where` may
// carry other conditions beside the unique field. T148's text says "rewritten as `findFirst`",
// which a query extension can only do by calling another client, outside the caller's
// transaction; the filtered unique read gives the same answer inside it (owner-accepted,
// 2026-10-08).
//
// HARD DELETION IS REFUSED, not rewritten (PR #41 review n1, owner-approved 2026-10-07). `delete`
// and `deleteMany` on the four tables throw before any SQL is sent, naming soft deletion: removal
// is an explicit `update` that sets `deletedAt`. The database refuses DELETE to the application
// role anyway (T065); this refusal says why, where the code is written. `includeDeleted` is the
// raw client, so this refusal does not apply to it; the guard there is the revoked DELETE (T065).
//
// THE OPT-IN. A read that wants deleted rows says so through `includeDeleted`, a second named
// client: `database.includeDeleted.user.findMany(...)` (data-model.md §4; PR #41 review n3, since
// a typed Prisma argument takes no extra field). It is the unextended client the extended one was
// built from, so both share one connection pool. It is not the caller's transaction: inside
// `database.$transaction(tx => …)`, `tx.includeDeleted` still reads outside it, so a transaction
// that must see deleted rows is opened on `database.includeDeleted` itself.
//
// THE KNOWN GAP. Relations read through `include` or `select` are not filtered by this extension:
// Prisma runs it once per top-level operation, never per nested relation. A repository that reads
// a soft-deletable relation that way filters it explicitly (`where: { deletedAt: null }` on the
// relation). `create` and `createMany` match no row and are left as Prisma has them.
//
// The file is a `*.repository.ts` because only such a file may name the database client (R-API-2,
// `api/no-orm-outside-repository`).
import { Prisma, type PrismaClient } from '@prisma/client';

/** The models whose rows are removed by soft deletion (ERD §15.10). */
const SOFT_DELETED: ReadonlySet<string> = new Set(['User', 'Session', 'Enrollment', 'Ijazah']);

/** Every operation that reads rows, or writes rows it first matches by `where`. */
const FILTERED: ReadonlySet<string> = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
]);

const HARD_DELETES: ReadonlySet<string> = new Set(['delete', 'deleteMany']);

export class HardDeleteRefusedError extends Error {
  constructor(model: string, operation: string) {
    super(
      `Hard delete refused on ${model} (${operation}): users, sessions, enrollments and ijazahs ` +
        'are removed by soft deletion, an update that sets deletedAt (R-DB-3, ERD §15.10).',
    );
    this.name = 'HardDeleteRefusedError';
  }
}

type Where = Readonly<Record<string, unknown>>;

/** The caller's `where` with `deletedAt: null` joined to it through `AND`. */
export function liveRowsOnly(where: Where | undefined): Where {
  const own = where ?? {};
  const conditions = own['AND'];
  const and = conditions === undefined ? [] : Array.isArray(conditions) ? conditions : [conditions];
  return { ...own, AND: [...and, { deletedAt: null }] };
}

/** The extension the one client is built with; `includeDeleted` is the client it extends. */
export function softDeletion(includeDeleted: PrismaClient) {
  return Prisma.defineExtension({
    name: 'soft-deletion',
    client: { includeDeleted },
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!SOFT_DELETED.has(model)) return query(args);
          if (HARD_DELETES.has(operation)) throw new HardDeleteRefusedError(model, operation);
          if (!FILTERED.has(operation)) return query(args);
          // Every operation in FILTERED takes an optional `where`; the union of all models'
          // arguments does not say so, so it is read through that shape.
          const { where } = args as { readonly where?: Where };
          const filtered: unknown = { ...args, where: liveRowsOnly(where) };
          return query(filtered as typeof args);
        },
      },
    },
  });
}
