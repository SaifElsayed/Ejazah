// T019 (app-surface.md "`teacher.slots` — catalog"; R-206, R-207, FR-313, FR-314, FR-317, FR-318,
// M3): a teacher's weekly slots. The specs are slots.service.spec.ts (the rules and the lock order,
// over a store in memory) and tests/db-integrity/teacher-slots.spec.ts (the locks on Postgres).
//
// - A slot is a day of the week, a local start and a length of 30, 45 or 60 minutes, in the
//   teacher's zone at creation, never an instant (R-TIME-3). The contract's start is `HH:MM`; the
//   column's and `packages/time`'s is `HH:MM:SS`, converted at this service's edge.
// - A save that leaves a slot active with a new day, start or length, a create or a reactivation is
//   refused `SLOT_OVERLAP` when it shares a minute of the week with another active slot of the
//   teacher (`weeklyIntervalsOverlap`, the week a circle, so Sunday 23:30 for 60 meets Monday 00:00).
//   Two slots of different zones are compared in the newer slot's zone for the week of the save
//   (`weeklyIntervalIn`, the caller's clock): the conversion is the package's, added by this task
//   (the note under T019).
// - A slot's day, start and length stay while it is in use (`SLOT_IN_USE`, booking's answer through
//   the `CatalogUse` port, R-207); deactivation is always allowed (FR-314). Another teacher's slot,
//   or one nobody has, is `NOT_FOUND`, refused before its row is locked or anything is written (M3).
// - `list` answers `published`: the visibility predicate's answer for the teacher as a student of the
//   session's gender would get it, asked through identity's entry (`isPublishedTeacher`), the same
//   question `teacher.packages.list` and `teacher.profile.get` ask, so the three never differ (T069,
//   FR-315; the owner's decision of 2026-11-02). It decides nothing and takes no lock.
//
// LOCKS (T005's rules, the note under T019: the owner's decision of 2026-11-01). Lock, then read,
// in one order. `create` (keyed: the kernel's idempotency transaction) locks the teacher's account
// (identity's `lockAccount`: the new row references `users`), then
// `lockKey('teacher-slots', teacherId)`, then reads the zone and the active slots. `update` locks
// the account, then the key, then the slot's row, then asks whether it is in use and reads the
// others. The key is never taken after a slot's row, and `checkout.hold` locks the same account
// before it inserts a hold (R-207), so a save and a hold do not cross. The slot's teacher is read before
// its row is locked: it never changes, and a row of another teacher is never locked.
import {
  type SlotState,
  type SlotsCreateInput,
  type SlotsListOutput,
  type SlotsUpdateInput,
  type TeacherSlot,
} from '@ijazah/contracts';
import { type LocalTime, type TimeZoneId, weeklyIntervalIn } from '@ijazah/time';
import { weeklyIntervalsOverlap } from '@ijazah/time/calendar';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { CatalogUse } from './catalog-use.port.js';

/** A slot as the service reads it: its start `HH:MM:SS`, as the column and `packages/time` hold it. */
export interface SlotRow {
  readonly id: string;
  readonly dayOfWeek: number;
  readonly startTimeLocal: LocalTime;
  readonly durationMinutes: number;
  readonly timezone: TimeZoneId;
  readonly isActive: boolean;
  readonly createdAt: Date;
}

/** A slot to write. */
export interface NewSlot {
  readonly teacherUserId: string;
  readonly dayOfWeek: number;
  readonly startTimeLocal: LocalTime;
  readonly durationMinutes: number;
  readonly timezone: TimeZoneId;
  readonly isActive: boolean;
}

/** What an update writes; the zone is never among it. */
export type SlotChange = Partial<
  Pick<SlotRow, 'dayOfWeek' | 'startTimeLocal' | 'durationMinutes' | 'isActive'>
>;

/** What the slots read and write, each on the transaction it is handed (`index.ts` composes it). */
export interface SlotsStore {
  /** Runs `work` in one transaction: committed if it resolves, rolled back if it throws. */
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
  /** Locks the account's `users` row, identity's (T126). */
  lockAccount(tx: Transaction, userId: string): Promise<void>;
  /** Takes `lockKey('teacher-slots', teacherUserId)` (R-206). */
  lockTeacherSlots(tx: Transaction, teacherUserId: string): Promise<void>;
  /** Locks the slot's row (R-207). */
  lockSlot(tx: Transaction, slotId: string): Promise<void>;
  /** Whether discovery shows the teacher to a student of `requester`'s gender, identity's (FR-315). */
  isPublished(tx: Transaction, requester: RequesterGender, teacherUserId: string): Promise<boolean>;
  /** The account's zone, identity's; null for a person not there. */
  accountTimezone(tx: Transaction, userId: string): Promise<string | null>;
  ownsSlot(tx: Transaction, slotId: string, teacherUserId: string): Promise<boolean>;
  readSlot(tx: Transaction, slotId: string): Promise<SlotRow | null>;
  slotsOf(tx: Transaction, teacherUserId: string): Promise<SlotRow[]>;
  activeSlotsOf(tx: Transaction, teacherUserId: string): Promise<SlotRow[]>;
  insertSlot(tx: Transaction, slot: NewSlot): Promise<SlotRow>;
  updateSlot(tx: Transaction, slotId: string, change: SlotChange): Promise<SlotRow>;
}

/** `teacher.slots.*`, each on the caller's own slots. */
export interface TeacherSlots {
  /** `requester` is the session's gender, the teacher's own. */
  list(teacherUserId: string, requester: RequesterGender): Promise<SlotsListOutput>;
  create(teacherUserId: string, input: SlotsCreateInput): Promise<TeacherSlot>;
  update(teacherUserId: string, input: SlotsUpdateInput): Promise<TeacherSlot>;
}

export interface SlotsServiceDependencies {
  readonly store: SlotsStore;
  readonly use: CatalogUse;
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run'>;
  readonly now?: () => Date;
}

/** A slot saved, as the overlap reads it: when it was created, null for one not yet written. */
type Candidate = Omit<SlotRow, 'id' | 'createdAt' | 'isActive'> & {
  readonly id: string | null;
  readonly createdAt: Date | null;
};

const SECONDS = ':00';

/** The contract's `HH:MM` as the column's `HH:MM:SS`. */
const columnTime = (startTimeLocal: string): LocalTime => `${startTimeLocal}${SECONDS}`;

/** The column's `HH:MM:SS` as the contract's `HH:MM`. */
const contractTime = (startTimeLocal: LocalTime): string =>
  startTimeLocal.slice(0, -SECONDS.length);

function slotOf(row: SlotRow, state: SlotState): TeacherSlot {
  return {
    id: row.id,
    dayOfWeek: row.dayOfWeek,
    startTimeLocal: contractTime(row.startTimeLocal),
    durationMinutes: row.durationMinutes as TeacherSlot['durationMinutes'],
    timezone: row.timezone,
    isActive: row.isActive,
    state,
  };
}

export class SlotsService implements TeacherSlots {
  readonly #store: SlotsStore;
  readonly #use: CatalogUse;
  readonly #idempotency: SlotsServiceDependencies['idempotency'];
  readonly #now: () => Date;

  constructor({ store, use, idempotency, now = () => new Date() }: SlotsServiceDependencies) {
    this.#store = store;
    this.#use = use;
    this.#idempotency = idempotency;
    this.#now = now;
  }

  /**
   * `teacher.slots.list`: whether the slots are published (FR-315), the teacher's zone and every
   * slot, its state derived (R-207); `requester` is the session's gender, the teacher's own.
   */
  list(teacherUserId: string, requester: RequesterGender): Promise<SlotsListOutput> {
    return this.#store.run(async (tx) => {
      const published = await this.#store.isPublished(tx, requester, teacherUserId);
      const timezone = await this.#zoneOf(tx, teacherUserId);
      const rows = await this.#store.slotsOf(tx, teacherUserId);
      const slots: TeacherSlot[] = [];
      for (const row of rows) slots.push(slotOf(row, await this.#stateOf(tx, row)));
      return { published, timezone, slots };
    });
  }

  /** `teacher.slots.create`: keyed, so a retry answers the first slot (FR-106). */
  create(teacherUserId: string, input: SlotsCreateInput): Promise<TeacherSlot> {
    const { idempotencyKey, ...slot } = input;
    return this.#idempotency.run(
      { scope: 'teacher.slots.create', key: idempotencyKey, actorId: teacherUserId, input: slot },
      async (tx) => {
        await this.#store.lockAccount(tx, teacherUserId);
        await this.#store.lockTeacherSlots(tx, teacherUserId);
        const timezone = await this.#zoneOf(tx, teacherUserId);
        const candidate: Candidate = {
          id: null,
          createdAt: null,
          dayOfWeek: slot.dayOfWeek,
          startTimeLocal: columnTime(slot.startTimeLocal),
          durationMinutes: slot.durationMinutes,
          timezone,
        };
        await this.#refuseOverlap(tx, teacherUserId, candidate);
        const row = await this.#store.insertSlot(tx, {
          teacherUserId,
          dayOfWeek: candidate.dayOfWeek,
          startTimeLocal: candidate.startTimeLocal,
          durationMinutes: candidate.durationMinutes,
          timezone,
          isActive: true,
        });
        return slotOf(row, 'free');
      },
    );
  }

  /** `teacher.slots.update`: the caller's own slot only (M3). */
  update(teacherUserId: string, input: SlotsUpdateInput): Promise<TeacherSlot> {
    const { slotId } = input;
    return this.#store.run(async (tx) => {
      await this.#store.lockAccount(tx, teacherUserId);
      await this.#store.lockTeacherSlots(tx, teacherUserId);
      if (!(await this.#store.ownsSlot(tx, slotId, teacherUserId))) {
        throw new DomainError('NOT_FOUND');
      }
      await this.#store.lockSlot(tx, slotId);
      const slot = await this.#store.readSlot(tx, slotId);
      if (slot === null) throw new Error('slots: a slot disappeared under its lock');

      const change = changeOf(slot, input);
      const moves =
        change.dayOfWeek !== undefined ||
        change.startTimeLocal !== undefined ||
        change.durationMinutes !== undefined;
      if (moves && (await this.#use.slotInUse(tx, slotId))) throw new DomainError('SLOT_IN_USE');
      const next = { ...slot, ...change };
      if (next.isActive && (moves || !slot.isActive)) {
        await this.#refuseOverlap(tx, teacherUserId, next);
      }
      const row =
        Object.keys(change).length === 0 ? slot : await this.#store.updateSlot(tx, slotId, change);
      return slotOf(row, await this.#stateOf(tx, row));
    });
  }

  async #zoneOf(tx: Transaction, teacherUserId: string): Promise<string> {
    const timezone = await this.#store.accountTimezone(tx, teacherUserId);
    // The caller kind resolved this account from its session, so it is there.
    if (timezone === null) throw new Error('slots: the teacher account has no row');
    return timezone;
  }

  /** `disabled` when inactive, `booked` while in use, `free` otherwise (R-207). */
  async #stateOf(tx: Transaction, row: SlotRow): Promise<SlotState> {
    if (!row.isActive) return 'disabled';
    return (await this.#use.slotInUse(tx, row.id)) ? 'booked' : 'free';
  }

  /** Refuses `candidate` sharing a minute of the week with another active slot (R-206, FR-317). */
  async #refuseOverlap(
    tx: Transaction,
    teacherUserId: string,
    candidate: Candidate,
  ): Promise<void> {
    const weekOf = this.#now();
    for (const other of await this.#store.activeSlotsOf(tx, teacherUserId)) {
      if (other.id === candidate.id) continue;
      const newer =
        candidate.createdAt === null || candidate.createdAt.getTime() >= other.createdAt.getTime()
          ? candidate
          : other;
      if (
        weeklyIntervalsOverlap(
          weeklyIntervalIn(candidate, newer.timezone, weekOf),
          weeklyIntervalIn(other, newer.timezone, weekOf),
        )
      ) {
        throw new DomainError('SLOT_OVERLAP');
      }
    }
  }
}

/** What `input` changes of `slot`: a field given with the value it already has changes nothing. */
function changeOf(slot: SlotRow, input: SlotsUpdateInput): SlotChange {
  const startTimeLocal =
    input.startTimeLocal === undefined ? undefined : columnTime(input.startTimeLocal);
  return {
    ...(input.dayOfWeek === undefined || input.dayOfWeek === slot.dayOfWeek
      ? {}
      : { dayOfWeek: input.dayOfWeek }),
    ...(startTimeLocal === undefined || startTimeLocal === slot.startTimeLocal
      ? {}
      : { startTimeLocal }),
    ...(input.durationMinutes === undefined || input.durationMinutes === slot.durationMinutes
      ? {}
      : { durationMinutes: input.durationMinutes }),
    ...(input.isActive === undefined || input.isActive === slot.isActive
      ? {}
      : { isActive: input.isActive }),
  };
}
