// 003:T105 (ADR 0025 D2, SRS DEC-81, DEC-89; the notes under T105, Q-6 as revised): the reads of the
// releases of a teacher's share and the administrator's mark. Nothing here moves money or calls the
// gateway (N1): the mark records that an administrator executed a release in the gateway's dashboard.
//
// ROWS. A written release is `due` until marked, then `paid` with the mark's date. A release the
// rules owe and the sweep has not written is `held` with when it would fall due, or `due` (no id
// yet) between its due instant and the sweep's next run. «عليه» is each order with a refund recorded:
// the refund as recorded and the teacher's share of it (`refundShareOf`, T104's rounding up), with
// the enrollment's closing case when one closed it.
//
// THE TEACHER («مستحقاتي», `teacher.dues.get`): his own enrollments only, read through booking's
// `enrollmentIdsOfTeacher` for the caller's id from the session; no order, enrollment or student id
// and no name in the answer.
//
// THE ADMINISTRATOR («تحويلات المعلمين»). `list`: the figures of every teacher with a release
// written or owed or a refund on his orders, computed over every paid order with a share and every
// written release, read in pages of `admin_list_page_size` (each read bounded; the whole scan grows with
// the orders, re-checked at Phase 6's load pass, a follow-up). The teachers with something due first,
// the oldest due first, then by id; pages of `admin_list_page_size` after a teacher's id. `get`: one
// teacher's rows with the order and the student behind each, and his payout account masked.
// `mark`: keyed (`payouts.mark`, `runOn` on the call's transaction); one conditional update `WHERE
// marked_at IS NULL`, so two marks at once mark once; an unknown release is refused `NOT_FOUND`, one
// already marked `CONFLICT` (Q-B1-11); each refusal and the mark log one line of ids and a reason.
import type {
  PayoutDeduction,
  PayoutFigures,
  PayoutRelease,
  PayoutsGetOutput,
  PayoutsListInput,
  PayoutsListItem,
  PayoutsListOutput,
  PayoutsMarkInput,
  PayoutsUnmarkInput,
} from '@ijazah/contracts/admin';
import type {
  ShareReleaseMilestone,
  ShareReleaseState,
  TeacherDuesGetOutput,
} from '@ijazah/contracts';
import { lowest, type Piasters, piasters, shareLeft, sumOf, toPlainNumber } from '@ijazah/money';
import { localDateIn, startOfLocalDay } from '@ijazah/time';
import { z } from 'zod';

import type { ColumnCipher } from '../../platform/crypto/encryption.js';
import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { enrollmentIdsOfTeacher } from '../booking/index.js';
import type { EnrollmentCase } from '../moderation/index.js';
import { displayNamesOf, payoutRecipientOf } from '../identity/index.js';
import {
  markRelease,
  unmarkRelease,
  type ReleaseRow,
  releaseById,
  releasesAfter,
  refundedShareOrdersAfter,
  refundedShareOrdersOf,
  type ShareOrderRow,
  shareOrdersAfter,
} from './share-release.repository.js';
import {
  awaitedOrdersOf,
  END_RELEASES,
  plannedReleases,
  programmeSharesOf,
  type RefundPart,
  refundPartsOf,
  refundShareOf,
} from './share-release.rules.js';
import {
  type EnrollmentReleases,
  releaseReads,
  type ReleaseReads,
  releasesAmong,
  windowHoursOf,
} from './share-release.service.js';

/** The page size of every admin list (SRS §3.14, FR-412). */
const LIST_PAGE_SIZE_SETTING = 'admin_list_page_size';
const positiveWhole = z.int().positive();

/** The month «paid this month» counts in (Q-B1-9 (a)): the platform's market's calendar month. */
export const PAYOUT_MONTH_ZONE = 'Africa/Cairo';

/**
 * The masked payout account shows its reference's last characters only, as many as the mask's dots
 * (Q-B1-8 (a): four), so no length is written as a literal (the magic-number gate, FR-034).
 */
const MASK = '••••';

const MARK_SCOPE = 'payouts.mark';
const UNMARK_SCOPE = 'payouts.unmark';

/** 006:T018 (FU-E1): a paid order a release draws from, and the amount from it. */
export interface ReleaseDraw {
  readonly paymentId: string;
  readonly amount_piasters: Piasters;
}

/** One release of an enrollment as both pages read it. */
export interface ReleaseLine {
  readonly releaseId?: string;
  readonly enrollmentId: string;
  readonly paymentId: string;
  readonly teacherUserId: string;
  readonly studentUserId: string;
  readonly part: ShareReleaseMilestone;
  readonly amount_piasters: Piasters;
  readonly state: ShareReleaseState;
  readonly fallsDueAt?: Date;
  readonly waitsForCase: boolean;
  readonly paidAt?: Date;
  /** 006:T018 (FU-E1): the paid orders it draws from, in the order drawn, with the amount from each. */
  readonly orders: readonly ReleaseDraw[];
}

/**
 * 006:T018 (FU-E1 (a), Q-f5 (a), the owners' «موافق» of 2026-11-23 and 2026-11-24): the orders each of
 * `amounts` draws from, in order. A programme's releases draw the shares of the orders its shares
 * count (`awaitedOrdersOf`: a duplicate month is the `duplicate_payment` case's, Q-5 (a)) oldest
 * first, each order less what the releases before took from it; a package's release draws its one
 * order. Offer 10,000 EGP over 10 months, fee 500 EGP, 70 %: the half, 1,837.50, draws 350 + 700 + 700
 * + 87.50; the end, 5,512.50, draws 612.50 + 700 × 7. All arithmetic is `packages/money`'s.
 */
function drawsOf(
  facts: EnrollmentReleases['facts'],
  amounts: readonly Piasters[],
): readonly (readonly ReleaseDraw[])[] {
  if (programmeSharesOf(facts) === undefined) {
    return amounts.map((amount_piasters) => [
      { paymentId: facts.order.paymentId, amount_piasters },
    ]);
  }
  const pool = awaitedOrdersOf(facts.orders);
  const taken = new Map<string, Piasters[]>();
  return amounts.map((amount_piasters) => {
    const orders: ReleaseDraw[] = [];
    let need_piasters = amount_piasters;
    for (const paid of pool) {
      if (need_piasters === 0) break;
      const before = taken.get(paid.paymentId) ?? [];
      const draw_piasters = lowest([
        shareLeft(paid.share_piasters, before, piasters(0)),
        need_piasters,
      ]);
      if (draw_piasters === 0) continue;
      taken.set(paid.paymentId, [...before, draw_piasters]);
      need_piasters = shareLeft(need_piasters, [draw_piasters], piasters(0));
      orders.push({ paymentId: paid.paymentId, amount_piasters: draw_piasters });
    }
    return orders;
  });
}

/** Every release of `one`: the written ones, then the owed ones the rules plan. */
export function releaseLinesOf(
  one: EnrollmentReleases,
  { windowHours, now }: { readonly windowHours: number; readonly now: Date },
): readonly ReleaseLine[] {
  const { enrollment, order } = one.facts;
  const base = {
    enrollmentId: enrollment.enrollmentId,
    paymentId: order.paymentId,
    teacherUserId: enrollment.teacherUserId,
    studentUserId: enrollment.studentUserId,
  };
  const planned = plannedReleases(one.facts, { windowHours, now });
  const draws = drawsOf(one.facts, [
    ...one.written.map(({ amount_piasters }) => amount_piasters),
    ...planned.map(({ amount_piasters }) => amount_piasters),
  ]);
  const drawnBy = (index: number): readonly ReleaseDraw[] => draws[index] ?? [];
  const written = one.written.map((row, index): ReleaseLine => ({
    ...base,
    releaseId: row.id,
    part: row.milestone,
    amount_piasters: row.amount_piasters,
    state: row.markedAt === null ? 'due' : 'paid',
    fallsDueAt: row.dueAt,
    waitsForCase: false,
    ...(row.markedAt === null ? {} : { paidAt: row.markedAt }),
    orders: drawnBy(index),
  }));
  const owed = planned.map((release, index): ReleaseLine => ({
    ...base,
    part: release.milestone,
    amount_piasters: release.amount_piasters,
    state: release.due ? 'due' : 'held',
    ...(release.dueAt === undefined ? {} : { fallsDueAt: release.dueAt }),
    waitsForCase: release.waitsForCase,
    orders: drawnBy(one.written.length + index),
  }));
  return [...written, ...owed];
}

/** The newest compensation case of a closed enrollment, its closing case; none while it runs. */
function closingCaseOf(one: EnrollmentReleases | undefined): EnrollmentCase | undefined {
  if (one === undefined) return undefined;
  const { status } = one.facts.enrollment;
  return status === 'cancelled' || status === 'terminated_no_show' ? one.cases[0] : undefined;
}

const amountsIn = (lines: readonly ReleaseLine[], state: ShareReleaseState): Piasters =>
  sumOf(lines.filter((line) => line.state === state).map(({ amount_piasters }) => amount_piasters));

/** 003:T127: the share an enrollment's end releases took off, or undefined while none is written. */
function endTakenOffOf(written: readonly ReleaseRow[]): Piasters | undefined {
  const ends = written.filter(({ milestone }) => END_RELEASES.has(milestone));
  return ends.length === 0
    ? undefined
    : sumOf(ends.map(({ refundTakenOff_piasters }) => refundTakenOff_piasters));
}

/**
 * 003:T127 (SRS DEC-98; Q-4 (a)): each refunded order's share split (`refundPartsOf`), by enrollment,
 * the orders in id order. `left` holds each enrollment's share its end release took off and not yet
 * given to an order (undefined while none is written) and is drawn down, so a scan in pages gives
 * it once. By payment id.
 */
function splitRefunds(
  orders: readonly ShareOrderRow[],
  left: Map<string, Piasters | undefined>,
): ReadonlyMap<string, RefundPart> {
  const parts = new Map<string, RefundPart>();
  for (const enrollmentId of new Set(orders.map((one) => one.enrollmentId))) {
    const own = orders.filter((one) => one.enrollmentId === enrollmentId);
    const taken_piasters = left.get(enrollmentId);
    const split = refundPartsOf(own, taken_piasters);
    own.forEach((one, index) => {
      const part = split[index];
      if (part !== undefined) parts.set(one.paymentId, part);
    });
    if (taken_piasters !== undefined) {
      const given = split.map(({ teacher_piasters }) => teacher_piasters);
      left.set(enrollmentId, shareLeft(taken_piasters, given, piasters(0)));
    }
  }
  return parts;
}

/** 003:T127: the teacher's part of an order's refund share, the whole share where none is split. */
const teacherPartOf = (parts: ReadonlyMap<string, RefundPart>, order: ShareOrderRow): Piasters =>
  parts.get(order.paymentId)?.teacher_piasters ?? refundShareOf(order);

/** The first instant of `now`'s calendar month in the payouts' zone. */
export function monthStartOf(now: Date): Date {
  const today = localDateIn(now, PAYOUT_MONTH_ZONE);
  return new Date(startOfLocalDay(today.replace(/-\d+$/, '-01'), PAYOUT_MONTH_ZONE));
}

/** The last characters of the gateway's recipient reference, the rest hidden (Q-B1-8 (a)). */
export function maskedReference(reference: string): string {
  // The visible tail is as long as the mask on purpose: the owner's last 4 (Q-B1-8 (a)), not a trick.
  return `${MASK}${reference.slice(-MASK.length)}`;
}

function figuresOf(
  lines: readonly ReleaseLine[],
  takenOff: readonly Piasters[],
  monthStart: Date,
): PayoutFigures {
  const paidThisMonth = lines.filter(
    (line) => line.state === 'paid' && line.paidAt !== undefined && line.paidAt >= monthStart,
  );
  return {
    held_piasters: toPlainNumber(amountsIn(lines, 'held')),
    dueNow_piasters: toPlainNumber(amountsIn(lines, 'due')),
    paid_piasters: toPlainNumber(amountsIn(lines, 'paid')),
    paidThisMonth_piasters: toPlainNumber(
      sumOf(paidThisMonth.map(({ amount_piasters }) => amount_piasters)),
    ),
    takenOff_piasters: toPlainNumber(sumOf(takenOff)),
  };
}

/** What the payouts read beyond the release reads; faked in a spec. */
export interface PayoutsStore {
  readonly reads: ReleaseReads;
  enrollmentIdsOfTeacher(tx: Transaction, teacherUserId: string): Promise<readonly string[]>;
  refundedOrdersOf(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<readonly ShareOrderRow[]>;
  shareOrdersAfter(
    tx: Transaction,
    after: string | undefined,
    take: number,
  ): Promise<readonly ShareOrderRow[]>;
  refundedOrdersAfter(
    tx: Transaction,
    after: string | undefined,
    take: number,
  ): Promise<readonly ShareOrderRow[]>;
  releasesAfter(
    tx: Transaction,
    after: string | undefined,
    take: number,
  ): Promise<readonly ReleaseRow[]>;
  namesOf(tx: Transaction, userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  payoutReferenceOf(tx: Transaction, teacherUserId: string): Promise<string | null>;
  releaseById(tx: Transaction, releaseId: string): Promise<ReleaseRow | null>;
  markRelease(
    tx: Transaction,
    mark: { readonly releaseId: string; readonly adminId: string; readonly at: Date },
  ): Promise<boolean>;
  /** The undo of a mark: true when this call cleared it. */
  unmarkRelease(tx: Transaction, releaseId: string): Promise<boolean>;
}

/** The store over payments' queries and the owners' entries; the cipher decrypts the reference. */
export function payoutsStoreOver(cipher: Pick<ColumnCipher, 'decrypt'>): PayoutsStore {
  return {
    reads: releaseReads,
    enrollmentIdsOfTeacher,
    refundedOrdersOf: refundedShareOrdersOf,
    shareOrdersAfter,
    refundedOrdersAfter: refundedShareOrdersAfter,
    releasesAfter,
    namesOf: displayNamesOf,
    payoutReferenceOf: (tx, teacherUserId) => payoutRecipientOf(tx, cipher, teacherUserId),
    releaseById,
    markRelease,
    unmarkRelease,
  };
}

/**
 * 003:T126 (SRS DEC-96's last clause; Q15 (a)): the release a mark or an unmark touched, as its
 * audit entry's `after` names it: ids and an amount, no personal data. Read before the write, so the
 * unmark's names the release although it clears the mark's columns; the key's row stores it (JSON).
 */
export type MarkedRelease = {
  readonly releaseId: string;
  readonly enrollmentId: string;
  readonly milestone: ShareReleaseMilestone;
  readonly amount_piasters: Piasters;
};

/** What a mark or an unmark answers: the teacher and the release, for the audit entry. */
export type MarkOutcome = {
  readonly teacherUserId: string;
  readonly release: MarkedRelease;
};

/** The teacher's read and the administrator's four procedures. */
export interface Payouts {
  /** `teacher.dues.get`: the caller's own releases and his share of each refund. */
  teacherDues(tx: Transaction, teacherUserId: string): Promise<TeacherDuesGetOutput>;
  /** `payouts.list`. */
  list(tx: Transaction, adminId: string, input: PayoutsListInput): Promise<PayoutsListOutput>;
  /** `payouts.get`. */
  get(tx: Transaction, adminId: string, teacherUserId: string): Promise<PayoutsGetOutput>;
  /** `payouts.mark`, keyed; the marked release and its teacher, for the audit entry. */
  mark(
    tx: Transaction,
    adminId: string,
    input: PayoutsMarkInput,
  ): Promise<MarkOutcome & { readonly replayed: boolean }>;
  /** `payouts.unmark`, keyed; a mark made in error undone; the release and its teacher, as `mark`. */
  unmark(
    tx: Transaction,
    adminId: string,
    input: PayoutsUnmarkInput,
  ): Promise<MarkOutcome & { readonly replayed: boolean }>;
}

/** The release `row` as a mark's or an unmark's outcome names it. */
function markOutcomeOf(row: ReleaseRow): MarkOutcome {
  return {
    teacherUserId: row.teacherUserId,
    release: {
      releaseId: row.id,
      enrollmentId: row.enrollmentId,
      milestone: row.milestone,
      amount_piasters: row.amount_piasters,
    },
  };
}

export interface PayoutsDependencies {
  readonly settings: SettingsReader;
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'runOn'>;
  readonly store: PayoutsStore;
  readonly log: Pick<Logger, 'info'>;
  /** The database's clock on the transaction. */
  readonly clock?: (tx: Transaction) => Promise<Date>;
}

export function createPayouts({
  settings,
  idempotency,
  store,
  log,
  clock = clockTimestamp,
}: PayoutsDependencies): Payouts {
  /** One teacher's release lines and refunded orders, with the facts behind them. */
  const teacherPicture = async (tx: Transaction, teacherUserId: string) => {
    const enrollmentIds = await store.enrollmentIdsOfTeacher(tx, teacherUserId);
    const [among, refunded, windowHours, now] = await Promise.all([
      releasesAmong(tx, enrollmentIds, store.reads),
      store.refundedOrdersOf(tx, enrollmentIds),
      windowHoursOf(settings),
      clock(tx),
    ]);
    // An enrollment read for a teacher answers only if it is his (booking's id list is his own).
    const own = among.filter(({ facts }) => facts.enrollment.teacherUserId === teacherUserId);
    const lines = own.flatMap((one) => releaseLinesOf(one, { windowHours, now }));
    const byEnrollment = new Map(own.map((one) => [one.facts.enrollment.enrollmentId, one]));
    // His own refunded orders only, as his own releases.
    const ownRefunded = refunded.filter(({ enrollmentId }) => byEnrollment.has(enrollmentId));
    // 003:T127: each refund's share split by the end release's taken-off share (DEC-98).
    const parts = splitRefunds(
      ownRefunded,
      new Map(own.map((one) => [one.facts.enrollment.enrollmentId, endTakenOffOf(one.written)])),
    );
    return { lines, refunded: ownRefunded, parts, byEnrollment, now, windowHours };
  };

  const refusal = (
    ids: Readonly<Record<string, string>>,
    code: 'NOT_FOUND' | 'CONFLICT',
    reason: 'no_release' | 'already_marked' | 'not_marked',
    call: 'mark' | 'unmark' = 'mark',
  ): DomainError => {
    log.info({ ...ids, errorCode: code, reason }, `A payout release's ${call} was refused`);
    return markRefusalLogged(
      new DomainError(
        code,
        undefined,
        code === 'CONFLICT' ? { details: [{ path: 'releaseId', code: reason }] } : undefined,
      ),
    );
  };

  return {
    teacherDues: async (tx, teacherUserId) => {
      const { lines, refunded, parts, byEnrollment, windowHours } = await teacherPicture(
        tx,
        teacherUserId,
      );
      return {
        held_piasters: toPlainNumber(amountsIn(lines, 'held')),
        paid_piasters: toPlainNumber(amountsIn(lines, 'paid')),
        releases: lines.map((line) => ({
          part: line.part,
          amount_piasters: toPlainNumber(line.amount_piasters),
          state: line.state,
          ...(line.fallsDueAt === undefined ? {} : { fallsDueAt: line.fallsDueAt.toISOString() }),
          waitsForCase: line.waitsForCase,
          ...(line.paidAt === undefined ? {} : { paidAt: line.paidAt.toISOString() }),
        })),
        // 003:T127 (DEC-98): a refund after the end release is the platform's, never listed here.
        deductions: refunded.flatMap((order) => {
          const share = toPlainNumber(teacherPartOf(parts, order));
          if (share === 0) return [];
          const closing = closingCaseOf(byEnrollment.get(order.enrollmentId));
          return [
            {
              share_piasters: share,
              ...(closing === undefined ? {} : { caseReason: closing.reason }),
            },
          ];
        }),
        // The window as read at this request (the owner, 2026-11-18): the held line's hours.
        disputeWindowHours: windowHours,
      };
    },

    list: async (tx, _adminId, { dueOnly, cursor }) => {
      const [pageSize, windowHours, now] = await Promise.all([
        settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole),
        windowHoursOf(settings),
        clock(tx),
      ]);
      const lines: ReleaseLine[] = [];
      const takenOff = new Map<string, Piasters[]>();
      // The owed releases of every paid order with a share; the written ones come with them.
      let after: string | undefined;
      const seen = new Set<string>();
      for (;;) {
        const orders = await store.shareOrdersAfter(tx, after, pageSize);
        const fresh = orders.map(({ enrollmentId }) => enrollmentId).filter((id) => !seen.has(id));
        for (const id of fresh) seen.add(id);
        for (const one of await releasesAmong(tx, fresh, store.reads)) {
          lines.push(...releaseLinesOf(one, { windowHours, now }));
        }
        const next = orders.at(-1)?.paymentId;
        // A page that moves the cursor nowhere ends the scan, so a read that ignores it cannot loop.
        if (orders.length < pageSize || next === undefined || next === after) break;
        after = next;
      }
      // A written release of an enrollment no paid order reaches any more stays counted.
      let releasesFrom: string | undefined;
      for (;;) {
        const rows = await store.releasesAfter(tx, releasesFrom, pageSize);
        for (const row of rows.filter(({ enrollmentId }) => !seen.has(enrollmentId))) {
          lines.push({
            releaseId: row.id,
            enrollmentId: row.enrollmentId,
            paymentId: '',
            teacherUserId: row.teacherUserId,
            studentUserId: '',
            part: row.milestone,
            amount_piasters: row.amount_piasters,
            state: row.markedAt === null ? 'due' : 'paid',
            fallsDueAt: row.dueAt,
            waitsForCase: false,
            ...(row.markedAt === null ? {} : { paidAt: row.markedAt }),
            // 006:T018 (FU-E1): counted in the figures only; no paid order reaches it any more.
            orders: [],
          });
        }
        const next = rows.at(-1)?.id;
        if (rows.length < pageSize || next === undefined || next === releasesFrom) break;
        releasesFrom = next;
      }
      // «عليه»: every order with a refund recorded, by its enrollment's teacher; 003:T127: the
      // teacher's part only, each enrollment's end release read once, its share drawn down.
      let refundsFrom: string | undefined;
      const left = new Map<string, Piasters | undefined>();
      for (;;) {
        const orders = await store.refundedOrdersAfter(tx, refundsFrom, pageSize);
        const ids = [...new Set(orders.map(({ enrollmentId }) => enrollmentId))];
        const fresh = ids.filter((enrollmentId) => !left.has(enrollmentId));
        const [enrollments, written] = await Promise.all([
          store.reads.enrollmentsAmong(tx, ids),
          store.reads.releasesOf(tx, fresh),
        ]);
        for (const enrollmentId of fresh) {
          left.set(
            enrollmentId,
            endTakenOffOf(written.filter((row) => row.enrollmentId === enrollmentId)),
          );
        }
        const parts = splitRefunds(orders, left);
        for (const order of orders) {
          const teacherUserId = enrollments.get(order.enrollmentId)?.teacherUserId;
          if (teacherUserId === undefined) continue;
          takenOff.set(teacherUserId, [
            ...(takenOff.get(teacherUserId) ?? []),
            teacherPartOf(parts, order),
          ]);
        }
        const next = orders.at(-1)?.paymentId;
        if (orders.length < pageSize || next === undefined || next === refundsFrom) break;
        refundsFrom = next;
      }

      const monthStart = monthStartOf(now);
      const teachers = [
        ...new Set([...lines.map(({ teacherUserId }) => teacherUserId), ...takenOff.keys()]),
      ];
      const rows = teachers.map((teacherUserId) => {
        const own = lines.filter((line) => line.teacherUserId === teacherUserId);
        const dueAts = own
          .filter(({ state, fallsDueAt }) => state === 'due' && fallsDueAt !== undefined)
          .map(({ fallsDueAt }) => (fallsDueAt as Date).getTime());
        return {
          teacherUserId,
          figures: figuresOf(own, takenOff.get(teacherUserId) ?? [], monthStart),
          oldestDue: dueAts.length === 0 ? undefined : Math.min(...dueAts),
        };
      });
      rows.sort((a, b) => {
        if (a.oldestDue !== undefined && b.oldestDue !== undefined && a.oldestDue !== b.oldestDue) {
          return a.oldestDue - b.oldestDue;
        }
        if ((a.oldestDue === undefined) !== (b.oldestDue === undefined)) {
          return a.oldestDue === undefined ? 1 : -1;
        }
        return a.teacherUserId < b.teacherUserId ? -1 : 1;
      });
      const listed =
        dueOnly === true ? rows.filter(({ oldestDue }) => oldestDue !== undefined) : rows;
      const start =
        cursor === undefined
          ? 0
          : listed.findIndex(({ teacherUserId }) => teacherUserId === cursor) + 1;
      const page = listed.slice(start, start + pageSize);
      const names = await store.namesOf(
        tx,
        page.map(({ teacherUserId }) => teacherUserId),
      );
      const items: PayoutsListItem[] = page.map(({ teacherUserId, figures, oldestDue }) => ({
        ...figures,
        teacher: { userId: teacherUserId, displayName: names.get(teacherUserId) ?? '' },
        ...(oldestDue === undefined ? {} : { oldestDueAt: new Date(oldestDue).toISOString() }),
      }));
      const last = page.at(-1);
      return {
        totals: figuresOf(lines, [...takenOff.values()].flat(), monthStart),
        items,
        ...(start + pageSize < listed.length && last !== undefined
          ? { nextCursor: last.teacherUserId }
          : {}),
      };
    },

    get: async (tx, _adminId, teacherUserId) => {
      const { lines, refunded, parts, byEnrollment, now } = await teacherPicture(tx, teacherUserId);
      const people = [
        teacherUserId,
        ...lines.map(({ studentUserId }) => studentUserId),
        ...refunded.flatMap(({ enrollmentId }) => {
          const student = byEnrollment.get(enrollmentId)?.facts.enrollment.studentUserId;
          return student === undefined ? [] : [student];
        }),
      ];
      const [names, reference] = await Promise.all([
        store.namesOf(tx, [...new Set(people)]),
        store.payoutReferenceOf(tx, teacherUserId),
      ]);
      const named = (userId: string) => ({ userId, displayName: names.get(userId) ?? '' });
      const releases: PayoutRelease[] = lines.map((line) => ({
        ...(line.releaseId === undefined ? {} : { releaseId: line.releaseId }),
        part: line.part,
        amount_piasters: toPlainNumber(line.amount_piasters),
        state: line.state,
        ...(line.fallsDueAt === undefined ? {} : { fallsDueAt: line.fallsDueAt.toISOString() }),
        waitsForCase: line.waitsForCase,
        ...(line.paidAt === undefined ? {} : { paidAt: line.paidAt.toISOString() }),
        enrollmentId: line.enrollmentId,
        paymentId: line.paymentId,
        student: named(line.studentUserId),
        orders: line.orders.map(({ paymentId, amount_piasters }) => ({
          paymentId,
          amount_piasters: toPlainNumber(amount_piasters),
        })),
      }));
      const deductions: PayoutDeduction[] = refunded.flatMap((order) => {
        const one = byEnrollment.get(order.enrollmentId);
        if (one === undefined) return [];
        const closing = closingCaseOf(one);
        // 003:T127 (DEC-98): the part a refund after the end release leaves to the platform.
        const platform = toPlainNumber(
          parts.get(order.paymentId)?.platform_piasters ?? piasters(0),
        );
        return [
          {
            paymentId: order.paymentId,
            enrollmentId: order.enrollmentId,
            student: named(one.facts.enrollment.studentUserId),
            refunded_piasters: toPlainNumber(order.refunded_piasters),
            share_piasters: toPlainNumber(refundShareOf(order)),
            ...(platform === 0 ? {} : { platformShare_piasters: platform }),
            ...(closing === undefined
              ? {}
              : { case: { caseId: closing.caseId, reason: closing.reason } }),
          },
        ];
      });
      return {
        teacher: named(teacherUserId),
        ...(reference === null ? {} : { payoutAccountMasked: maskedReference(reference) }),
        figures: figuresOf(
          lines,
          refunded.map((order) => teacherPartOf(parts, order)),
          monthStartOf(now),
        ),
        releases,
        deductions,
      };
    },

    mark: async (tx, adminId, { releaseId, idempotencyKey }) => {
      const { outcome, replayed } = await idempotency.runOn<MarkOutcome>(
        tx,
        { scope: MARK_SCOPE, key: idempotencyKey, actorId: adminId, input: { releaseId } },
        async (on) => {
          const ids = { adminId, releaseId };
          const at = await clock(on);
          const release = await store.releaseById(on, releaseId);
          if (release === null) throw refusal(ids, 'NOT_FOUND', 'no_release');
          if (!(await store.markRelease(on, { releaseId, adminId, at }))) {
            throw refusal(ids, 'CONFLICT', 'already_marked');
          }
          log.info(
            {
              adminId,
              releaseId,
              enrollmentId: release.enrollmentId,
              teacherUserId: release.teacherUserId,
            },
            "A release of the teacher's share was marked paid",
          );
          return markOutcomeOf(release);
        },
      );
      return { ...outcome, replayed };
    },

    unmark: async (tx, adminId, { releaseId, reason, idempotencyKey }) => {
      const { outcome, replayed } = await idempotency.runOn<MarkOutcome>(
        tx,
        {
          scope: UNMARK_SCOPE,
          key: idempotencyKey,
          actorId: adminId,
          input: { releaseId, reason },
        },
        async (on) => {
          const ids = { adminId, releaseId };
          const release = await store.releaseById(on, releaseId);
          if (release === null) throw refusal(ids, 'NOT_FOUND', 'no_release', 'unmark');
          if (!(await store.unmarkRelease(on, releaseId))) {
            throw refusal(ids, 'CONFLICT', 'not_marked', 'unmark');
          }
          // Ids only: the reason is the audit entry's, never a log line's.
          log.info(
            {
              adminId,
              releaseId,
              enrollmentId: release.enrollmentId,
              teacherUserId: release.teacherUserId,
            },
            "A release of the teacher's share was unmarked",
          );
          // The figures of the read before the write (T126): the unmark clears the mark only.
          return markOutcomeOf(release);
        },
      );
      return { ...outcome, replayed };
    },
  };
}
