// T053 — the teacher's application (FR-150, FR-152, FR-155; app-surface.md "`teacher.application`").
//
// An application is the subjects, a qualification sentence, one identity document and one ijazah PDF
// per chosen subject, every document the applicant's own upload. Submitting writes the profile's
// application `in_review` and one pending credential per subject marked as sent with the
// application; it is keyed, so a retry answers the first outcome. A request for a document is met by
// resubmitting what was asked, which returns the application to the queue; a rejected applicant
// reapplies with a new application, the earlier credentials kept as history; a banned one is refused.
// `get` answers the status screen in each drawn state. Over the stores in memory
// (`__fixtures__/stores.ts`); the real stores' rules over the tables are
// tests/db-integrity/teacher-application.spec.ts's.
import { beforeEach, describe, expect, it } from 'vitest';

import { ApplicationService } from './application.service.js';
import {
  INACTIVE_SUBJECT,
  MemoryStores,
  recordedIdempotency,
  SUBJECTS,
} from './__fixtures__/stores.js';

const APPLICANT = '0199d0a0-0000-7000-8000-00000000000a';
const OTHER = '0199d0a0-0000-7000-8000-00000000000b';
const NOW = new Date('2026-10-21T09:00:00Z');
const LATER = new Date('2026-10-23T12:30:00Z');
const KEY = 'apply-0199d0a0-0000-7000-8000';

const [quran, tajweed] = SUBJECTS;

let stores: MemoryStores;
let idempotency: ReturnType<typeof recordedIdempotency>;
let clock: Date;
let service: ApplicationService;

beforeEach(() => {
  stores = new MemoryStores();
  idempotency = recordedIdempotency();
  clock = NOW;
  service = new ApplicationService({ stores, idempotency, now: () => clock });
});

const refused = (code: string) => expect.objectContaining({ code });

/** An application of the two subjects, every document the applicant's upload. */
function application(userId = APPLICANT) {
  return {
    subjectIds: [quran.id, tajweed.id],
    qualificationSummary: 'إجازة في حفظ القرآن، أدرّس منذ ثماني سنوات',
    identityDocument: { type: 'national_id' as const, documentId: stores.upload(userId) },
    credentials: [
      { subjectId: quran.id, documentId: stores.upload(userId) },
      { subjectId: tajweed.id, documentId: stores.upload(userId) },
    ],
  };
}

async function submitted(userId = APPLICANT) {
  const input = application(userId);
  await service.submit(userId, { ...input, idempotencyKey: KEY });
  return input;
}

describe('submit (FR-150)', () => {
  it('writes the application in_review and one pending credential per subject, sent with it', async () => {
    const input = await submitted();

    expect(stores.profiles.get(APPLICANT)).toMatchObject({
      status: 'in_review',
      submittedAt: NOW,
      qualificationSummary: input.qualificationSummary,
      identityDocumentId: input.identityDocument.documentId,
      identityDocumentType: 'national_id',
      note: null,
      decidedAt: null,
    });
    expect(
      stores
        .credentialsFor(APPLICANT)
        .map(({ subjectId, documentId, status, submittedWithApplication }) => ({
          subjectId,
          documentId,
          status,
          submittedWithApplication,
        })),
    ).toEqual(
      input.credentials.map(({ subjectId, documentId }) => ({
        subjectId,
        documentId,
        status: 'pending',
        submittedWithApplication: true,
      })),
    );
  });

  it('runs once under the kernel key, the actor the server resolved, the input without the key', async () => {
    const input = await submitted();
    expect(idempotency.runs).toEqual([
      { scope: 'teacher.application.submit', key: KEY, actorId: APPLICANT, input },
    ]);
  });

  it('refuses a chosen subject without its PDF with APPLICATION_INCOMPLETE, writing nothing', async () => {
    const input = application();
    await expect(
      service.submit(APPLICANT, {
        ...input,
        credentials: input.credentials.slice(0, 1),
        idempotencyKey: KEY,
      }),
    ).rejects.toEqual(refused('APPLICATION_INCOMPLETE'));
    expect(stores.writes).toEqual([]);
  });

  it('refuses a document of another person, or one that does not exist, with DOCUMENT_NOT_OWNED', async () => {
    const foreign = stores.upload(OTHER);
    const input = application();
    for (const change of [
      { identityDocument: { type: 'passport' as const, documentId: foreign } },
      {
        credentials: [
          input.credentials[0]!,
          { subjectId: tajweed.id, documentId: '0199d0a0-0000-7000-8000-0000000000ff' },
        ],
      },
    ]) {
      await expect(
        service.submit(APPLICANT, { ...input, ...change, idempotencyKey: KEY }),
      ).rejects.toEqual(refused('DOCUMENT_NOT_OWNED'));
    }
    expect(stores.writes).toEqual([]);
  });

  it('refuses a PDF for a subject not chosen, a subject twice, one document twice and an inactive subject', async () => {
    const input = application();
    const cases = [
      {
        credentials: [
          ...input.credentials,
          { subjectId: SUBJECTS[2].id, documentId: stores.upload(APPLICANT) },
        ],
      },
      { subjectIds: [quran.id, quran.id, tajweed.id] },
      {
        credentials: [
          input.credentials[0]!,
          { subjectId: tajweed.id, documentId: input.identityDocument.documentId },
        ],
      },
      {
        subjectIds: [quran.id, INACTIVE_SUBJECT],
        credentials: [
          input.credentials[0]!,
          { subjectId: INACTIVE_SUBJECT, documentId: stores.upload(APPLICANT) },
        ],
      },
    ];
    for (const change of cases) {
      await expect(
        service.submit(APPLICANT, { ...input, ...change, idempotencyKey: KEY }),
      ).rejects.toEqual(refused('VALIDATION_FAILED'));
    }
    expect(stores.writes).toEqual([]);
  });

  it('refuses a second application while one exists, with CONFLICT', async () => {
    await submitted();
    await expect(
      service.submit(APPLICANT, { ...application(), idempotencyKey: `${KEY}-2` }),
    ).rejects.toEqual(refused('CONFLICT'));
    expect(stores.credentialsFor(APPLICANT)).toHaveLength(2);
  });

  it('refuses a banned application with FORBIDDEN', async () => {
    await submitted();
    stores.decide(APPLICANT, 'banned', LATER, 'وثائق مزوّرة');
    await expect(
      service.submit(APPLICANT, { ...application(), idempotencyKey: `${KEY}-2` }),
    ).rejects.toEqual(refused('FORBIDDEN'));
  });
});

describe('resubmit (FR-152)', () => {
  async function waitingOnDocument() {
    const input = await submitted();
    const [first] = stores.credentialsFor(APPLICANT);
    stores.review(first!.id, { status: 'needs_document', reason: 'الملف غير واضح', at: LATER });
    stores.decide(APPLICANT, 'needs_document', LATER, 'نحتاج نسخة أوضح من إجازة الحفظ');
    return { input, credentialId: first!.id };
  }

  it('replaces what was asked for and returns the application to in_review', async () => {
    const { credentialId } = await waitingOnDocument();
    const identityDocumentId = stores.upload(APPLICANT);
    const documentId = stores.upload(APPLICANT);
    await service.resubmit(APPLICANT, {
      identityDocumentId,
      credentials: [{ credentialId, documentId }],
    });

    expect(stores.profiles.get(APPLICANT)).toMatchObject({
      status: 'in_review',
      identityDocumentId,
    });
    expect(stores.credentialsFor(APPLICANT)[0]).toMatchObject({ documentId, status: 'pending' });
  });

  it('refuses while a credential the reviewer asked for is left unreplaced, with APPLICATION_INCOMPLETE', async () => {
    await waitingOnDocument();
    await expect(
      service.resubmit(APPLICANT, { identityDocumentId: stores.upload(APPLICANT) }),
    ).rejects.toEqual(refused('APPLICATION_INCOMPLETE'));
    expect(stores.profiles.get(APPLICANT)?.status).toBe('needs_document');
  });

  it('refuses a credential that waits on nothing (CONFLICT) and another person’s (NOT_FOUND)', async () => {
    const { credentialId } = await waitingOnDocument();
    const [, waitingOnNothing] = stores.credentialsFor(APPLICANT);
    await expect(
      service.resubmit(APPLICANT, {
        credentials: [
          { credentialId, documentId: stores.upload(APPLICANT) },
          { credentialId: waitingOnNothing!.id, documentId: stores.upload(APPLICANT) },
        ],
      }),
    ).rejects.toEqual(refused('CONFLICT'));

    await submitted(OTHER);
    const [othersCredential] = stores.credentialsFor(OTHER);
    await expect(
      service.resubmit(APPLICANT, {
        credentials: [{ credentialId: othersCredential!.id, documentId: stores.upload(APPLICANT) }],
      }),
    ).rejects.toEqual(refused('NOT_FOUND'));
    expect(stores.writes.filter((write) => write === 'credential.replaceDocument')).toEqual([]);
  });

  it('refuses another person’s document with DOCUMENT_NOT_OWNED', async () => {
    const { credentialId } = await waitingOnDocument();
    await expect(
      service.resubmit(APPLICANT, {
        credentials: [{ credentialId, documentId: stores.upload(OTHER) }],
      }),
    ).rejects.toEqual(refused('DOCUMENT_NOT_OWNED'));
  });

  it('refuses an application that waits on nothing, with CONFLICT', async () => {
    await submitted();
    await expect(
      service.resubmit(APPLICANT, { identityDocumentId: stores.upload(APPLICANT) }),
    ).rejects.toEqual(refused('CONFLICT'));
  });

  it("locks the application's row before it reads the application and its credentials (T161)", async () => {
    const { credentialId } = await waitingOnDocument();
    stores.journal.length = 0;
    await service.resubmit(APPLICANT, {
      credentials: [{ credentialId, documentId: stores.upload(APPLICANT) }],
    });
    expect(stores.journal).toEqual([
      `lock:${APPLICANT}`,
      `read:${APPLICANT}`,
      `credentials:${APPLICANT}`,
    ]);
  });
});

describe('reapply (FR-155)', () => {
  it('opens a new application from rejected, the earlier credentials kept as history', async () => {
    await submitted();
    for (const { id } of stores.credentialsFor(APPLICANT)) {
      stores.review(id, { status: 'rejected', reason: 'لا تطابق الاسم', at: LATER });
    }
    stores.decide(APPLICANT, 'rejected', LATER, 'الوثائق لا تطابق الاسم المسجّل');
    clock = new Date('2026-10-25T08:00:00Z');

    const input = application();
    await service.reapply(APPLICANT, {
      ...input,
      subjectIds: [quran.id],
      credentials: input.credentials.slice(0, 1),
    });

    expect(stores.profiles.get(APPLICANT)).toMatchObject({
      status: 'in_review',
      submittedAt: clock,
      note: null,
      decidedAt: null,
    });
    expect(stores.credentialsFor(APPLICANT).map(({ status }) => status)).toEqual([
      'rejected',
      'rejected',
      'pending',
    ]);
    await expect(service.get(APPLICANT)).resolves.toMatchObject({ subjectCount: 1 });
  });

  it("locks the account's row before it reads or opens the application (T142)", async () => {
    // The account first, the order a ban takes it (the owner's decision of 2026-11-01): the new
    // credentials reference the teacher's `users` row, so holding only the application, their
    // insert would wait on a ban holding the account while the ban waits on the application.
    await submitted();
    stores.decide(APPLICANT, 'rejected', LATER, 'الوثائق لا تطابق الاسم المسجّل');
    stores.journal.length = 0;
    await service.reapply(APPLICANT, application());
    expect(stores.journal.slice(0, 2)).toEqual([`lock-account:${APPLICANT}`, `read:${APPLICANT}`]);
  });

  it('refuses from every other state with CONFLICT, and a banned application with FORBIDDEN', async () => {
    await expect(service.reapply(APPLICANT, application())).rejects.toEqual(refused('CONFLICT'));
    await submitted();
    for (const status of ['in_review', 'needs_document', 'approved'] as const) {
      if (status !== 'in_review') stores.decide(APPLICANT, status, LATER, 'ملاحظة');
      await expect(service.reapply(APPLICANT, application())).rejects.toEqual(refused('CONFLICT'));
    }
    stores.decide(APPLICANT, 'banned', LATER, 'وثائق مزوّرة');
    await expect(service.reapply(APPLICANT, application())).rejects.toEqual(refused('FORBIDDEN'));
  });
});

describe('get: every drawn state (FR-152)', () => {
  it('answers not_started before any application', async () => {
    await expect(service.get(APPLICANT)).resolves.toEqual({
      status: 'not_started',
      callRecorded: false,
      approvedShown: false,
    });
  });

  it('answers in_review with the submission and the subject count, no note', async () => {
    await submitted();
    await expect(service.get(APPLICANT)).resolves.toEqual({
      status: 'in_review',
      submittedAt: '2026-10-21T09:00:00.000Z',
      subjectCount: 2,
      callRecorded: false,
      approvedShown: false,
    });
    stores.recordCall(APPLICANT);
    await expect(service.get(APPLICANT)).resolves.toMatchObject({ callRecorded: true });
  });

  it('answers needs_document and rejected with the note and when it was written', async () => {
    await submitted();
    for (const status of ['needs_document', 'rejected'] as const) {
      stores.decide(APPLICANT, status, LATER, 'نحتاج نسخة أوضح');
      await expect(service.get(APPLICANT)).resolves.toEqual({
        status,
        submittedAt: '2026-10-21T09:00:00.000Z',
        subjectCount: 2,
        note: 'نحتاج نسخة أوضح',
        decidedAt: '2026-10-23T12:30:00.000Z',
        callRecorded: false,
        approvedShown: false,
      });
    }
  });

  it('answers approved with its date, and the once-only screen shown after markApprovedShown', async () => {
    await submitted();
    stores.recordCall(APPLICANT);
    stores.decide(APPLICANT, 'approved', LATER);
    await expect(service.get(APPLICANT)).resolves.toEqual({
      status: 'approved',
      submittedAt: '2026-10-21T09:00:00.000Z',
      subjectCount: 2,
      callRecorded: true,
      decidedAt: '2026-10-23T12:30:00.000Z',
      approvedShown: false,
    });
    await service.markApprovedShown(APPLICANT);
    await service.markApprovedShown(APPLICANT);
    await expect(service.get(APPLICANT)).resolves.toMatchObject({ approvedShown: true });
    expect(stores.profiles.get(APPLICANT)?.approvedShownAt).toEqual(NOW);
  });

  it('refuses a banned application with FORBIDDEN: the restricted screen answers it, never this one', async () => {
    await submitted();
    stores.decide(APPLICANT, 'banned', LATER, 'وثائق مزوّرة');
    await expect(service.get(APPLICANT)).rejects.toEqual(refused('FORBIDDEN'));
  });

  it('marks the approved screen shown for an approved application only (CONFLICT otherwise)', async () => {
    await expect(service.markApprovedShown(APPLICANT)).rejects.toEqual(refused('CONFLICT'));
    await submitted();
    await expect(service.markApprovedShown(APPLICANT)).rejects.toEqual(refused('CONFLICT'));
  });
});
