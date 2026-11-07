// T008 of specs/004-sessions/tasks.md (research R-301, R-322, R-323 GAP-1; the third analysis, U3;
// data-model.md §3, "Enrollment, this phase's moves") — booking's `createEnrollmentSide()` over a
// recorded store: each function asks the store what the port's contract says, each move writes its
// `enrollment_events` row only when it moved, a move from any other state writes nothing and
// answers `false`, and the page reads `admin_list_page_size` and one row more than the page. The
// same over the real tables is `tests/db-integrity/enrollment-side.spec.ts`'s.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { EnrollmentPageItem, EnrollmentTerms } from '../sessions/index.js';
import type { EnrollmentOutcome } from './enrollment-events.repository.js';
import type { MoveSource, MoveTarget } from './enrollment-side.repository.js';
import { createEnrollmentSide, type EnrollmentSideStore } from './enrollment-side.service.js';

const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const AT = new Date('2026-11-08T09:00:00Z');
const tx = {} as Transaction;

interface Recorded {
  readonly locks: { table: string; ids: readonly string[] }[];
  readonly moves: { id: string; from: readonly MoveSource[]; target: MoveTarget }[];
  readonly events: EnrollmentOutcome[];
  readonly pages: { cursor: string | undefined; take: number }[];
  readonly settings: string[];
}

function world(options: { moves?: boolean; page?: EnrollmentPageItem[]; pageSize?: unknown }) {
  const recorded: Recorded = { locks: [], moves: [], events: [], pages: [], settings: [] };
  const terms: EnrollmentTerms = {
    id: id(1),
    status: 'confirmed',
    slotId: id(2),
    track: 'recitation',
    timezone: 'Africa/Cairo',
    durationMinutes: 60,
    sessionCount: 8,
  };
  const store: EnrollmentSideStore = {
    enrollmentTermsById: async (_tx, asked) => (asked === terms.id ? terms : null),
    lockRows: async (_tx, table, ids) => {
      recorded.locks.push({ table, ids });
    },
    moveEnrollment: async (_tx, moved, from, target) => {
      recorded.moves.push({ id: moved, from, target });
      return options.moves ?? true;
    },
    recordEnrollmentEvents: async (_tx, outcomes) => {
      recorded.events.push(...outcomes);
    },
    enrollmentEventsOf: async () => [
      { kind: 'confirmed', occurredAt: AT },
      { kind: 'cancelled', cancellationReason: 'admin', occurredAt: AT },
    ],
    enrollmentsPage: async (_tx, _filter, cursor, take) => {
      recorded.pages.push({ cursor, take });
      return (options.page ?? []).slice(0, take);
    },
  };
  const settings: SettingsReader = {
    read: async <T>(key: string, schema: z.ZodType<T>) => {
      recorded.settings.push(key);
      return schema.parse(options.pageSize ?? 2);
    },
  };
  const side = createEnrollmentSide({ settings, now: () => AT, store });
  return { side, recorded, terms };
}

function item(n: number): EnrollmentPageItem {
  return {
    enrollmentId: id(n),
    studentUserId: id(100 + n),
    teacherUserId: id(200 + n),
    status: 'confirmed',
    track: 'ijazah_track',
    sessionCount: 8,
  };
}

describe('EnrollmentSide.enrollmentFor and lockEnrollments (T008)', () => {
  it("answers the enrollment's snapshot, slot and status, and null for none", async () => {
    const { side, terms } = world({});
    expect(await side.enrollmentFor(tx, id(1))).toEqual(terms);
    expect(await side.enrollmentFor(tx, id(9))).toBeNull();
  });

  it("locks the enrollments' rows through the kernel's lock, and nothing else", async () => {
    const { side, recorded } = world({});
    await side.lockEnrollments(tx, [id(3), id(1)]);
    expect(recorded.locks).toEqual([{ table: 'enrollments', ids: [id(3), id(1)] }]);
    expect(recorded.moves).toEqual([]);
  });
});

describe("EnrollmentSide's moves, each with its row, only from its state (T008, data-model §3)", () => {
  const cases = [
    {
      name: 'terminateNoShow: confirmed → terminated_no_show (T060 (a), R-322)',
      call: (side: ReturnType<typeof world>['side']) => side.terminateNoShow(tx, id(1)),
      from: [{ status: 'confirmed' }],
      target: { status: 'terminated_no_show', cancellationReason: null },
      event: { kind: 'terminated_no_show', enrollmentId: id(1), occurredAt: AT },
    },
    {
      name: 'complete: confirmed → completed (T015, FR-449)',
      call: (side: ReturnType<typeof world>['side']) => side.complete(tx, id(1)),
      from: [{ status: 'confirmed' }],
      target: { status: 'completed', cancellationReason: null },
      event: { kind: 'completed', enrollmentId: id(1), occurredAt: AT },
    },
    {
      name: 'restore: terminated_no_show or cancelled admin → confirmed, the reason cleared (T061)',
      call: (side: ReturnType<typeof world>['side']) => side.restore(tx, id(1)),
      from: [{ status: 'terminated_no_show' }, { status: 'cancelled', cancellationReason: 'admin' }],
      target: { status: 'confirmed', cancellationReason: null },
      event: { kind: 'restored', enrollmentId: id(1), occurredAt: AT },
    },
    {
      name: "cancel 'admin': confirmed → cancelled admin (T036, R-313)",
      call: (side: ReturnType<typeof world>['side']) => side.cancel(tx, id(1), 'admin'),
      from: [{ status: 'confirmed' }],
      target: { status: 'cancelled', cancellationReason: 'admin' },
      event: {
        kind: 'cancelled',
        enrollmentId: id(1),
        cancellationReason: 'admin',
        occurredAt: AT,
      },
    },
  ] as const;

  for (const { name, call, from, target, event } of cases) {
    it(`${name}: moved, one row, true`, async () => {
      const { side, recorded } = world({ moves: true });
      expect(await call(side)).toBe(true);
      expect(recorded.moves).toEqual([{ id: id(1), from, target }]);
      expect(recorded.events).toStrictEqual([event]);
      expect(recorded.locks).toEqual([]);
    });

    it(`${name}: from another state, nothing written, false`, async () => {
      const { side, recorded } = world({ moves: false });
      expect(await call(side)).toBe(false);
      expect(recorded.moves).toHaveLength(1);
      expect(recorded.events).toEqual([]);
    });
  }
});

describe('EnrollmentSide.eventsOf (T008, R-323 GAP-1)', () => {
  it("answers the store's rows as they are, with no payment", async () => {
    const { side } = world({});
    expect(await side.eventsOf(tx, id(1))).toEqual([
      { kind: 'confirmed', occurredAt: AT },
      { kind: 'cancelled', cancellationReason: 'admin', occurredAt: AT },
    ]);
  });
});

describe('EnrollmentSide.enrollmentPage (T008, U3)', () => {
  it('reads admin_list_page_size and one row more, and gives the last id as the cursor while more follow', async () => {
    const { side, recorded } = world({ page: [item(5), item(4), item(3)], pageSize: 2 });
    const page = await side.enrollmentPage(tx, { status: 'confirmed' });
    expect(recorded.settings).toEqual(['admin_list_page_size']);
    expect(recorded.pages).toEqual([{ cursor: undefined, take: 3 }]);
    expect(page).toEqual({ items: [item(5), item(4)], nextCursor: id(4) });
  });

  it('passes the cursor on, and gives none on the last page', async () => {
    const { side, recorded } = world({ page: [item(3)], pageSize: 2 });
    const page = await side.enrollmentPage(tx, {}, id(4));
    expect(recorded.pages).toEqual([{ cursor: id(4), take: 3 }]);
    expect(page).toEqual({ items: [item(3)] });
  });

  it('refuses a page size that is not a positive whole number, reading nothing', async () => {
    const { side, recorded } = world({ pageSize: 0 });
    await expect(side.enrollmentPage(tx, {})).rejects.toThrow();
    expect(recorded.pages).toEqual([]);
  });
});
