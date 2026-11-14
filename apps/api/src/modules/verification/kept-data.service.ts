// T077 of specs/004-sessions/tasks.md (FR-509; SRS FR-ADMIN-21, DEC-67; ADR 0015 as amended; the note
// under T077, Q-R3 (a), Q-R4 (a), Q-R5 (a), Q-R13 (a), N3; contracts/kernel.md, the kept data's row;
// research R-323, P3-38 and P3-39): an administrator's control of what a deleted teacher once
// approved keeps (T076), `teachers.keptData.*` on the call's transaction, and the reads `users.get`
// answers. Verification's, since the documents are its table; the profile is read and written
// through identity's entry (R-121: verification imports identity, never the reverse).
//
// THE LOCKS (`003:T005`'s rules, the head of `platform/db/row-lock.ts`). Each action takes the
// profile's row (identity's `lockApplication`, `lockRows('teacher_profiles', …)`), then its kept
// documents' rows in id order (`lockRows('verification_documents', …)`, Q-R4 (a)), then reads the
// profile (`kept_erase_at`, `kept_erased_at`) and the documents again under them (rule 1), and only
// then decides. Every writer of a kept document or profile takes the same two locks first (this
// service and the `erase-kept-data` sweep), so a race between them is serialised on the profile. No
// `users` row is locked or referenced by any row written.
//
// THE REFUSALS (Q-R5 (a), Q-R13 (a)), each writing nothing, in one info line of ids and its cause
// (precedent `sessions/complaint-decision.service.ts`), never a document key or a payout value: a
// person who is not a deleted teacher ever approved (no profile with `kept_at`) `NOT_FOUND`
// `not_kept`; an erased profile, `documentLink` included, `CONFLICT` `already_erased`; a document
// not kept for that teacher `NOT_FOUND` `document_not_kept`; an erasure date less than
// `ERASE_DATE_MIN_HOURS_AHEAD` ahead of the database's clock `CONFLICT` `erase_date_too_soon`; a
// zone `packages/time` does not know `VALIDATION_FAILED` `unknown_zone`.
//
// THE DATE (Q-K1 (a), the review session, 2026-11-14: R-TIME-6 over the line's `eraseAt: string`;
// precedent `outages.record`). The administrator sends a local date and time with its IANA zone;
// `packages/time` resolves it to the instant `kept_erase_at` holds (a time inside a clock change's
// gap moves past it, one inside an overlap takes the earlier instant, R-TIME-7), and the 24 hours
// are judged on that instant against `clockTimestamp`, never a client's clock.
//
// THE ERASURE ⚠️ final (now, or by the daily sweep once `kept_erase_at` passed): the payout columns
// blanked and `kept_erased_at` set (identity's `eraseKeptProfile`); each kept document in one update,
// `kept_at` NULL and `erased_at` now together (rule 34), its key left, so `erase-deleted-files`
// removes the file, waiting on an open matter as it does today; the payout reference goes at once,
// even during an open matter. One info line `{ userId, reason, documents, payout }`.
//
// THE KEYS. `setEraseDate` and `eraseNow` are keyed through the kernel's `runOn` on the call's
// transaction, the scope their path; a replay answers the first outcome and runs nothing.
import { KEPT_ERASE_DATE_MIN_HOURS_AHEAD, type UserKeptData } from '@ijazah/contracts/admin';
import { addHours, addSeconds, resolveLocalDateTime, TimeError } from '@ijazah/time';

import type { ColumnCipher } from '../../platform/crypto/encryption.js';
import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import { DOCUMENT_LINK_TTL_SETTING, documentLinkTtl } from '../../platform/settings/keys.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  eraseKeptProfile,
  type KeptProfile,
  keptProfileOf,
  keptProfilesDue,
  lockApplication,
  payoutKeptOnDeletedTeacher,
  setKeptEraseDate,
} from '../identity/index.js';
import {
  DOCUMENT_STORAGE_KEY_COLUMN,
  eraseKeptDocuments,
  type KeptDocument,
  keptDocumentsOf,
  lockKeptDocuments,
} from './verification.repository.js';

/**
 * How far ahead an erasure date must be, in hours: the contract's bound, which spec FR-509 and
 * T077's line fix («`eraseAt` at least 24 h ahead»; T053's settings gate covers sessions and chat
 * only, the note under T077, Q-R5 (a)).
 */
export const ERASE_DATE_MIN_HOURS_AHEAD = KEPT_ERASE_DATE_MIN_HOURS_AHEAD;

/** What the service and the sweep read, lock and write, each on the caller's transaction; faked in a spec. */
export interface KeptDataStore {
  lockProfile(tx: Transaction, userId: string): Promise<void>;
  profileOf(tx: Transaction, userId: string): Promise<KeptProfile | null>;
  documentsOf(tx: Transaction, userId: string): Promise<readonly KeptDocument[]>;
  lockDocuments(tx: Transaction, ids: readonly string[]): Promise<void>;
  setEraseDate(tx: Transaction, profileId: string, at: Date | null): Promise<boolean>;
  eraseProfile(tx: Transaction, profileId: string, at: Date): Promise<boolean>;
  eraseDocuments(tx: Transaction, ids: readonly string[], at: Date): Promise<number>;
  duePage(
    tx: Transaction,
    now: Date,
    after: string | undefined,
    limit: number,
  ): Promise<readonly { readonly profileId: string; readonly userId: string }[]>;
  payoutKeptOnDeletedTeacher(tx: Transaction, userId: string): Promise<boolean>;
}

/** The store over identity's entry, verification's rows and the kernel's lock (R-API-6). */
export const keptDataStore: KeptDataStore = {
  lockProfile: lockApplication,
  profileOf: keptProfileOf,
  documentsOf: keptDocumentsOf,
  lockDocuments: lockKeptDocuments,
  setEraseDate: setKeptEraseDate,
  eraseProfile: eraseKeptProfile,
  eraseDocuments: eraseKeptDocuments,
  duePage: keptProfilesDue,
  payoutKeptOnDeletedTeacher,
};

/** The kept profile and its kept documents, read again under their locks. */
export interface HeldKeptData {
  readonly profile: KeptProfile | null;
  readonly documents: readonly KeptDocument[];
}

/**
 * Takes the profile's lock, then its kept documents' in id order, and reads both again under them
 * (the head's «THE LOCKS»). The documents' ids are read before their lock; a document becomes kept
 * only in a deletion, which has committed for any profile holding `kept_at`.
 */
export async function holdKeptData(
  store: KeptDataStore,
  tx: Transaction,
  userId: string,
): Promise<HeldKeptData> {
  await store.lockProfile(tx, userId);
  const ids = (await store.documentsOf(tx, userId)).map(({ id }) => id);
  await store.lockDocuments(tx, ids);
  const profile = await store.profileOf(tx, userId);
  const documents = await store.documentsOf(tx, userId);
  return { profile, documents };
}

/** What an erasure did: how many documents it erased, and whether a payout reference went. */
export interface KeptErasure {
  readonly documents: number;
  readonly payout: boolean;
}

/** The erasure of a held profile, kept and not yet erased (the head's «THE ERASURE»). */
export async function eraseHeldKeptData(
  store: KeptDataStore,
  tx: Transaction,
  {
    profile,
    documents,
  }: { readonly profile: KeptProfile; readonly documents: readonly KeptDocument[] },
  at: Date,
): Promise<KeptErasure> {
  const erased = await store.eraseDocuments(
    tx,
    documents.map(({ id }) => id),
    at,
  );
  await store.eraseProfile(tx, profile.profileId, at);
  return { documents: erased, payout: profile.payoutKept };
}

type RefusalCause =
  'not_kept' | 'already_erased' | 'document_not_kept' | 'erase_date_too_soon' | 'unknown_zone';

const NOT_FOUND_CAUSES: ReadonlySet<RefusalCause> = new Set(['not_kept', 'document_not_kept']);

/** A local date and time with its IANA zone, as the administrator enters an erasure date. */
export interface KeptEraseWallClock {
  readonly localDate: string;
  /** `HH:MM`. */
  readonly localTime: string;
  readonly timezone: string;
}

export interface KeptDataDependencies {
  readonly storage: Pick<StoragePort, 'temporaryLink'>;
  readonly cipher: Pick<ColumnCipher, 'decrypt'>;
  readonly settings: SettingsReader;
  /** The refusals' and the erasure's lines: ids and a reason only. */
  readonly log: Pick<Logger, 'info'>;
  /** The kernel's idempotency, keyed on the call's transaction (`runOn`). */
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'runOn'>;
  /** The database's clock on the transaction (`clockTimestamp`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: KeptDataStore;
}

export interface KeptDataLinkInput {
  readonly teacherUserId: string;
  readonly documentId: string;
}

export interface KeptDataEraseDateInput {
  readonly teacherUserId: string;
  readonly eraseAt: KeptEraseWallClock | null;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface KeptDataEraseNowInput {
  readonly teacherUserId: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}

/** The erasure date before and after a change, as instants (null for none). */
export interface KeptEraseDateChange {
  readonly before: string | null;
  readonly after: string | null;
}

export interface KeptData {
  /** `teachers.keptData.documentLink`: one signed link per press. */
  documentLink(
    tx: Transaction,
    adminId: string,
    input: KeptDataLinkInput,
  ): Promise<{ readonly url: string; readonly expiresAt: string }>;
  /** `teachers.keptData.setEraseDate`: set, change or clear. */
  setEraseDate(
    tx: Transaction,
    adminId: string,
    input: KeptDataEraseDateInput,
  ): Promise<KeptEraseDateChange & { readonly replayed: boolean }>;
  /** `teachers.keptData.eraseNow` ⚠️ final. */
  eraseNow(
    tx: Transaction,
    adminId: string,
    input: KeptDataEraseNowInput,
  ): Promise<KeptErasure & { readonly replayed: boolean }>;
  /** `users.get`'s `keptData` for a deleted teacher, read with no lock. */
  keptDataOf(tx: Transaction, userId: string): Promise<UserKeptData>;
  /** `users.get`'s `payoutKeptOnDeletedTeacher` for a live teacher, read with no lock. */
  payoutKeptOnDeletedTeacher(tx: Transaction, userId: string): Promise<boolean>;
}

/** `users.get`'s two reads, which need no dependency beyond the store. */
export type KeptDataReads = Pick<KeptData, 'keptDataOf' | 'payoutKeptOnDeletedTeacher'>;

const instantOf = (at: Date | null): string | null => (at === null ? null : at.toISOString());

/** `users.get`'s two reads over the store, with no lock and nothing written. */
export function keptDataReads(store: KeptDataStore = keptDataStore): KeptDataReads {
  return {
    keptDataOf: async (tx, userId) => {
      const [profile, documents] = await Promise.all([
        store.profileOf(tx, userId),
        store.documentsOf(tx, userId),
      ]);
      return {
        documents: documents.map(({ id, documentType, uploadedAt }) => ({
          id,
          kind: documentType,
          uploadedAt: uploadedAt.toISOString(),
        })),
        payoutKept: profile !== null && profile.erasedAt === null && profile.payoutKept,
        eraseAt: instantOf(profile?.eraseAt ?? null),
        erasedAt: instantOf(profile?.erasedAt ?? null),
      };
    },
    payoutKeptOnDeletedTeacher: (tx, userId) => store.payoutKeptOnDeletedTeacher(tx, userId),
  };
}

export function createKeptData({
  storage,
  cipher,
  settings,
  log,
  idempotency,
  clock = clockTimestamp,
  store = keptDataStore,
}: KeptDataDependencies): KeptData {
  /** Logs the refusal with ids and its cause, and answers the error to throw, marked «logged». */
  const refusal = (
    ids: { readonly adminId: string; readonly userId: string; readonly documentId?: string },
    cause: RefusalCause,
  ): DomainError => {
    const errorCode =
      cause === 'unknown_zone'
        ? 'VALIDATION_FAILED'
        : NOT_FOUND_CAUSES.has(cause)
          ? 'NOT_FOUND'
          : 'CONFLICT';
    log.info({ ...ids, errorCode, cause }, 'A kept data action was refused');
    return markRefusalLogged(
      errorCode === 'CONFLICT'
        ? new DomainError(errorCode, undefined, { details: [{ path: 'cause', code: cause }] })
        : errorCode === 'VALIDATION_FAILED'
          ? new DomainError(errorCode, undefined, {
              details: [{ path: 'eraseAt.timezone', code: 'unknown' }],
            })
          : new DomainError(errorCode),
    );
  };

  /** The wall clock's instant through `packages/time` (R-TIME-6, R-TIME-7); a refusal for an unknown zone. */
  const instantOfWallClock = (
    ids: { readonly adminId: string; readonly userId: string },
    { localDate, localTime, timezone }: KeptEraseWallClock,
  ): Date => {
    try {
      return new Date(
        resolveLocalDateTime({ localDate, localTime: `${localTime}:00`, timezone }).startsAt,
      );
    } catch (error: unknown) {
      if (!(error instanceof TimeError)) throw error;
      throw refusal(ids, 'unknown_zone');
    }
  };

  /** The held data of a kept profile not yet erased; a refusal otherwise. */
  const heldLive = async (
    tx: Transaction,
    ids: { readonly adminId: string; readonly userId: string; readonly documentId?: string },
  ): Promise<{ readonly profile: KeptProfile; readonly documents: readonly KeptDocument[] }> => {
    const { profile, documents } = await holdKeptData(store, tx, ids.userId);
    if (profile === null) throw refusal(ids, 'not_kept');
    if (profile.erasedAt !== null) throw refusal(ids, 'already_erased');
    return { profile, documents };
  };

  return {
    documentLink: async (tx, adminId, { teacherUserId, documentId }) => {
      const ids = { adminId, userId: teacherUserId, documentId };
      const { documents } = await heldLive(tx, ids);
      const document = documents.find(({ id }) => id === documentId);
      if (document === undefined) throw refusal(ids, 'document_not_kept');
      const key = cipher.decrypt(
        document.storageKeyEncrypted,
        DOCUMENT_STORAGE_KEY_COLUMN,
        document.id,
      );
      const ttl = await settings.read(DOCUMENT_LINK_TTL_SETTING, documentLinkTtl);
      const url = await storage.temporaryLink(key, ttl);
      return { url, expiresAt: addSeconds(await clock(tx), ttl) };
    },

    setEraseDate: async (tx, adminId, { teacherUserId, eraseAt, reason, idempotencyKey }) => {
      const { outcome, replayed } = await idempotency.runOn(
        tx,
        {
          scope: 'teachers.keptData.setEraseDate',
          key: idempotencyKey,
          actorId: adminId,
          input: { teacherUserId, eraseAt, reason },
        },
        async (keyed): Promise<{ before: string | null; after: string | null }> => {
          const ids = { adminId, userId: teacherUserId };
          const { profile } = await heldLive(keyed, ids);
          const at = eraseAt === null ? null : instantOfWallClock(ids, eraseAt);
          if (at !== null) {
            const earliest = Date.parse(addHours(await clock(keyed), ERASE_DATE_MIN_HOURS_AHEAD));
            if (at.getTime() < earliest) throw refusal(ids, 'erase_date_too_soon');
          }
          await store.setEraseDate(keyed, profile.profileId, at);
          return { before: instantOf(profile.eraseAt), after: instantOf(at) };
        },
      );
      return { ...outcome, replayed };
    },

    eraseNow: async (tx, adminId, { teacherUserId, reason, idempotencyKey }) => {
      const { outcome, replayed } = await idempotency.runOn(
        tx,
        {
          scope: 'teachers.keptData.eraseNow',
          key: idempotencyKey,
          actorId: adminId,
          input: { teacherUserId, reason },
        },
        async (keyed): Promise<{ documents: number; payout: boolean }> => {
          const held = await heldLive(keyed, { adminId, userId: teacherUserId });
          const erasure = await eraseHeldKeptData(store, keyed, held, await clock(keyed));
          log.info(
            { userId: teacherUserId, reason: 'erase_now', ...erasure },
            'A deleted teacher’s kept data was erased',
          );
          return { ...erasure };
        },
      );
      return { ...outcome, replayed };
    },

    ...keptDataReads(store),
  };
}
