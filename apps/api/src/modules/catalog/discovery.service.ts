// T025 (FR-332 to FR-335, FR-338; research R-204 as amended 2026-11-01, analysis C2;
// app-surface.md "`discovery` — booking's router over catalog's service"): discovery's cards, the
// subject tabs and the riwaya filter's values. The `discovery` router is booking's (T026, T027),
// which composes these with each card's nearest free slot and limits every call by
// `rate_limit_search` (FR-338); this service is read-only and takes no lock.
//
// THE TWO STEPS (R-201, R-204). The predicate and the order's keys (rating, review count, name, id)
// are identity's columns, so catalog never orders by them: it computes the candidate ids its own
// tables allow (a teacher with an active package, of the subject tab and the track when named, in
// one package; with an approved credential of the riwaya when named) and hands them, with the
// name prefix, the minimum rating and the cursor, to identity's `visibleTeacherPage`, which applies
// the predicate with the requester's gender, orders and cuts the page. The cards keep that order.
// One row more than the page is asked for, so a next cursor is written only while more remain.
//
// THE TABS (FR-332, R-GENDER-3; PR #109's review, follow-up 1). On the first page only: per active
// subject, the visible teachers with an active package in it, and for all subjects the visible
// teachers with any active package: the candidate set of the cards with no filter, counted after
// the predicate, so a tab's count is the number of cards its tab lists.
//
// FOLDING (R-203). A riwaya is matched, and the riwaya values deduplicated, by `ijazah_fold`, shown
// as transcribed. The matched length of a name is the longest prefix of the name as stored whose
// fold equals the fold of the query, so the marks after the last matched letter are marked with it;
// counted in UTF-16 units, as the phone slices the name, and never splitting a code point. Both
// folds are the kernel's `foldedTexts`: no second fold is written here.
import {
  type DiscoveryBrowseInput,
  type DiscoveryBrowseOutput,
  type DiscoveryCard,
  type DiscoveryFiltersInput,
  type DiscoveryFiltersOutput,
  type DiscoveryTab,
  type PackageTrack,
  packageTrack,
  type SubjectSummary,
} from '@ijazah/contracts';
import { lowest, perSession, type Piasters, toPlainNumber } from '@ijazah/money';
import { z } from 'zod';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { TeacherPageQuery, VisibilityPurpose, VisibleTeacher } from '../identity/index.js';
import { readCursor, writeCursor } from './discovery-cursor.js';
import type { CardPackage, CardSubject, Offering, RiwayaRow } from './discovery.repository.js';
import type { SubjectRow } from './subjects.repository.js';

export const DISCOVERY_PAGE_SIZE_SETTING = 'discovery_page_size';

const positiveWhole = z.int().positive();

/** The order the riwaya filter lists its values in. */
const riwayaOrder = new Intl.Collator('ar').compare;

/** What discovery reads, each on the caller's transaction: this module's rows and identity's entry. */
export interface DiscoveryStore {
  offerings(tx: Transaction, subjectId?: string): Promise<Offering[]>;
  riwayas(tx: Transaction, subjectId?: string): Promise<RiwayaRow[]>;
  subjectsOf(tx: Transaction, teacherIds: readonly string[]): Promise<CardSubject[]>;
  packagesOf(tx: Transaction, teacherIds: readonly string[]): Promise<CardPackage[]>;
  activeSubjects(tx: Transaction): Promise<SubjectRow[]>;
  /** The kernel's `ijazah_fold` of each text, in order (R-203). */
  fold(tx: Transaction, texts: readonly string[]): Promise<string[]>;
  /** Identity's predicate over `teacherIds` (R-201). */
  visibleTeachers(
    tx: Transaction,
    requester: RequesterGender,
    query: { readonly purpose: VisibilityPurpose; readonly teacherIds: readonly string[] },
  ): Promise<VisibleTeacher[]>;
  /** Identity's ordered page of the visible teachers among the candidates (R-204). */
  visibleTeacherPage(
    tx: Transaction,
    requester: RequesterGender,
    query: TeacherPageQuery,
  ): Promise<VisibleTeacher[]>;
}

/** `discovery.browse` and `discovery.filters` as booking's router calls them (T026). */
export interface DiscoveryCatalog {
  /**
   * The cards of one page, and on the first page the subject tabs; `requester` is the session's
   * gender (R-GENDER-4). No card carries `nearestSlot`, which is booking's (T026), or `photoUrl`.
   */
  browse(
    tx: Transaction,
    requester: RequesterGender,
    input: DiscoveryBrowseInput,
  ): Promise<DiscoveryBrowseOutput>;
  /** The riwaya filter's values for the subject (FR-334). */
  filters(
    tx: Transaction,
    requester: RequesterGender,
    input: DiscoveryFiltersInput,
  ): Promise<DiscoveryFiltersOutput>;
}

export interface DiscoveryServiceDependencies {
  readonly settings: SettingsReader;
  readonly store: DiscoveryStore;
}

/**
 * The bio's first line, as the teacher wrote it: the card shows about two lines (screens.md §4).
 * Cut at the teacher's own line break, not at a length, which would be a limit to read from settings
 * (FR-034, R-MONEY-12).
 */
function excerptOf(bio: string): string {
  return bio.trim().split(/\r?\n/, 1)[0]?.trim() ?? '';
}

/** `items` grouped by `key`, each group in the items' order. */
function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group === undefined) groups.set(key(item), [item]);
    else group.push(item);
  }
  return groups;
}

/** The teachers with an active package of the tab's subject and the track, both in one package. */
function candidatesOf(
  offerings: readonly Offering[],
  input: Pick<DiscoveryBrowseInput, 'subjectId' | 'track'>,
): Set<string> {
  return new Set(
    offerings
      .filter(
        ({ subjectId, track }) =>
          (input.subjectId === undefined || subjectId === input.subjectId) &&
          (input.track === undefined || track === input.track),
      )
      .map(({ teacherUserId }) => teacherUserId),
  );
}

export class DiscoveryService implements DiscoveryCatalog {
  readonly #settings: SettingsReader;
  readonly #store: DiscoveryStore;

  constructor({ settings, store }: DiscoveryServiceDependencies) {
    this.#settings = settings;
    this.#store = store;
  }

  async browse(
    tx: Transaction,
    requester: RequesterGender,
    input: DiscoveryBrowseInput,
  ): Promise<DiscoveryBrowseOutput> {
    const after = input.cursor === undefined ? undefined : readCursor(input.cursor);
    const size = await this.#settings.read(DISCOVERY_PAGE_SIZE_SETTING, positiveWhole);
    const offerings = await this.#store.offerings(tx);
    let candidates = candidatesOf(offerings, input);
    if (input.riwaya !== undefined) {
      candidates = await this.#withRiwaya(tx, candidates, input.subjectId, input.riwaya);
    }
    const rows = await this.#store.visibleTeacherPage(tx, requester, {
      candidateIds: [...candidates],
      ...(input.query === undefined ? {} : { namePrefix: input.query }),
      ...(input.minRating === undefined ? {} : { minRating: input.minRating }),
      ...(after === undefined ? {} : { after }),
      limit: size + 1,
    });
    const page = rows.slice(0, size);
    const [cards, tabs] = await Promise.all([
      this.#cards(tx, page, input.query),
      after === undefined ? this.#tabs(tx, requester, offerings) : undefined,
    ]);
    const last = page.at(-1);
    return {
      ...(tabs === undefined ? {} : { tabs }),
      cards,
      ...(rows.length > size && last !== undefined ? { nextCursor: writeCursor(last) } : {}),
    };
  }

  async filters(
    tx: Transaction,
    requester: RequesterGender,
    { subjectId }: DiscoveryFiltersInput,
  ): Promise<DiscoveryFiltersOutput> {
    const offered = candidatesOf(await this.#store.offerings(tx, subjectId), { subjectId });
    const rows = (await this.#store.riwayas(tx, subjectId)).filter(({ teacherUserId }) =>
      offered.has(teacherUserId),
    );
    const visible = await this.#store.visibleTeachers(tx, requester, {
      purpose: 'discover',
      teacherIds: [...new Set(rows.map(({ teacherUserId }) => teacherUserId))],
    });
    const shown = new Set(visible.map(({ id }) => id));
    const typed = rows.filter(({ teacherUserId }) => shown.has(teacherUserId));
    const folded = await this.#store.fold(
      tx,
      typed.map(({ riwaya }) => riwaya),
    );
    // One value per fold, shown as typed: the first spelling in the list's order.
    const spellings = groupBy(
      typed.map(({ riwaya }, index) => ({ riwaya, fold: folded[index] ?? riwaya })),
      ({ fold }) => fold,
    );
    const riwayas = [...spellings.values()].map(
      (group) => group.map(({ riwaya }) => riwaya).sort(riwayaOrder)[0] ?? '',
    );
    return { riwayas: riwayas.sort(riwayaOrder) };
  }

  /** Of `candidates`, those with an approved credential whose riwaya folds as `riwaya` does. */
  async #withRiwaya(
    tx: Transaction,
    candidates: ReadonlySet<string>,
    subjectId: string | undefined,
    riwaya: string,
  ): Promise<Set<string>> {
    const rows = (await this.#store.riwayas(tx, subjectId)).filter(({ teacherUserId }) =>
      candidates.has(teacherUserId),
    );
    const [wanted, ...folded] = await this.#store.fold(tx, [
      riwaya,
      ...rows.map((row) => row.riwaya),
    ]);
    return new Set(
      rows.filter((_, index) => folded[index] === wanted).map(({ teacherUserId }) => teacherUserId),
    );
  }

  async #tabs(
    tx: Transaction,
    requester: RequesterGender,
    offerings: readonly Offering[],
  ): Promise<DiscoveryTab[]> {
    const [visible, subjects] = await Promise.all([
      this.#store.visibleTeachers(tx, requester, {
        purpose: 'discover',
        teacherIds: [...new Set(offerings.map(({ teacherUserId }) => teacherUserId))],
      }),
      this.#store.activeSubjects(tx),
    ]);
    const shown = new Set(visible.map(({ id }) => id));
    const bySubject = new Map<string, Set<string>>();
    for (const { teacherUserId, subjectId } of offerings) {
      if (!shown.has(teacherUserId)) continue;
      const teachers = bySubject.get(subjectId) ?? new Set<string>();
      teachers.add(teacherUserId);
      bySubject.set(subjectId, teachers);
    }
    return [
      { subjectId: null, count: shown.size },
      ...subjects.map(({ id, nameAr, nameEn }) => ({
        subjectId: id,
        nameAr,
        nameEn,
        count: bySubject.get(id)?.size ?? 0,
      })),
    ];
  }

  async #cards(
    tx: Transaction,
    page: readonly VisibleTeacher[],
    query: string | undefined,
  ): Promise<DiscoveryCard[]> {
    if (page.length === 0) return [];
    const ids = page.map(({ id }) => id);
    const [subjects, packages, matches] = await Promise.all([
      this.#store.subjectsOf(tx, ids),
      this.#store.packagesOf(tx, ids),
      query === undefined
        ? undefined
        : this.#matchedLengths(
            tx,
            page.map(({ displayName }) => displayName),
            query,
          ),
    ]);
    const subjectsBy = groupBy(subjects, ({ teacherUserId }) => teacherUserId);
    const packagesBy = groupBy(packages, ({ teacherUserId }) => teacherUserId);
    return page.flatMap((teacher, index): DiscoveryCard[] => {
      const offered = packagesBy.get(teacher.id) ?? [];
      const [first_piasters, ...rest_piasters] = offered.map(({ price_piasters, sessionCount }) =>
        perSession(price_piasters, sessionCount),
      );
      // Deactivated since the candidates were read: no longer a candidate, so no card.
      if (first_piasters === undefined) return [];
      const lowest_piasters: Piasters = lowest([first_piasters, ...rest_piasters]);
      const tracks = new Set<PackageTrack>(offered.map(({ track }) => track));
      const matched = matches?.[index];
      return [
        {
          teacherId: teacher.id,
          displayName: teacher.displayName,
          ...(matched === undefined ? {} : { match: { length: matched } }),
          subjects: (subjectsBy.get(teacher.id) ?? []).map(
            ({ subject }): SubjectSummary => subject,
          ),
          tracks: packageTrack.options.filter((track) => tracks.has(track)),
          bioExcerpt: excerptOf(teacher.bio),
          ...(teacher.averageRating === null ? {} : { rating: Number(teacher.averageRating) }),
          reviewCount: teacher.reviewCount,
          lowestPerSession_piasters: toPlainNumber(lowest_piasters),
        },
      ];
    });
  }

  /**
   * For each name, the length of its longest prefix whose fold equals the query's, or undefined
   * when none does (a query of marks alone matches every name and marks none).
   */
  async #matchedLengths(
    tx: Transaction,
    names: readonly string[],
    query: string,
  ): Promise<(number | undefined)[]> {
    const prefixes = names.map((name) => {
      const points = Array.from(name);
      return points.map((_, end) => points.slice(0, end + 1).join(''));
    });
    const [wanted, ...folded] = await this.#store.fold(tx, [query, ...prefixes.flat()]);
    if (wanted === undefined || wanted === '') return names.map(() => undefined);
    let offset = 0;
    return prefixes.map((list) => {
      let length: number | undefined;
      list.forEach((prefix, index) => {
        if (folded[offset + index] === wanted) length = prefix.length;
      });
      offset += list.length;
      return length;
    });
  }
}
