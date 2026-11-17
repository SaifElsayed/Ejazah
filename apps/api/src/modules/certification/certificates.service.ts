// T009 of specs/005-certification: the parties' certificates, `certificates.list` and
// `certificates.link` (FR-607, FR-609; research R-412; contracts/app-surface.md, `certificates.*`;
// D1 (a), DEC-72; R-HONEST-6, R-GENDER-2, R-SEC-3). The specs are certificates.service.spec.ts's,
// certificates.repository.spec.ts's and tests/adversarial/certificates.attacks.ts's (registered in
// registered-attacks.ts).
//
// THE PARTIES. An ijazah is read by its two parties only, the student and the granting teacher, the
// caller named by the session and never by the input. Anyone else is answered NOT_FOUND exactly as
// an id that never existed (R-GENDER-2's one shape), before anything of the ijazah's state is told.
//
// LIST: the caller's ijazahs as student or as teacher (a soft-deleted one left out, the
// repository's), newest first; `ready` once an administrator signed it off and it is not revoked;
// `revoked` after a revocation, never `ready` then (R-HONEST-6).
//
// LINK, in this order: not a party (or no such ijazah) NOT_FOUND; revoked CONFLICT `revoked`, with
// no link (D1 (a), DEC-72: the PDF is served to nobody after a revocation, the parties included);
// not signed off CONFLICT `not_ready`; otherwise a signed link to the rendered PDF living
// `document_link_ttl_seconds`, minted after the read's transaction so no transaction waits on the
// storage port; never the storage key (R-SEC-3).
//
// Reads only: no row is written, so no lock is taken (a revocation or a sign-off committed between
// the read and the answer is the next read's). Every refusal is one info line of ids and its reason,
// never a name or a key (R-SEC-2).
import type {
  CertificateItem,
  CertificateLinkRefusal,
  CertificatesLinkInput,
  CertificatesLinkOutput,
  CertificatesListOutput,
  SubjectSummary,
} from '@ijazah/contracts';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import { DOCUMENT_LINK_TTL_SETTING, documentLinkTtl } from '../../platform/settings/keys.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';

/** An ijazah as the parties' reads take it. */
export interface CertificateRow {
  readonly id: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly subjectId: string;
  readonly teacherNamePrinted: string;
  readonly grantedAt: Date;
  readonly signedOffAt: Date | null;
  readonly revokedAt: Date | null;
  readonly certificateStorageKey: string;
}

/** What the parties' reads ask, each on the call's transaction. */
export interface CertificatesStore {
  /** The ijazahs whose student or teacher is `userId`, a soft-deleted one left out, newest first. */
  ofParty(tx: Transaction, userId: string): Promise<readonly CertificateRow[]>;
  /** The ijazah by its id, a soft-deleted one left out; null otherwise. */
  byId(tx: Transaction, ijazahId: string): Promise<CertificateRow | null>;
  /** The subjects' names (catalog's `subjectSummariesOf`). */
  subjectsOf(
    tx: Transaction,
    subjectIds: readonly string[],
  ): Promise<ReadonlyMap<string, SubjectSummary>>;
}

/** The lines the parties' reads write: ids and a reason. */
export interface CertificatesLog {
  info(fields: Readonly<Record<string, unknown>>, message: string): void;
}

export interface CertificatesDependencies {
  readonly transactions: Transactions;
  readonly store: CertificatesStore;
  readonly storage: Pick<StoragePort, 'temporaryLink'>;
  readonly settings: SettingsReader;
  readonly log: CertificatesLog;
}

type LinkIds = { readonly userId: string; readonly ijazahId: string };

export class CertificatesService {
  readonly #dependencies: CertificatesDependencies;

  constructor(dependencies: CertificatesDependencies) {
    this.#dependencies = dependencies;
  }

  /** `certificates.list`: the caller's ijazahs as student or as granting teacher. */
  async list(userId: string): Promise<CertificatesListOutput> {
    const { transactions, store } = this.#dependencies;
    const { rows, subjects } = await transactions.run(async (tx) => {
      const rows = await store.ofParty(tx, userId);
      const subjects = await store.subjectsOf(tx, [...new Set(rows.map((r) => r.subjectId))]);
      return { rows, subjects };
    });
    return { items: rows.map((row) => itemOf(row, subjects)) };
  }

  /** `certificates.link`: a signed link to a signed-off, unrevoked certificate, for a party. */
  async link(userId: string, { ijazahId }: CertificatesLinkInput): Promise<CertificatesLinkOutput> {
    const { transactions, store, storage, settings, log } = this.#dependencies;
    const ids: LinkIds = { userId, ijazahId };
    const ttl = await settings.read(DOCUMENT_LINK_TTL_SETTING, documentLinkTtl);
    const key = await transactions.run(async (tx) => {
      const row = await store.byId(tx, ijazahId);
      if (row === null) throw this.#notFound(ids, 'not_found');
      if (row.studentUserId !== userId && row.teacherUserId !== userId) {
        throw this.#notFound(ids, 'not_a_party');
      }
      if (row.revokedAt !== null) throw this.#refused(ids, 'revoked');
      if (row.signedOffAt === null) throw this.#refused(ids, 'not_ready');
      return row.certificateStorageKey;
    });
    const link = await storage.temporaryLink(key, ttl);
    log.info({ ...ids, reason: 'link_issued' }, 'A certificate link was issued to a party');
    return { link };
  }

  #notFound(ids: LinkIds, reason: 'not_found' | 'not_a_party'): DomainError {
    this.#dependencies.log.info({ ...ids, reason }, 'A certificate link was refused');
    return markRefusalLogged(new DomainError('NOT_FOUND'));
  }

  #refused(ids: LinkIds, reason: CertificateLinkRefusal): DomainError {
    this.#dependencies.log.info({ ...ids, reason }, 'A certificate link was refused');
    return markRefusalLogged(
      new DomainError('CONFLICT', undefined, { details: [{ path: 'ijazahId', code: reason }] }),
    );
  }
}

/** One ijazah as a party reads it: ready only signed off and unrevoked (R-HONEST-6). */
function itemOf(
  row: CertificateRow,
  subjects: ReadonlyMap<string, SubjectSummary>,
): CertificateItem {
  const subject = subjects.get(row.subjectId);
  // The FK holds the subject; a missing one is a broken read, never a row to hide.
  if (subject === undefined) throw new Error('certificate: a subject the catalog does not answer');
  const revoked = row.revokedAt !== null;
  return {
    ijazahId: row.id,
    subject,
    teacherName: row.teacherNamePrinted,
    issuedAt: row.grantedAt.toISOString(),
    revoked,
    ready: !revoked && row.signedOffAt !== null,
  };
}
