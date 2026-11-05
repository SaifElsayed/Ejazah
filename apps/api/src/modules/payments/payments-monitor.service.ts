// T052 (FR-400, FR-401, FR-PAYG-7, FR-PAYG-11, FR-ADMIN-18; research R-220): the admin's payments
// monitor, two reads on the administrator call's transaction and nothing else. Nothing here writes:
// no order, event, enrollment or case is created, moved, refunded or confirmed (FR-401, FR-PAYG-8).
//
// THE LIST. Newest first by the order's time-ordered id, keyset pages of `admin_list_page_size`, one
// row more read than the page so a cursor is written only while more orders follow. The status
// filter is the query's. A search matches an order reference exactly, or a student's name by its
// folded prefix (R-203) through the kernel's `idsWithFoldedNamePrefix` over the students of the
// orders read, so no name is matched outside them. The student is booking's (the order's enrollment)
// and the name identity's, each through its entry (R-API-6), so a name search cannot be one query
// over `payments`: it reads the orders newest first, in windows starting at the page's size and each
// twice the last, and keeps the matches until the page is full or the orders end. Each read is
// bounded by its window; a scan of n orders takes a number of reads logarithmic in n.
//
// THE DETAIL. The order's amounts and references as reported (R-MONEY-5), the enrollment's package,
// status and progress through booking's entry, the order's signed events, the enrollment's
// outcomes that concern this order (its own confirmation or failure, and any cancellation), and
// every paid order of the enrollment: a compensation case covers each of them and records none, so
// the monitor lists them all (the note under T052, the owner's decision of 2026-11-03).
//
// AMOUNTS. `gross_piasters` always; `gatewayFee_piasters` and `net_piasters` only once the gateway
// reported them (FR-PAYG-7): a gateway that reports neither on its paid event leaves both absent.
// Each leaves the database's integer as `Piasters` (R-MONEY-1) and is never computed from another
// (R-MONEY-5).
import type {
  PaymentsGetOutput,
  PaymentsListInput,
  PaymentsListItem,
  PaymentsListOutput,
} from '@ijazah/contracts/admin';
import { type Piasters, piasters } from '@ijazah/money';
import { z } from 'zod';

import { idsWithFoldedNamePrefix } from '../../platform/db/folded-name.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  type MonitoredEnrollment,
  monitoredEnrollmentOf,
  type OrderEnrollmentParty,
  orderEnrollmentPartiesAmong,
} from '../booking/index.js';
import { displayNamesOf } from '../identity/index.js';
import {
  type MonitorEventRow,
  type MonitorOrderRow,
  monitoredOrderOf,
  orderEventsOf,
  orderPage,
  type OrderPageQuery,
  paidOrdersOf,
} from './payments-monitor.repository.js';

export type { MonitorEventRow, MonitorOrderRow, OrderPageQuery };

/** The page size of every admin list (SRS §3.14, FR-412). */
export const LIST_PAGE_SIZE_SETTING = 'admin_list_page_size';

const positiveWhole = z.int().positive();

/** What the monitor reads, each through its owner on the caller's transaction; faked in a spec. */
export interface PaymentsMonitorStore {
  orderPage(tx: Transaction, query: OrderPageQuery): Promise<readonly MonitorOrderRow[]>;
  orderOf(tx: Transaction, paymentId: string): Promise<MonitorOrderRow | null>;
  eventsOf(tx: Transaction, paymentId: string): Promise<readonly MonitorEventRow[]>;
  paidOrdersOf(tx: Transaction, enrollmentId: string): Promise<readonly MonitorOrderRow[]>;
  /** Booking's: each enrollment's student and status. */
  enrollmentPartiesAmong(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, OrderEnrollmentParty>>;
  /** Booking's: the enrollment's package, status, progress and outcomes at `now`. */
  enrollmentOf(
    tx: Transaction,
    enrollmentId: string,
    now: Date,
  ): Promise<MonitoredEnrollment | null>;
  /** Identity's: display names by account. */
  namesOf(tx: Transaction, userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** The kernel's: of `candidateIds`, those whose name, folded, begins with `typed`, folded. */
  namePrefixMatches(
    tx: Transaction,
    candidateIds: readonly string[],
    typed: string,
  ): Promise<readonly string[]>;
}

/** The store over the module's queries and the owners' entries (R-API-6). */
export const paymentsMonitorStore: PaymentsMonitorStore = {
  orderPage,
  orderOf: monitoredOrderOf,
  eventsOf: orderEventsOf,
  paidOrdersOf,
  enrollmentPartiesAmong: (tx, enrollmentIds) => orderEnrollmentPartiesAmong(tx, enrollmentIds),
  enrollmentOf: (tx, enrollmentId, now) => monitoredEnrollmentOf(tx, enrollmentId, now),
  namesOf: displayNamesOf,
  namePrefixMatches: idsWithFoldedNamePrefix,
};

export interface PaymentsMonitorDependencies {
  readonly settings: SettingsReader;
  readonly store?: PaymentsMonitorStore;
  readonly now?: () => Date;
}

/** An amount the gateway reported, or none. */
function reported(amount: bigint | null): Piasters | undefined {
  return amount === null ? undefined : piasters(Number(amount));
}

/** The fee and net as reported, each present only once reported (FR-PAYG-7). */
function settlementOf(row: MonitorOrderRow) {
  const fee_piasters = reported(row.gatewayFeePiasters);
  const net_piasters = reported(row.netPiasters);
  return {
    ...(fee_piasters === undefined ? {} : { gatewayFee_piasters: fee_piasters }),
    ...(net_piasters === undefined ? {} : { net_piasters }),
  };
}

export class PaymentsMonitorService {
  readonly #settings: SettingsReader;
  readonly #store: PaymentsMonitorStore;
  readonly #now: () => Date;

  constructor({ settings, store = paymentsMonitorStore, now }: PaymentsMonitorDependencies) {
    this.#settings = settings;
    this.#store = store;
    this.#now = now ?? (() => new Date());
  }

  /** `payments.list`: a page of orders, newest first (this file's head). */
  async list(tx: Transaction, query: PaymentsListInput): Promise<PaymentsListOutput> {
    const pageSize = await this.#settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole);
    const wanted = pageSize + 1;
    const kept: { readonly row: MonitorOrderRow; readonly party?: OrderEnrollmentParty }[] = [];
    let after = query.cursor;
    let window = wanted;
    // Without a search one read fills the page; with one, the reads go on until it is full, each
    // window twice the last, so a scan of n orders takes a number of reads logarithmic in n.
    for (;;) {
      const rows = await this.#store.orderPage(tx, { status: query.status, after, limit: window });
      const parties = await this.#store.enrollmentPartiesAmong(tx, [
        ...new Set(rows.map(({ enrollmentId }) => enrollmentId)),
      ]);
      const matching = await this.#matching(tx, rows, parties, query.search);
      kept.push(...matching.map((row) => ({ row, ...partyOf(parties, row) })));
      const last = rows.at(-1);
      if (query.search === undefined || kept.length >= wanted || rows.length < window) break;
      if (last === undefined) break;
      after = last.id;
      window += window;
    }
    const page = kept.slice(0, pageSize);
    const names = await this.#store.namesOf(tx, [
      ...new Set(page.flatMap(({ party }) => (party === undefined ? [] : [party.studentUserId]))),
    ]);
    const items = page.map(({ row, party }) => itemOf(row, party, names));
    const lastShown = page.at(-1);
    return kept.length > pageSize && lastShown !== undefined
      ? { items, nextCursor: lastShown.row.id }
      : { items };
  }

  /** The rows a search keeps: an order reference matched exactly, or a student's folded name. */
  async #matching(
    tx: Transaction,
    rows: readonly MonitorOrderRow[],
    parties: ReadonlyMap<string, OrderEnrollmentParty>,
    search: string | undefined,
  ): Promise<readonly MonitorOrderRow[]> {
    if (search === undefined) return rows;
    const students = [
      ...new Set(
        rows.flatMap((row) => {
          const party = parties.get(row.enrollmentId);
          return party === undefined ? [] : [party.studentUserId];
        }),
      ),
    ];
    const named = new Set(await this.#store.namePrefixMatches(tx, students, search));
    return rows.filter((row) => {
      const party = parties.get(row.enrollmentId);
      return (
        row.gatewayOrderId === search || (party !== undefined && named.has(party.studentUserId))
      );
    });
  }

  /** `payments.get`: one order with its enrollment and events (this file's head). */
  async get(tx: Transaction, paymentId: string): Promise<PaymentsGetOutput> {
    const order = await this.#store.orderOf(tx, paymentId);
    if (order === null) throw new DomainError('NOT_FOUND');
    const [events, enrollment, paid] = await Promise.all([
      this.#store.eventsOf(tx, order.id),
      this.#store.enrollmentOf(tx, order.enrollmentId, this.#now()),
      this.#store.paidOrdersOf(tx, order.enrollmentId),
    ]);
    const names =
      enrollment === null
        ? new Map<string, string>()
        : await this.#store.namesOf(tx, [enrollment.studentUserId, enrollment.teacherUserId]);
    const nameOf = (userId: string | undefined) =>
      userId === undefined ? '' : (names.get(userId) ?? '');
    return {
      paymentId: order.id,
      gatewayOrderId: order.gatewayOrderId,
      ...(order.gatewayTransactionId === null
        ? {}
        : { gatewayTransactionId: order.gatewayTransactionId }),
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      gross_piasters: piasters(Number(order.grossPiasters)),
      ...settlementOf(order),
      currency: order.currency,
      student: { displayName: nameOf(enrollment?.studentUserId) },
      ...(enrollment === null
        ? {}
        : {
            enrollment: {
              enrollmentId: enrollment.enrollmentId,
              summary: enrollment.summary,
              teacher: { displayName: nameOf(enrollment.teacherUserId) },
              status: enrollment.status,
              ...(enrollment.cancellationReason === undefined
                ? {}
                : { cancellationReason: enrollment.cancellationReason }),
              completed: enrollment.completed,
              total: enrollment.total,
            },
          }),
      events: events.map(({ eventType, receivedAt }) => ({
        eventType,
        receivedAt: receivedAt.toISOString(),
      })),
      outcomes: (enrollment?.outcomes ?? [])
        .filter(
          ({ paymentId: orderOfOutcome }) => orderOfOutcome === null || orderOfOutcome === order.id,
        )
        .map(({ kind, cancellationReason, occurredAt }) => ({
          kind,
          ...(cancellationReason === null ? {} : { cancellationReason }),
          occurredAt: occurredAt.toISOString(),
        })),
      paidOrders: paid.map((row) => ({
        paymentId: row.id,
        gatewayOrderId: row.gatewayOrderId,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}

function partyOf(
  parties: ReadonlyMap<string, OrderEnrollmentParty>,
  row: MonitorOrderRow,
): { readonly party?: OrderEnrollmentParty } {
  const party = parties.get(row.enrollmentId);
  return party === undefined ? {} : { party };
}

/** A row of the list; a paid order of a cancelled enrollment says so (FR-PAYG-19's refusal). */
function itemOf(
  row: MonitorOrderRow,
  party: OrderEnrollmentParty | undefined,
  names: ReadonlyMap<string, string>,
): PaymentsListItem {
  return {
    paymentId: row.id,
    gatewayOrderId: row.gatewayOrderId,
    createdAt: row.createdAt.toISOString(),
    student: {
      displayName: party === undefined ? '' : (names.get(party.studentUserId) ?? ''),
    },
    gross_piasters: piasters(Number(row.grossPiasters)),
    ...settlementOf(row),
    status: row.status,
    enrollmentCancelled: row.status === 'paid' && party?.status === 'cancelled',
  };
}
