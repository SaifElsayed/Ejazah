// T008 of specs/004-sessions/tasks.md (research R-301, R-322, R-323 GAP-1; the third analysis, U3;
// data-model.md §3, "Enrollment, this phase's moves") — booking's `createEnrollmentSide()` over a
// recorded store: each function asks the store what the port's contract says, each move writes its
// `enrollment_events` row only when it moved, a move from any other state writes nothing and
// answers `false`, and the page reads `admin_list_page_size` and one row more than the page. The
// same over the real tables is `tests/db-integrity/enrollment-side.spec.ts`'s.
import { addMinutes } from '@ijazah/time';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { SlotRow } from '../catalog/index.js';
import type { EnrollmentPageItem, EnrollmentTerms } from '../sessions/index.js';
import type { EnrollmentOutcome } from './enrollment-events.repository.js';
import type { ActiveHold, MoveTarget } from './enrollment-side.repository.js';
import { createEnrollmentSide, type EnrollmentSideStore } from './enrollment-side.service.js';
import type { SlotOccupancy } from './slot-occupancy.service.js';

const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const AT = new Date('2026-11-08T09:00:00Z');
const tx = {} as Transaction;

interface Recorded {
  readonly locks: { table: string; ids: readonly string[] }[];
  readonly moves: { id: string; target: MoveTarget }[];
  readonly events: EnrollmentOutcome[];
  readonly pages: { cursor: string | undefined; take: number }[];
  readonly settings: string[];
  readonly occupancy: { slotIds: readonly string[]; except: string; bufferWeeks: number }[];
  readonly holds: { studentUserIds: readonly string[]; slotIds: readonly string[] }[];
  readonly slotReads: string[];
}

interface WorldOptions {
  readonly moves?: boolean;
  readonly page?: EnrollmentPageItem[];
  readonly pageSize?: unknown;
  readonly occupancy?: SlotOccupancy;
  readonly holds?: readonly ActiveHold[];
  readonly teacherSlots?: Readonly<Record<string, readonly SlotRow[]>>;
  readonly slots?: Readonly<Record<string, SlotRow>>;
}

function world(options: WorldOptions) {
  const recorded: Recorded = {
    locks: [],
    moves: [],
    events: [],
    pages: [],
    settings: [],
    occupancy: [],
    holds: [],
    slotReads: [],
  };
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
    moveEnrollment: async (_tx, moved, target) => {
      recorded.moves.push({ id: moved, target });
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
    occupancyOf: async (_tx, slotIds, bufferWeeks, except) => {
      recorded.occupancy.push({ slotIds, except, bufferWeeks: await bufferWeeks() });
      const occupancy = new Map<string, SlotOccupancy>();
      for (const slotId of slotIds) {
        if (options.occupancy !== undefined) occupancy.set(slotId, options.occupancy);
      }
      return occupancy;
    },
    activeHoldsAmong: async (_tx, scope) => {
      recorded.holds.push(scope);
      return [...(options.holds ?? [])];
    },
    teacherSlotsOf: async (_tx, teacherUserId) => [
      ...(options.teacherSlots?.[teacherUserId] ?? []),
    ],
    readSlot: async (_tx, slotId) => {
      recorded.slotReads.push(slotId);
      return options.slots?.[slotId] ?? null;
    },
  };
  const values: Record<string, unknown> = {
    admin_list_page_size: options.pageSize ?? 2,
    slot_release_buffer_weeks: 1,
    first_session_lead_hours: 24,
  };
  const settings: SettingsReader = {
    read: async <T>(key: string, schema: z.ZodType<T>) => {
      recorded.settings.push(key);
      return schema.parse(values[key]);
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
      target: { status: 'terminated_no_show', cancellationReason: null },
      event: { kind: 'terminated_no_show', enrollmentId: id(1), occurredAt: AT },
    },
    {
      name: 'complete: confirmed → completed (T015, FR-449)',
      call: (side: ReturnType<typeof world>['side']) => side.complete(tx, id(1)),
      target: { status: 'completed', cancellationReason: null },
      event: { kind: 'completed', enrollmentId: id(1), occurredAt: AT },
    },
    {
      name: "cancel 'admin': confirmed → cancelled admin (T036, R-313)",
      call: (side: ReturnType<typeof world>['side']) => side.cancel(tx, id(1), 'admin'),
      target: { status: 'cancelled', cancellationReason: 'admin' },
      event: {
        kind: 'cancelled',
        enrollmentId: id(1),
        cancellationReason: 'admin',
        occurredAt: AT,
      },
    },
  ] as const;

  for (const { name, call, target, event } of cases) {
    it(`${name}: moved, one row, true`, async () => {
      const { side, recorded } = world({ moves: true });
      expect(await call(side)).toBe(true);
      expect(recorded.moves).toEqual([{ id: id(1), target }]);
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

describe('EnrollmentSide.restore, through restoreEnrollment alone (T008, T061, FR-455, R-322)', () => {
  /** A transaction whose one update answers `count`, recording what it was asked. */
  function updating(count: number) {
    const updates: unknown[] = [];
    const client = {
      enrollment: {
        updateMany: async (args: unknown) => {
          updates.push(args);
          return { count };
        },
      },
    } as unknown as Transaction;
    return { client, updates };
  }

  it('terminated_no_show or cancelled admin, once confirmed → confirmed, the reason cleared: one row, true', async () => {
    const { side, recorded } = world({});
    const { client, updates } = updating(1);
    expect(await side.restore(client, id(1))).toBe(true);
    expect(updates).toHaveLength(1);
    expect(recorded.moves).toEqual([]);
    expect(recorded.events).toStrictEqual([
      { kind: 'restored', enrollmentId: id(1), occurredAt: AT },
    ]);
  });

  it('from another state, or never confirmed: nothing written, false', async () => {
    const { side, recorded } = world({});
    const { client, updates } = updating(0);
    expect(await side.restore(client, id(1))).toBe(false);
    expect(updates).toHaveLength(1);
    expect(recorded.events).toEqual([]);
  });
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

  // T024 (the owner's decision of 2026-11-10 on B37 lane B's Q3): the monitor's name search reads
  // in batches, each twice the one before, as the payments monitor does.
  it('reads a batch of the size asked, and one row more, reading no setting', async () => {
    const { side, recorded } = world({ page: [item(5), item(4), item(3), item(2)], pageSize: 2 });
    const page = await side.enrollmentPage(tx, {}, undefined, 3);
    expect(recorded.settings).toEqual([]);
    expect(recorded.pages).toEqual([{ cursor: undefined, take: 4 }]);
    expect(page).toEqual({ items: [item(5), item(4), item(3)], nextCursor: id(3) });
  });

  it('refuses a batch size that is not a positive whole number, reading nothing', async () => {
    const { side, recorded } = world({ pageSize: 2 });
    await expect(side.enrollmentPage(tx, {}, undefined, 0)).rejects.toThrow();
    expect(recorded.pages).toEqual([]);
  });
});

describe("EnrollmentSide.slotWeekTaken (T008, R-205; the owner's decision of 2026-11-07)", () => {
  it("asks the slot's occupancy without the asking enrollment's own, the buffer read", async () => {
    const { side, recorded } = world({});
    expect(await side.slotWeekTaken(tx, id(2), '2026-11-29', id(1))).toBe(false);
    expect(recorded.occupancy).toEqual([{ slotIds: [id(2)], except: id(1), bufferWeeks: 1 }]);
    expect(recorded.settings).toEqual(['slot_release_buffer_weeks']);
  });

  it('a held or pending slot is taken on every date', async () => {
    const { side } = world({ occupancy: { kind: 'taken' } });
    expect(await side.slotWeekTaken(tx, id(2), '2027-06-06', id(1))).toBe(true);
  });

  it("a completed enrollment's slot is taken before its release date and free from it", async () => {
    const { side } = world({
      occupancy: { kind: 'until', releasedOn: '2026-12-06', timezone: 'Africa/Cairo' },
    });
    expect(await side.slotWeekTaken(tx, id(2), '2026-11-29', id(1))).toBe(true);
    expect(await side.slotWeekTaken(tx, id(2), '2026-12-06', id(1))).toBe(false);
  });
});

describe("EnrollmentSide.slotsFreeFrom (T031's counter options; the owner's rule of 2026-11-10)", () => {
  it('reads every slot in one occupancy read, the asking enrollment left out; a free slot absent', async () => {
    const { side, recorded } = world({});
    expect(await side.slotsFreeFrom(tx, [id(2), id(3)], id(1))).toEqual(new Map());
    expect(recorded.occupancy).toEqual([
      { slotIds: [id(2), id(3)], except: id(1), bufferWeeks: 1 },
    ]);
  });

  it('a slot taken on every date answers null', async () => {
    const { side } = world({ occupancy: { kind: 'taken' } });
    expect(await side.slotsFreeFrom(tx, [id(2)], id(1))).toEqual(new Map([[id(2), null]]));
  });

  it('a slot a completed enrollment holds answers its release date', async () => {
    const { side } = world({
      occupancy: { kind: 'until', releasedOn: '2026-12-06', timezone: 'Africa/Cairo' },
    });
    expect(await side.slotsFreeFrom(tx, [id(2)], id(1))).toEqual(new Map([[id(2), '2026-12-06']]));
  });
});

/** A slot as catalog's entry answers it: Monday 11:10 in Cairo (09:10 UTC in November), 60 min. */
function slot(n: number): SlotRow {
  return {
    id: id(n),
    dayOfWeek: 1,
    startTimeLocal: '11:10:00',
    durationMinutes: 60,
    timezone: 'Africa/Cairo',
    isActive: true,
    createdAt: AT,
  };
}

const at = (instant: string) => new Date(instant);
const span = (start: string) => ({
  startsAt: at(start),
  endsAt: new Date(addMinutes(at(start), 60)),
});
const WIDE = { from: at('2026-11-01T00:00:00Z'), to: at('2027-01-01T00:00:00Z') };

describe("EnrollmentSide.heldTimesOf (T008, F5; the owner's decision of 2026-11-07)", () => {
  it('reads no setting and answers nothing when no active hold is theirs', async () => {
    const { side, recorded } = world({});
    expect(await side.heldTimesOf(tx, [id(101), id(201)], WIDE)).toEqual([]);
    expect(recorded.settings).toEqual([]);
  });

  it('asks nothing for no user', async () => {
    const { side, recorded } = world({});
    expect(await side.heldTimesOf(tx, [], WIDE)).toEqual([]);
    expect(recorded.holds).toEqual([]);
  });

  it("a student's own holds and the holds on a teacher's slots, each slot read once", async () => {
    const { side, recorded } = world({
      teacherSlots: { [id(201)]: [slot(21)] },
      slots: { [id(11)]: slot(11) },
      holds: [
        { slotId: id(11), sessionCount: 1, expiresAt: at('2026-11-08T09:05:00Z') },
        { slotId: id(21), sessionCount: 1, expiresAt: at('2026-11-08T09:05:00Z') },
      ],
    });
    const times = await side.heldTimesOf(tx, [id(201), id(101), id(201)], WIDE);
    expect(recorded.holds).toEqual([{ studentUserIds: [id(101), id(201)], slotIds: [id(21)] }]);
    expect(recorded.slotReads).toEqual([id(11)]);
    expect(recorded.settings).toEqual(['first_session_lead_hours']);
    // Both holds' one session falls on the same Monday: the occurrence is answered once.
    expect(times).toEqual([span('2026-11-09T09:10:00Z')]);
  });

  it('the union from the read and from expires_at, when the lead after the expiry passes the slot', async () => {
    const { side } = world({
      slots: { [id(11)]: slot(11) },
      // Read at 09:00 Sunday: 24 h later is before Monday's 09:10, so the first is Nov 9; from the
      // expiry at 09:15, 24 h later is past it, so the first is Nov 16.
      holds: [{ slotId: id(11), sessionCount: 2, expiresAt: at('2026-11-08T09:15:00Z') }],
    });
    expect(await side.heldTimesOf(tx, [id(101)], WIDE)).toEqual([
      span('2026-11-09T09:10:00Z'),
      span('2026-11-16T09:10:00Z'),
      span('2026-11-23T09:10:00Z'),
    ]);
  });

  it('only the occurrences overlapping the window, a touching one left out', async () => {
    const { side } = world({
      slots: { [id(11)]: slot(11) },
      holds: [{ slotId: id(11), sessionCount: 2, expiresAt: at('2026-11-08T09:15:00Z') }],
    });
    expect(
      await side.heldTimesOf(tx, [id(101)], {
        from: at('2026-11-09T10:10:00Z'),
        to: at('2026-11-23T09:10:00Z'),
      }),
    ).toEqual([span('2026-11-16T09:10:00Z')]);
  });

  it('refuses a hold whose slot cannot be read', async () => {
    const { side } = world({
      holds: [{ slotId: id(11), sessionCount: 1, expiresAt: at('2026-11-08T09:15:00Z') }],
    });
    await expect(side.heldTimesOf(tx, [id(101)], WIDE)).rejects.toThrow(/slot/);
  });
});
