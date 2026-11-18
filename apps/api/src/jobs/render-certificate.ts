// T008 of specs/005-certification (FR-606; FR-IJAZAH-2, FR-IJAZAH-11; R-401, R-402; contracts/jobs.md;
// B46 Q6 (a), Q8 (a), Q-B1 (a)): `render-certificate { ijazahId, generation }`, enqueued after the
// commit that issues an ijazah (T007, generation 0) or asks for a re-render (T032), under the job id
// of the ijazah and the generation. It renders outside any request (R-API-13).
//
// ONE DELIVERY.
//   1. The ijazah's render source is read through certification's entry. An unknown or deleted
//      ijazah, an older generation than the row's, or a generation already rendered is skipped with a
//      line of ids and a reason: nothing is rendered or written.
//   2. ⚠️ A request with no signature copy is refused, `signature_missing`, logged by the ijazah's and
//      the request's ids only, and the ijazah stays unrendered and visible as such; the
//      administrator's fix is to revoke it (the owner's decision of 2026-11-17). It is not retried.
//   3. A missing `TYPST_BIN` fails the delivery into the queue's retries, never a request (R-401).
//   4. The case is built: the printed names, riwaya and tariq from the ijazah's own columns (T006's
//      freeze), the chain as frozen, both parties' declared genders through identity's entry and the
//      subject's names through catalog's (read at render: a re-render follows a corrected gender), the
//      completion date and the issue date in Hijri (Umm al-Qura) and Gregorian, the issue date's day
//      in the teacher's account zone (the owner's approved text, point 1), all formatted here.
//   5. The signature copy is read through the storage port, the PDF rendered through the kernel's
//      Typst runner under its timeout, and put under the generation's own key,
//      `certificates/<ijazahId>/<generation>.pdf` (Q6 (a)), before any transaction.
//   6. On one transaction, under the ijazah's row lock, certification records the key and
//      `rendered_at` only when the generation is still the row's (`markRendered`).
//   7. After the commit: ⚠️ automatic, the previous generation's PDF is removed once a newer one is
//      recorded; a render that lost to a newer generation removes its own file, never the newer one
//      the row names. A failed removal is logged by ids and left (the orphan sweep after 11/27).
//
// IDEMPOTENT (R-API-14): a second delivery finds the generation rendered and does nothing; a
// redelivery racing the first records once, since the mark compares under the lock.
//
// LOGS carry ids, generations and a reason; never a name, the chain, a key or a path (R-SEC-2).
import { dateColumnOf, localDateIn } from '@ijazah/time';
import { z } from 'zod';

import { subjectSummariesOf } from '../modules/catalog/index.js';
import {
  type CertificateCase,
  type CertificateGender,
  type CertificateLanguage,
  type MarkOutcome,
  markRendered,
  type PrintedDate,
  type RenderedMark,
  renderCertificatePdf,
  type RenderSource,
  renderSourceOf,
} from '../modules/certification/index.js';
import { accountTimezone, sessionPartiesOf } from '../modules/identity/index.js';
import type { Database } from '../platform/db/prisma.repository.js';
import type { StoragePort } from '../platform/ports/storage/storage.port.js';
import { runTypst, type TypstRunner } from '../platform/typst/run-typst.js';
import { defineJob, type Job } from './job.js';

/** The job's name, the one the issue (T007) and the re-render (T032) enqueue it by. */
export const RENDER_CERTIFICATE = 'render-certificate';

/** The payload: identifiers only, each a string (job.ts); the generation as a decimal. */
export function renderCertificatePayload(
  ijazahId: string,
  generation: number,
): { readonly ijazahId: string; readonly generation: string } {
  return { ijazahId, generation: String(generation) };
}

/** `TYPST_BIN` is not set: the delivery fails into the queue's retries (R-401). */
export class TypstNotConfigured extends Error {
  constructor() {
    super('TYPST_BIN is not set; the certificate cannot be rendered.');
    this.name = 'TypstNotConfigured';
  }
}

/** The ijazah's frozen data cannot be printed as stored. */
export class UnprintableIjazah extends Error {
  constructor(field: 'chain' | 'completion_date') {
    super(`The ijazah's ${field} cannot be printed as stored.`);
    this.name = 'UnprintableIjazah';
  }
}

/** What the job reads and records, each through its owner's entry; `certificateRenderSteps` binds them. */
export interface CertificateRenderSteps {
  source(ijazahId: string): Promise<RenderSource | null>;
  /** The declared gender of each account read; a deleted one is absent. */
  genders(userIds: readonly string[]): Promise<ReadonlyMap<string, CertificateGender>>;
  /** The account's IANA zone; null for a deleted one. */
  timezoneOf(userId: string): Promise<string | null>;
  subjectOf(
    subjectId: string,
  ): Promise<{ readonly nameAr: string; readonly nameEn: string } | null>;
  /** Records the rendered PDF on its own transaction, under the ijazah's lock. */
  mark(mark: RenderedMark): Promise<MarkOutcome>;
}

/** The steps over the modules' entries, the mark on one transaction of `database`. */
export function certificateRenderSteps(database: Database): CertificateRenderSteps {
  return {
    source: (ijazahId) => renderSourceOf(database, ijazahId),
    genders: async (userIds) => {
      const parties = await sessionPartiesOf(database, userIds);
      return new Map([...parties].map(([id, party]) => [id, party.gender] as const));
    },
    timezoneOf: (userId) => accountTimezone(database, userId),
    subjectOf: async (subjectId) => {
      const subject = (await subjectSummariesOf(database, [subjectId])).get(subjectId);
      return subject === undefined ? null : { nameAr: subject.nameAr, nameEn: subject.nameEn };
    },
    mark: (mark) => database.$transaction((tx) => markRendered(tx, mark)),
  };
}

/** Where the job tells what it skipped, refused and removed: ids, generations and a reason. */
export interface RenderLog {
  info(fields: Readonly<Record<string, unknown>>, message: string): void;
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

export interface RenderCertificateOptions {
  readonly steps: CertificateRenderSteps;
  readonly storage: Pick<StoragePort, 'read' | 'put' | 'remove'>;
  /** `TYPST_BIN`; undefined fails every delivery into its retries. */
  readonly typstBin: string | undefined;
  /** The kernel's runner unless a spec hands in a stand-in. */
  readonly run?: TypstRunner;
  readonly log: RenderLog;
  readonly clock?: () => Date;
}

const PDF_TYPE = 'application/pdf';

/** The generation's own key (Q6 (a)). */
function certificateKey(ijazahId: string, generation: number): string {
  return `certificates/${ijazahId}/${String(generation)}.pdf`;
}

const chainSchema = z.array(z.array(z.string().min(1)).min(1)).min(1);

const LOCALES: Readonly<Record<CertificateLanguage, { hijri: string; gregorian: string }>> = {
  ar: { hijri: 'ar-SA-u-ca-islamic-umalqura-nu-arab', gregorian: 'ar-EG-u-ca-gregory-nu-arab' },
  en: { hijri: 'en-GB-u-ca-islamic-umalqura', gregorian: 'en-GB-u-ca-gregory' },
};

/**
 * A calendar day, held as a date column holds it (midnight UTC), in both calendars and the
 * certificate's language. The day is read in UTC, so no zone moves it (R-TIME-6).
 */
export function printedDate(day: Date, language: CertificateLanguage): PrintedDate {
  const format = (locale: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(day);
  return { hijri: format(LOCALES[language].hijri), gregorian: format(LOCALES[language].gregorian) };
}

function printedCount(count: number, language: CertificateLanguage): string {
  return new Intl.NumberFormat(language === 'ar' ? 'ar-EG-u-nu-arab' : 'en-GB').format(count);
}

type CaseRefusal = 'party_missing' | 'subject_missing';

export function renderCertificate({
  steps,
  storage,
  typstBin,
  run = runTypst,
  log,
  clock = () => new Date(),
}: RenderCertificateOptions): Job {
  const skip = (fields: Readonly<Record<string, unknown>>): void => {
    log.info(fields, 'A certificate render was skipped');
  };

  async function removeAfterCommit(
    ijazahId: string,
    generation: number,
    key: string,
    reason: string,
  ): Promise<void> {
    try {
      await storage.remove(key);
    } catch (error: unknown) {
      log.warn(
        { ijazahId, generation, reason, errorName: error instanceof Error ? error.name : 'unknown' },
        'A certificate file could not be removed; left for the orphan sweep',
      );
    }
  }

  async function caseOf(
    source: RenderSource,
  ): Promise<Omit<CertificateCase, 'signatureFile'> | CaseRefusal> {
    const [genders, zone, subject] = await Promise.all([
      steps.genders([source.teacherUserId, source.studentUserId]),
      steps.timezoneOf(source.teacherUserId),
      steps.subjectOf(source.subjectId),
    ]);
    const teacherGender = genders.get(source.teacherUserId);
    const studentGender = genders.get(source.studentUserId);
    if (teacherGender === undefined || studentGender === undefined || zone === null) {
      return 'party_missing';
    }
    if (subject === null) return 'subject_missing';
    const chain = chainSchema.safeParse(source.chainSnapshot);
    if (!chain.success) throw new UnprintableIjazah('chain');
    if (source.completionDate === null) throw new UnprintableIjazah('completion_date');
    const { language } = source;
    return {
      language,
      teacherGender,
      studentGender,
      studentName: source.studentNamePrinted,
      teacherName: source.teacherNamePrinted,
      subjectName: language === 'ar' ? subject.nameAr : subject.nameEn,
      riwaya: source.riwayaPrinted,
      tariq: source.tariqPrinted,
      generations: chain.data,
      generationCount: printedCount(chain.data.length, language),
      completionDate: printedDate(source.completionDate, language),
      issueDate: printedDate(dateColumnOf(localDateIn(source.grantedAt, zone)), language),
      certificateNumber: source.certificateNumber,
    };
  }

  return defineJob({
    name: RENDER_CERTIFICATE,
    payload: z.object({ ijazahId: z.uuid(), generation: z.string().regex(/^(0|[1-9]\d{0,8})$/) }),
    run: async (payload) => {
      const { ijazahId } = payload;
      const generation = Number(payload.generation);
      const source = await steps.source(ijazahId);
      if (source === null) return skip({ ijazahId, generation, reason: 'not_found' });
      if (source.renderGeneration !== generation) {
        return skip({
          ijazahId,
          generation,
          currentGeneration: source.renderGeneration,
          reason: 'stale_generation',
        });
      }
      if (source.renderedAt !== null) {
        return skip({ ijazahId, generation, reason: 'already_rendered' });
      }
      if (source.signatureStorageKey === null) {
        log.warn(
          { ijazahId, requestId: source.requestId, reason: 'signature_missing' },
          'A certificate render was refused',
        );
        return;
      }
      if (typstBin === undefined) throw new TypstNotConfigured();

      const certificate = await caseOf(source);
      if (typeof certificate === 'string') {
        return skip({ ijazahId, generation, reason: certificate });
      }
      const signature = await storage.read(source.signatureStorageKey);
      const pdf = await renderCertificatePdf({ run, bin: typstBin, certificate, signature });
      const key = certificateKey(ijazahId, generation);
      await storage.put(key, pdf, PDF_TYPE);

      const marked = await steps.mark({ ijazahId, generation, storageKey: key, at: clock() });
      switch (marked.outcome) {
        case 'written':
          if (marked.previousKey !== key) {
            await removeAfterCommit(ijazahId, generation, marked.previousKey, 'previous_generation');
          }
          log.info({ ijazahId, generation }, 'A certificate was rendered');
          return;
        case 'stale_generation':
          if (marked.currentKey !== key) {
            await removeAfterCommit(ijazahId, generation, key, 'stale_generation');
          }
          return skip({
            ijazahId,
            generation,
            currentGeneration: marked.currentGeneration,
            reason: 'stale_generation',
          });
        case 'already_rendered':
          return skip({ ijazahId, generation, reason: 'already_rendered' });
        case 'not_found':
          await removeAfterCommit(ijazahId, generation, key, 'not_found');
          return skip({ ijazahId, generation, reason: 'not_found' });
      }
    },
  });
}
