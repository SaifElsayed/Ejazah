// T019 — a teacher's weekly slots (app-surface.md "`teacher.slots` — catalog"; R-206, R-207,
// FR-313, FR-317, FR-318, M3). Over a store in memory that records every lock and read in the order
// the service takes them, so the lock order of T005 and the note under T019 is asserted here: create
// locks the account, then `lockKey('teacher-slots', teacherId)`, then reads; update locks the
// account, then the key, then the slot's row, then asks whether the slot is in use and reads the
// others. What the locks do on Postgres is `tests/db-integrity/teacher-slots.spec.ts`'s. The list
// carries `published` as the visibility predicate answers it through identity's entry, asked with
// the session's gender, as `teacher.packages.list` does (T069, FR-315).
import type { SlotsUpdateInput } from '@ijazah/contracts';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { CatalogUse } from './catalog-use.port.js';
import { type NewSlot, type SlotRow, SlotsService, type SlotsStore } from './slots.service.js';

const TEACHER = '0199d0a0-0000-7000-8000-0000000000a1';
const OTHER_TEACHER = '0199d0a0-0000-7000-8000-0000000000a2';
const KEY = 'spec-slot-key-00000001';
const TX = {} as Transaction;
// The session's gender, the teacher's own.
const REQUESTER = 'female' as RequesterGender;

/** A Saturday in Cairo's winter, and a Tuesday in its summer (weekly-zone.spec.ts in packages/time). */
const WINTER = new Date('2026-11-07T10:00:00Z');
const SUMMER = new Date('2026-07-07T10:00:00Z');

interface Stored extends SlotRow {
  readonly teacherUserId: string;
}

let sequence = 0;
function stored(values: Partial<Stored> & Pick<Stored, 'dayOfWeek' | 'startTimeLocal'>): Stored {
  sequence += 1;
  return {
    id: `0199d0a0-0000-7000-8000-${String(sequence).padStart(12, '0')}`,
    teacherUserId: TEACHER,
    durationMinutes: 60,
    timezone: 'Africa/Cairo',
    isActive: true,
    createdAt: new Date('2026-10-01T09:00:00Z'),
    ...values,
  };
}

function world(
  options: {
    readonly slots?: readonly Stored[];
    readonly zones?: Readonly<Record<string, string>>;
    readonly inUse?: readonly string[];
    readonly now?: Date;
    /** `teacherId:gender` of each teacher the predicate shows to a student of that gender. */
    readonly published?: readonly string[];
  } = {},
) {
  const events: string[] = [];
  const slots = new Map((options.slots ?? []).map((slot) => [slot.id, { ...slot }]));
  const zones = options.zones ?? { [TEACHER]: 'Africa/Cairo', [OTHER_TEACHER]: 'Africa/Cairo' };
  const inUse = new Set(options.inUse ?? []);
  const published = new Set(options.published ?? []);
  const keyed: unknown[] = [];
  const rowOf = ({ teacherUserId: _owner, ...row }: Stored): SlotRow => row;

  const store: SlotsStore = {
    run: (work) => work(TX),
    lockAccount: async (_tx, userId) => {
      events.push(`lock account ${userId}`);
    },
    lockTeacherSlots: async (_tx, teacherUserId) => {
      events.push(`lock key teacher-slots ${teacherUserId}`);
    },
    lockSlot: async (_tx, slotId) => {
      events.push(`lock slot ${slotId}`);
    },
    isPublished: async (_tx, requester, teacherUserId) => {
      events.push(`is published? ${requester}`);
      return published.has(`${teacherUserId}:${requester}`);
    },
    accountTimezone: async (_tx, userId) => {
      events.push('read zone');
      return zones[userId] ?? null;
    },
    ownsSlot: async (_tx, slotId, teacherUserId) => {
      events.push(`read owner ${slotId}`);
      return slots.get(slotId)?.teacherUserId === teacherUserId;
    },
    readSlot: async (_tx, slotId) => {
      events.push(`read slot ${slotId}`);
      const slot = slots.get(slotId);
      return slot === undefined ? null : rowOf(slot);
    },
    slotsOf: async (_tx, teacherUserId) => {
      events.push('read slots');
      return [...slots.values()].filter((slot) => slot.teacherUserId === teacherUserId).map(rowOf);
    },
    activeSlotsOf: async (_tx, teacherUserId) => {
      events.push('read active slots');
      return [...slots.values()]
        .filter((slot) => slot.teacherUserId === teacherUserId && slot.isActive)
        .map(rowOf);
    },
    insertSlot: async (_tx, row: NewSlot) => {
      events.push('insert');
      const slot = stored({ ...row, createdAt: options.now ?? WINTER });
      slots.set(slot.id, slot);
      return rowOf(slot);
    },
    updateSlot: async (_tx, slotId, change) => {
      events.push(`update ${slotId}`);
      const slot = slots.get(slotId);
      if (slot === undefined) throw new Error('no such slot');
      const next = { ...slot, ...change };
      slots.set(slotId, next);
      return rowOf(next);
    },
  };
  const use: CatalogUse = {
    slotInUse: async (_tx, slotId) => {
      events.push(`in use? ${slotId}`);
      return inUse.has(slotId);
    },
    packageHasEnrollment: async () => {
      throw new Error('not asked by slots');
    },
    packageEnrollmentCounts: async () => {
      throw new Error('not asked by slots');
    },
  };
  const service = new SlotsService({
    store,
    use,
    idempotency: {
      run: async (request, effect) => {
        keyed.push(request);
        return effect(TX);
      },
    },
    now: () => options.now ?? WINTER,
  });
  return { service, events, slots, keyed };
}

const refusal = (code: string) => expect.objectContaining({ code });

describe('teacher.slots.create (FR-313, FR-317, R-206)', () => {
  it("stores the teacher's zone at creation and the local start, and answers the slot free", async () => {
    const { service, slots, keyed } = world({ zones: { [TEACHER]: 'Asia/Riyadh' } });
    const slot = await service.create(TEACHER, {
      dayOfWeek: 0,
      startTimeLocal: '23:30',
      durationMinutes: 60,
      idempotencyKey: KEY,
    });
    expect(slot).toEqual({
      id: expect.any(String),
      dayOfWeek: 0,
      startTimeLocal: '23:30',
      durationMinutes: 60,
      timezone: 'Asia/Riyadh',
      isActive: true,
      state: 'free',
    });
    expect([...slots.values()]).toEqual([
      expect.objectContaining({
        teacherUserId: TEACHER,
        dayOfWeek: 0,
        startTimeLocal: '23:30:00',
        timezone: 'Asia/Riyadh',
        isActive: true,
      }),
    ]);
    expect(keyed).toEqual([
      {
        scope: 'teacher.slots.create',
        key: KEY,
        actorId: TEACHER,
        input: { dayOfWeek: 0, startTimeLocal: '23:30', durationMinutes: 60 },
      },
    ]);
  });

  it('locks the account, then the teacher-slots key, and only then reads (T005, the note under T019)', async () => {
    const { service, events } = world();
    await service.create(TEACHER, {
      dayOfWeek: 2,
      startTimeLocal: '09:00',
      durationMinutes: 45,
      idempotencyKey: KEY,
    });
    expect(events).toEqual([
      `lock account ${TEACHER}`,
      `lock key teacher-slots ${TEACHER}`,
      'read zone',
      'read active slots',
      'insert',
    ]);
  });

  it('refuses Monday 00:00 against Sunday 23:30 for 60, across midnight, and writes nothing', async () => {
    const sunday = stored({ dayOfWeek: 0, startTimeLocal: '23:30:00', durationMinutes: 60 });
    const { service, events, slots } = world({ slots: [sunday] });
    await expect(
      service.create(TEACHER, {
        dayOfWeek: 1,
        startTimeLocal: '00:00',
        durationMinutes: 30,
        idempotencyKey: KEY,
      }),
    ).rejects.toEqual(refusal('SLOT_OVERLAP'));
    expect(events).not.toContain('insert');
    expect(slots.size).toBe(1);
  });

  it("refuses Sunday 00:00 against Saturday 23:30 for 60, Saturday's end wrapping to Sunday", async () => {
    const saturday = stored({ dayOfWeek: 6, startTimeLocal: '23:30:00', durationMinutes: 60 });
    const { service } = world({ slots: [saturday] });
    await expect(
      service.create(TEACHER, {
        dayOfWeek: 0,
        startTimeLocal: '00:00',
        durationMinutes: 30,
        idempotencyKey: KEY,
      }),
    ).rejects.toEqual(refusal('SLOT_OVERLAP'));
  });

  it('takes a slot that ends where another starts, and ignores an inactive slot and another teacher’s', async () => {
    const { service, slots } = world({
      slots: [
        stored({ dayOfWeek: 1, startTimeLocal: '00:00:00', durationMinutes: 30 }),
        stored({ dayOfWeek: 0, startTimeLocal: '23:00:00', isActive: false }),
        stored({ dayOfWeek: 0, startTimeLocal: '23:00:00', teacherUserId: OTHER_TEACHER }),
      ],
    });
    await service.create(TEACHER, {
      dayOfWeek: 0,
      startTimeLocal: '23:30',
      durationMinutes: 30,
      idempotencyKey: KEY,
    });
    expect(slots.size).toBe(4);
  });

  it("compares a slot of an older zone in the new slot's zone for the week of the save (R-206)", async () => {
    // Riyadh Monday 10:00 for 60 is Cairo 09:00 to 10:00 in winter and 10:00 to 11:00 in summer.
    const riyadh = stored({ dayOfWeek: 1, startTimeLocal: '10:00:00', timezone: 'Asia/Riyadh' });
    const input = {
      dayOfWeek: 1,
      startTimeLocal: '09:30',
      durationMinutes: 30,
      idempotencyKey: KEY,
    } as const;
    await expect(world({ slots: [riyadh] }).service.create(TEACHER, input)).rejects.toEqual(
      refusal('SLOT_OVERLAP'),
    );
    await expect(
      world({ slots: [riyadh], now: SUMMER }).service.create(TEACHER, input),
    ).resolves.toMatchObject({ timezone: 'Africa/Cairo', state: 'free' });
  });
});

describe('teacher.slots.update (FR-314, FR-317, FR-318, R-207, M3)', () => {
  it("answers another teacher's slot NOT_FOUND, takes no lock on it and writes nothing (M3)", async () => {
    const theirs = stored({
      dayOfWeek: 3,
      startTimeLocal: '09:00:00',
      teacherUserId: OTHER_TEACHER,
    });
    const { service, events, slots } = world({ slots: [theirs] });
    await expect(service.update(TEACHER, { slotId: theirs.id, isActive: false })).rejects.toEqual(
      refusal('NOT_FOUND'),
    );
    expect(events).toEqual([
      `lock account ${TEACHER}`,
      `lock key teacher-slots ${TEACHER}`,
      `read owner ${theirs.id}`,
    ]);
    expect(slots.get(theirs.id)).toEqual(theirs);
  });

  it('answers a slot id nobody has NOT_FOUND', async () => {
    const { service } = world();
    await expect(
      service.update(TEACHER, { slotId: '0199d0a0-0000-7000-8000-00000000ffff', isActive: true }),
    ).rejects.toEqual(refusal('NOT_FOUND'));
  });

  it('refuses the day, the start or the length of a slot in use, after its locks, and writes nothing', async () => {
    const slot = stored({ dayOfWeek: 3, startTimeLocal: '09:00:00' });
    const changes: readonly Omit<SlotsUpdateInput, 'slotId'>[] = [
      { dayOfWeek: 4 },
      { startTimeLocal: '10:00' },
      { durationMinutes: 30 },
    ];
    for (const change of changes) {
      const { service, events, slots } = world({ slots: [slot], inUse: [slot.id] });
      await expect(service.update(TEACHER, { slotId: slot.id, ...change })).rejects.toEqual(
        refusal('SLOT_IN_USE'),
      );
      expect(events).toEqual([
        `lock account ${TEACHER}`,
        `lock key teacher-slots ${TEACHER}`,
        `read owner ${slot.id}`,
        `lock slot ${slot.id}`,
        `read slot ${slot.id}`,
        `in use? ${slot.id}`,
      ]);
      expect(slots.get(slot.id)).toEqual(slot);
    }
  });

  it('takes the same day, start and length of a slot in use, which changes nothing', async () => {
    const slot = stored({ dayOfWeek: 3, startTimeLocal: '09:00:00' });
    const { service } = world({ slots: [slot], inUse: [slot.id] });
    await expect(
      service.update(TEACHER, {
        slotId: slot.id,
        dayOfWeek: 3,
        startTimeLocal: '09:00',
        durationMinutes: 60,
      }),
    ).resolves.toMatchObject({ state: 'booked', startTimeLocal: '09:00' });
  });

  it('deactivates a slot in use: always allowed, answered disabled (FR-314)', async () => {
    const slot = stored({ dayOfWeek: 3, startTimeLocal: '09:00:00' });
    const { service, slots } = world({ slots: [slot], inUse: [slot.id] });
    await expect(service.update(TEACHER, { slotId: slot.id, isActive: false })).resolves.toEqual({
      id: slot.id,
      dayOfWeek: 3,
      startTimeLocal: '09:00',
      durationMinutes: 60,
      timezone: 'Africa/Cairo',
      isActive: false,
      state: 'disabled',
    });
    expect(slots.get(slot.id)?.isActive).toBe(false);
  });

  it('edits a free slot freely, keeping its zone, after checking the overlap under its locks', async () => {
    const slot = stored({ dayOfWeek: 3, startTimeLocal: '09:00:00', timezone: 'Asia/Riyadh' });
    const { service, events } = world({ slots: [slot] });
    await expect(
      service.update(TEACHER, { slotId: slot.id, dayOfWeek: 4, startTimeLocal: '18:15' }),
    ).resolves.toEqual({
      id: slot.id,
      dayOfWeek: 4,
      startTimeLocal: '18:15',
      durationMinutes: 60,
      timezone: 'Asia/Riyadh',
      isActive: true,
      state: 'free',
    });
    expect(events.slice(0, 7)).toEqual([
      `lock account ${TEACHER}`,
      `lock key teacher-slots ${TEACHER}`,
      `read owner ${slot.id}`,
      `lock slot ${slot.id}`,
      `read slot ${slot.id}`,
      `in use? ${slot.id}`,
      'read active slots',
    ]);
  });

  it('refuses moving an active slot onto another (SLOT_OVERLAP), against itself never', async () => {
    const monday = stored({ dayOfWeek: 1, startTimeLocal: '00:00:00', durationMinutes: 30 });
    const slot = stored({ dayOfWeek: 3, startTimeLocal: '09:00:00' });
    const { service, slots } = world({ slots: [monday, slot] });
    await expect(
      service.update(TEACHER, { slotId: slot.id, dayOfWeek: 0, startTimeLocal: '23:30' }),
    ).rejects.toEqual(refusal('SLOT_OVERLAP'));
    expect(slots.get(slot.id)).toEqual(slot);
    await expect(
      service.update(TEACHER, { slotId: slot.id, startTimeLocal: '09:30' }),
    ).resolves.toMatchObject({ startTimeLocal: '09:30' });
  });

  it('re-checks the overlap on reactivation and refuses it (FR-317)', async () => {
    const sunday = stored({ dayOfWeek: 0, startTimeLocal: '23:30:00', durationMinutes: 60 });
    const monday = stored({ dayOfWeek: 1, startTimeLocal: '00:00:00', isActive: false });
    const { service, slots } = world({ slots: [sunday, monday] });
    await expect(service.update(TEACHER, { slotId: monday.id, isActive: true })).rejects.toEqual(
      refusal('SLOT_OVERLAP'),
    );
    expect(slots.get(monday.id)?.isActive).toBe(false);
  });

  it('reactivates a slot that overlaps nothing, answered booked while it is in use', async () => {
    const slot = stored({ dayOfWeek: 2, startTimeLocal: '08:00:00', isActive: false });
    const { service } = world({ slots: [slot], inUse: [slot.id] });
    await expect(
      service.update(TEACHER, { slotId: slot.id, isActive: true }),
    ).resolves.toMatchObject({ isActive: true, state: 'booked' });
  });

  it('does not check the overlap of a slot left inactive, nor of an active slot whose time stays', async () => {
    const sunday = stored({ dayOfWeek: 0, startTimeLocal: '23:30:00', durationMinutes: 60 });
    const monday = stored({ dayOfWeek: 1, startTimeLocal: '00:00:00', isActive: false });
    const { service, events } = world({ slots: [sunday, monday] });
    await service.update(TEACHER, { slotId: monday.id, startTimeLocal: '00:15' });
    await service.update(TEACHER, { slotId: sunday.id, isActive: true });
    expect(events).not.toContain('read active slots');
  });
});

describe('teacher.slots.list (FR-313, R-207)', () => {
  it("answers the teacher's zone and every slot with its state, asking about use only of active ones", async () => {
    const free = stored({ dayOfWeek: 1, startTimeLocal: '09:00:00' });
    const booked = stored({ dayOfWeek: 2, startTimeLocal: '09:00:00', durationMinutes: 30 });
    const disabled = stored({ dayOfWeek: 3, startTimeLocal: '09:00:00', isActive: false });
    const theirs = stored({
      dayOfWeek: 4,
      startTimeLocal: '09:00:00',
      teacherUserId: OTHER_TEACHER,
    });
    const { service, events } = world({
      slots: [free, booked, disabled, theirs],
      zones: { [TEACHER]: 'Asia/Riyadh' },
      inUse: [booked.id, disabled.id],
    });
    expect(await service.list(TEACHER, REQUESTER)).toEqual({
      published: false,
      timezone: 'Asia/Riyadh',
      slots: [
        expect.objectContaining({ id: free.id, startTimeLocal: '09:00', state: 'free' }),
        expect.objectContaining({ id: booked.id, durationMinutes: 30, state: 'booked' }),
        expect.objectContaining({ id: disabled.id, isActive: false, state: 'disabled' }),
      ],
    });
    expect(events).not.toContain(`in use? ${disabled.id}`);
  });

  it('answers `published` as the predicate answers it for the teacher, asked with the session’s gender (FR-315)', async () => {
    const free = stored({ dayOfWeek: 1, startTimeLocal: '09:00:00' });
    const unpublished = world({ slots: [free] });
    expect(await unpublished.service.list(TEACHER, REQUESTER)).toMatchObject({ published: false });
    const otherGender = world({ slots: [free], published: [`${TEACHER}:male`] });
    expect(await otherGender.service.list(TEACHER, REQUESTER)).toMatchObject({ published: false });
    const visible = world({ slots: [free], published: [`${TEACHER}:female`] });
    expect(await visible.service.list(TEACHER, REQUESTER)).toEqual({
      published: true,
      timezone: 'Africa/Cairo',
      slots: [expect.objectContaining({ id: free.id, state: 'free' })],
    });
    for (const { events } of [unpublished, otherGender, visible]) {
      expect(events.filter((event) => event.startsWith('is published?'))).toEqual([
        'is published? female',
      ]);
    }
  });

  it('answers `published` with no slot at all, so the empty week shows it too', async () => {
    const { service } = world({ published: [`${TEACHER}:female`] });
    expect(await service.list(TEACHER, REQUESTER)).toEqual({
      published: true,
      timezone: 'Africa/Cairo',
      slots: [],
    });
  });

  it('takes no lock: the list decides nothing', async () => {
    const free = stored({ dayOfWeek: 1, startTimeLocal: '09:00:00' });
    const { service, events } = world({ slots: [free] });
    await service.list(TEACHER, REQUESTER);
    expect(events.filter((event) => event.startsWith('lock'))).toEqual([]);
  });
});
