// T006 — naming the database's refusal without a database: the shapes Prisma 7 and
// `@prisma/adapter-pg` hand a caller, as `tests/db-integrity/db-errors.spec.ts` recorded them
// against Postgres (B24's run 03): a model write's `PrismaClientKnownRequestError` (P2002 for a
// unique violation, P2039 for an exclusion violation), a raw write's P2010, and the bare
// `DriverAdapterError` a deferred exclusion constraint throws at commit. Each is matched by its
// SQLSTATE and the constraint it names; anything else answers false, so the caller rethrows it.
import { describe, expect, it } from 'vitest';

import {
  type ExclusionConstraint,
  isExclusionViolation,
  isUniqueViolation,
  type UniqueConstraint,
} from './db-errors.js';

const UNIQUE: readonly UniqueConstraint[] = [
  'slot_holds_slot_id_active_key',
  'slot_holds_student_user_id_active_key',
];
const EXCLUSION: readonly ExclusionConstraint[] = [
  'sessions_teacher_no_overlap',
  'sessions_student_no_overlap',
];

/** The adapter's error for a unique violation on `index`. */
function uniqueCause(index: string) {
  return {
    name: 'DriverAdapterError',
    message: 'UniqueConstraintViolation',
    cause: {
      originalCode: '23505',
      originalMessage: `duplicate key value violates unique constraint "${index}"`,
      kind: 'UniqueConstraintViolation',
      constraint: { index },
      table: 'slot_holds',
    },
  };
}

/** The adapter's error for an exclusion violation, the server's message as given. */
function exclusionCause(message: string) {
  return Object.assign(new Error(message), {
    name: 'DriverAdapterError',
    cause: {
      originalCode: '23P01',
      originalMessage: message,
      kind: 'postgres',
      code: '23P01',
      severity: 'ERROR',
      message,
      detail: 'Key (teacher_user_id, tstzrange(scheduled_start_at, scheduled_end_at)) conflicts',
    },
  });
}

/** A Prisma client error over the adapter's error, as a model or a raw write throws it. */
function known(code: string, driverAdapterError: unknown) {
  return Object.assign(new Error('Invalid invocation'), {
    name: 'PrismaClientKnownRequestError',
    code,
    meta: { modelName: 'SlotHold', driverAdapterError },
  });
}

const excluded = (name: string) => `conflicting key value violates exclusion constraint "${name}"`;

describe('isUniqueViolation (T006, R-215)', () => {
  it.each(UNIQUE)('names %s from a model write (P2002) and from a raw write (P2010)', (name) => {
    expect(isUniqueViolation(known('P2002', uniqueCause(name)), name)).toBe(true);
    expect(isUniqueViolation(known('P2010', uniqueCause(name)), name)).toBe(true);
  });

  it.each(UNIQUE)('does not take %s for the other active-hold key', (name) => {
    const other = UNIQUE.find((candidate) => candidate !== name) ?? name;
    expect(isUniqueViolation(known('P2002', uniqueCause(name)), other)).toBe(false);
  });

  it('answers false for a unique violation on any other constraint, so the caller rethrows it', () => {
    const error = known('P2002', uniqueCause('sessions_enrollment_id_sequence_number_key'));
    for (const name of UNIQUE) expect(isUniqueViolation(error, name)).toBe(false);
  });

  it('answers false for an exclusion violation', () => {
    const error = known('P2039', exclusionCause(excluded('slot_holds_slot_id_active_key')));
    for (const name of UNIQUE) expect(isUniqueViolation(error, name)).toBe(false);
  });
});

describe('isExclusionViolation (T006, R-210, R-215)', () => {
  it.each(EXCLUSION)('names %s from a write (P2039) and from the commit', (name) => {
    expect(isExclusionViolation(known('P2039', exclusionCause(excluded(name))), name)).toBe(true);
    expect(isExclusionViolation(exclusionCause(excluded(name)), name)).toBe(true);
  });

  it.each(EXCLUSION)('does not take %s for the other session exclusion', (name) => {
    const other = EXCLUSION.find((candidate) => candidate !== name) ?? name;
    expect(isExclusionViolation(exclusionCause(excluded(name)), other)).toBe(false);
  });

  it('names the constraint in a server message translated with other quotes', () => {
    const message =
      'kollidierender Schlüsselwert verletzt Exclusion-Constraint »sessions_student_no_overlap«';
    expect(isExclusionViolation(exclusionCause(message), 'sessions_student_no_overlap')).toBe(true);
    expect(isExclusionViolation(exclusionCause(message), 'sessions_teacher_no_overlap')).toBe(
      false,
    );
  });

  it('does not take a longer constraint name that contains the one asked for', () => {
    const error = exclusionCause(excluded('sessions_teacher_no_overlap_v2'));
    expect(isExclusionViolation(error, 'sessions_teacher_no_overlap')).toBe(false);
  });

  it('answers false for an exclusion violation on any other constraint, so the caller rethrows it', () => {
    const error = exclusionCause(excluded('slots_no_overlap'));
    for (const name of EXCLUSION) expect(isExclusionViolation(error, name)).toBe(false);
  });

  it('answers false for a unique violation whose message names a session exclusion', () => {
    const error = known('P2002', {
      ...uniqueCause('x'),
      cause: {
        ...uniqueCause('x').cause,
        originalMessage: excluded('sessions_teacher_no_overlap'),
      },
    });
    expect(isExclusionViolation(error, 'sessions_teacher_no_overlap')).toBe(false);
  });
});

describe('anything that is not one of the four refusals (T006)', () => {
  const others: readonly [string, unknown][] = [
    [
      'a foreign key refusal',
      known('P2003', {
        name: 'DriverAdapterError',
        cause: {
          originalCode: '23503',
          kind: 'ForeignKeyConstraintViolation',
          constraint: { index: 'slot_holds_slot_id_active_key' },
        },
      }),
    ],
    ['a Prisma error with no adapter error', known('P2025', undefined)],
    ['a plain error', new Error('sessions_teacher_no_overlap slot_holds_slot_id_active_key')],
    ['an adapter error with no cause', { name: 'DriverAdapterError' }],
    ['a string', 'slot_holds_slot_id_active_key'],
    ['null', null],
    ['undefined', undefined],
  ];

  it.each(others)('answers false for %s, so the caller rethrows it', (_label, error) => {
    for (const name of UNIQUE) expect(isUniqueViolation(error, name)).toBe(false);
    for (const name of EXCLUSION) expect(isExclusionViolation(error, name)).toBe(false);
  });
});
