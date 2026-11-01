// T006: the database's refusals a caller acts on, named (specs/003-booking/contracts/kernel.md,
// research R-215). The confirm job (T039) takes its refusal branch on exactly four of them, a second
// active hold (ERD §15 rule 17's two partial unique indexes, migration
// `20261007000200_partial_unique_indexes`) and an overlapping session (rule 19's two exclusion
// constraints, `20261007000400_booking_overlap`), and rethrows anything else. Each predicate takes
// one name from a closed union, so no caller asks about a constraint nobody built.
//
// WHERE THE REFUSAL IS. Prisma 7 reaches Postgres through `@prisma/adapter-pg`, which turns the
// server's error into a `DriverAdapterError` whose `cause` keeps the SQLSTATE as `originalCode`. A
// model or raw write throws Prisma's error with that error under `meta.driverAdapterError`; a
// deferred constraint is checked at COMMIT, where the adapter's error is thrown as it is (both
// recorded against Postgres by `tests/db-integrity/db-errors.spec.ts`). They are read by their
// shape, since only a repository may import the client's package (R-API-2), and identified by the
// SQLSTATE first, as the integrity harness identifies a refusal.
//
// THE CONSTRAINT'S NAME. A unique violation carries it as `constraint.index`. An exclusion violation
// does not: adapter-pg 7.10.0 maps a SQLSTATE it has no kind for to `kind: 'postgres'` and drops
// pg's `constraint` field, so the name is read from the server's message, as a whole identifier,
// never as a quoted one, since a translated message (`lc_messages`) may quote it otherwise.

/** The partial unique indexes a caller may name (ERD §15 rule 17). */
export type UniqueConstraint =
  'slot_holds_slot_id_active_key' | 'slot_holds_student_user_id_active_key';

/** The exclusion constraints a caller may name (ERD §15 rule 19). */
export type ExclusionConstraint = 'sessions_teacher_no_overlap' | 'sessions_student_no_overlap';

const UNIQUE_VIOLATION = '23505';
const EXCLUSION_VIOLATION = '23P01';

/** What the adapter kept of the server's error: its SQLSTATE, message and named index. */
interface Refusal {
  readonly code: string;
  readonly message: string;
  readonly index: string | undefined;
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** The adapter's error: under Prisma's `meta` for a write, or the error itself at commit. */
function adapterErrorOf(error: unknown): unknown {
  return field(error, 'name') === 'DriverAdapterError'
    ? error
    : field(field(error, 'meta'), 'driverAdapterError');
}

function refusalOf(error: unknown): Refusal | undefined {
  const adapterError = adapterErrorOf(error);
  if (field(adapterError, 'name') !== 'DriverAdapterError') return undefined;
  const cause = field(adapterError, 'cause');
  const code = field(cause, 'originalCode');
  if (typeof code !== 'string') return undefined;
  const message = field(cause, 'originalMessage');
  const index = field(field(cause, 'constraint'), 'index');
  return {
    code,
    message: typeof message === 'string' ? message : '',
    index: typeof index === 'string' ? index : undefined,
  };
}

/** Whether `name` stands in `message` as a whole identifier, not inside a longer one. */
function namesIdentifier(message: string, name: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_$])${name}($|[^A-Za-z0-9_$])`).test(message);
}

/** Whether `error` is the database refusing a write by the unique index `constraint`. */
export function isUniqueViolation(error: unknown, constraint: UniqueConstraint): boolean {
  const refusal = refusalOf(error);
  return refusal?.code === UNIQUE_VIOLATION && refusal.index === constraint;
}

/** Whether `error` is the database refusing a write, or a commit, by the exclusion `constraint`. */
export function isExclusionViolation(error: unknown, constraint: ExclusionConstraint): boolean {
  const refusal = refusalOf(error);
  return refusal?.code === EXCLUSION_VIOLATION && namesIdentifier(refusal.message, constraint);
}
