// T065, T067 (FR-176, FR-180, FR-181): the audit log as the admin pages read it, `audit.list`,
// `audit.get` and the home's latest actions. Each row carries the label the writer stored and,
// beside it, the target's name resolved now (`labels/target-name.ts`): the role word for a deleted
// person, nothing for a type that names no person. Reads are audited like writes (FR-049) under
// actions ending in `.read`, which no list shows; nothing else is left out (owner's decision
// 2026-10-21). The search matches the stored label and the reason, in any case, as the text typed.
// The date bounds are calendar days in the zone the panel names, both included, turned into instants
// by `@ijazah/time` (R-TIME-1, R-TIME-6).
//
// Everything runs on the administrator kind's transaction (`tx`), so the read and the call's own
// audit entry are one unit.
import type { auditGetOutput } from '@ijazah/contracts/admin';
import { endOfLocalDay, startOfLocalDay } from '@ijazah/time';
import { z } from 'zod';

import { DomainError } from '../../platform/errors/domain-error.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { type AuditEntryRow, type AuditFilter, AuditRepository } from './audit.repository.js';
import { type AuditTargetType, isAuditTargetType } from './labels/target-label.js';
import { resolveTargetName, type TargetNameReaders } from './labels/target-name.js';

export const LIST_PAGE_SIZE_SETTING = 'admin_list_page_size';

/**
 * A stored snapshot as the contract answers it. Prisma types a JSON object's members as possibly
 * undefined, which a stored row never holds, so the value read is the contract's JSON as it is.
 */
type Snapshot = NonNullable<z.input<typeof auditGetOutput>['before']>;

const positiveWhole = z.int().positive();

/** One entry as `audit.list` and the home answer it. */
export interface AuditListRow {
  readonly entryId: string;
  readonly occurredAt: string;
  readonly adminName: string;
  readonly action: string;
  readonly targetLabel: string;
  readonly targetName?: string;
  readonly targetType: AuditTargetType;
  readonly targetId: string;
  readonly reason?: string;
}

export interface AuditQuery {
  readonly search?: string | undefined;
  readonly targetType?: AuditTargetType | undefined;
  readonly targetId?: string | undefined;
  /** The first calendar day shown, in `timeZone`. */
  readonly from?: string | undefined;
  /** The last calendar day shown, in `timeZone`. */
  readonly to?: string | undefined;
  readonly timeZone?: string | undefined;
  readonly page: number;
}

export interface AuditQueryDependencies {
  readonly settings: SettingsReader;
  /** Where the names are read; the real readers unless a spec hands in its own. */
  readonly names?: TargetNameReaders;
}

export class AuditQueryService {
  readonly #entries = new AuditRepository();
  readonly #settings: SettingsReader;
  readonly #names: TargetNameReaders | undefined;

  constructor(dependencies: AuditQueryDependencies) {
    this.#settings = dependencies.settings;
    this.#names = dependencies.names;
  }

  /** `audit.list`: one page of the entries, newest first, and how many there are. */
  async list(
    tx: Transaction,
    query: AuditQuery,
  ): Promise<{ readonly rows: AuditListRow[]; readonly total: number }> {
    const size = await this.#settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole);
    const filter = filterOf(query);
    const [entries, total] = await Promise.all([
      this.#entries.page(tx, filter, (query.page - 1) * size, size),
      this.#entries.count(tx, filter),
    ]);
    return { rows: await this.#rowsOf(tx, entries), total };
  }

  /** The newest `count` entries, for the home (T065). */
  async latest(tx: Transaction, count: number): Promise<AuditListRow[]> {
    return this.#rowsOf(tx, await this.#entries.page(tx, {}, 0, count));
  }

  /** `audit.get`: one entry with the snapshots as stored. */
  async get(tx: Transaction, entryId: string) {
    const entry = await this.#entries.entry(tx, entryId);
    if (entry === null) throw new DomainError('NOT_FOUND');
    const [row] = await this.#rowsOf(tx, [entry]);
    if (row === undefined) throw new DomainError('NOT_FOUND');
    return {
      ...row,
      ...(entry.before === null ? {} : { before: entry.before as Snapshot }),
      ...(entry.after === null ? {} : { after: entry.after as Snapshot }),
    };
  }

  /** The rows of `entries`, each target's name read now, one after another on the one transaction. */
  async #rowsOf(tx: Transaction, entries: readonly AuditEntryRow[]): Promise<AuditListRow[]> {
    const rows: AuditListRow[] = [];
    for (const entry of entries) {
      // The writer refuses an unknown type (T021), so every stored row names a known one.
      if (!isAuditTargetType(entry.targetType)) continue;
      const name = await resolveTargetName(tx, entry.targetType, entry.targetId, this.#names);
      rows.push({
        entryId: entry.id,
        occurredAt: entry.occurredAt.toISOString(),
        adminName: entry.admin.displayName,
        action: entry.action,
        targetLabel: entry.targetLabel,
        ...(name === null ? {} : { targetName: name }),
        targetType: entry.targetType,
        targetId: entry.targetId,
        ...(entry.reason === null ? {} : { reason: entry.reason }),
      });
    }
    return rows;
  }
}

function filterOf(query: AuditQuery): AuditFilter {
  // The schema requires the zone with either bound; a call without one shows every day.
  const zone = query.timeZone;
  return {
    ...(query.search === undefined ? {} : { search: query.search }),
    ...(query.targetType === undefined ? {} : { targetType: query.targetType }),
    ...(query.targetId === undefined ? {} : { targetId: query.targetId }),
    ...(query.from === undefined || zone === undefined
      ? {}
      : { from: new Date(startOfLocalDay(query.from, zone)) }),
    ...(query.to === undefined || zone === undefined
      ? {}
      : { until: new Date(endOfLocalDay(query.to, zone)) }),
  };
}
