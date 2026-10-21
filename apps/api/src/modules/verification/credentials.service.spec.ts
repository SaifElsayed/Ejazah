// T054 — the teacher's credentials after approval (FR-153, FR-PROFILE-11, FR-ISNAD-5;
// app-surface.md "`teacher.credentials`").
//
// An approved teacher adds a subject by its ijazah PDF; the credential waits for review, and a
// subject that already has an approved or a waiting credential is refused. The list answers every
// credential with its subject, its status and its dates; the chain and the transcription an
// administrator wrote are answered on an approved credential only, the reviewer's reason while it
// waits on a document or after a rejection. A credential waiting on a document takes a new PDF and
// waits for review again; a link to the PDF is minted for its owner only. Over the stores in memory
// (`__fixtures__/stores.ts`) and a recorded link minting (`verification.service.ts`, T024).
import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { DocumentViewer } from './verification.service.js';
import { CredentialsService } from './credentials.service.js';
import { INACTIVE_SUBJECT, MemoryStores, SUBJECTS } from './__fixtures__/stores.js';

const TEACHER = '0199d0a0-0000-7000-8000-00000000000a';
const OTHER = '0199d0a0-0000-7000-8000-00000000000b';
const NOW = new Date('2026-10-21T09:00:00Z');
const REVIEWED = new Date('2026-10-22T10:15:00Z');

const [quran, tajweed, qiraat] = SUBJECTS;

let stores: MemoryStores;
let minted: { documentId: string; viewer: DocumentViewer }[];
let service: CredentialsService;

beforeEach(() => {
  stores = new MemoryStores();
  minted = [];
  const links = {
    documentLinkFor: async (_tx: Transaction, documentId: string, viewer: DocumentViewer) => {
      minted.push({ documentId, viewer });
      return { url: `https://storage.invalid/${documentId}`, expiresAt: '2026-10-21T09:05:00Z' };
    },
  };
  service = new CredentialsService({ stores, links, now: () => NOW });
});

const refused = (code: string) => expect.objectContaining({ code });

async function added(subjectId: string = quran.id, userId = TEACHER) {
  const documentId = stores.upload(userId);
  const { credentialId } = await service.add(userId, { subjectId, documentId });
  return { credentialId, documentId };
}

describe('add (FR-153, FR-PROFILE-11)', () => {
  it('writes a pending credential, not sent with an application', async () => {
    const { credentialId, documentId } = await added();
    expect(stores.credentialsFor(TEACHER)).toEqual([
      expect.objectContaining({
        id: credentialId,
        subjectId: quran.id,
        documentId,
        status: 'pending',
        submittedWithApplication: false,
        createdAt: NOW,
      }),
    ]);
  });

  it('refuses a subject with a pending or an approved credential, with CONFLICT', async () => {
    await added(quran.id);
    await expect(added(quran.id)).rejects.toEqual(refused('CONFLICT'));

    const { credentialId } = await added(tajweed.id);
    stores.review(credentialId, {
      status: 'approved',
      at: REVIEWED,
      holderName: 'سارة عادل',
      riwaya: 'حفص عن عاصم',
      tariq: null,
      chain: [{ position: 1, names: ['النبي ﷺ'] }],
    });
    await expect(added(tajweed.id)).rejects.toEqual(refused('CONFLICT'));
    expect(stores.credentialsFor(TEACHER)).toHaveLength(2);
  });

  it('takes a subject again once its earlier credential was rejected', async () => {
    const { credentialId } = await added(qiraat.id);
    stores.review(credentialId, { status: 'rejected', reason: 'غير مقروء', at: REVIEWED });
    await expect(added(qiraat.id)).resolves.toMatchObject({ credentialId: expect.any(String) });
  });

  it('refuses an inactive subject (VALIDATION_FAILED) and another person’s document (DOCUMENT_NOT_OWNED)', async () => {
    await expect(
      service.add(TEACHER, { subjectId: INACTIVE_SUBJECT, documentId: stores.upload(TEACHER) }),
    ).rejects.toEqual(refused('VALIDATION_FAILED'));
    await expect(
      service.add(TEACHER, { subjectId: quran.id, documentId: stores.upload(OTHER) }),
    ).rejects.toEqual(refused('DOCUMENT_NOT_OWNED'));
    expect(stores.writes).toEqual([]);
  });
});

describe('list (FR-153, FR-ISNAD-5)', () => {
  it('answers each credential with its subject and dates; the chain on an approved one only', async () => {
    const approved = await added(quran.id);
    stores.review(approved.credentialId, {
      status: 'approved',
      at: REVIEWED,
      holderName: 'سارة عادل',
      riwaya: 'حفص عن عاصم',
      tariq: 'الشاطبية',
      chain: [
        { position: 1, names: ['النبي ﷺ'] },
        { position: 2, names: ['جبريل', 'عثمان بن عفان'] },
      ],
    });
    const pending = await added(tajweed.id);

    await expect(service.list(TEACHER)).resolves.toEqual([
      {
        credentialId: approved.credentialId,
        subject: quran,
        status: 'approved',
        submittedAt: '2026-10-21T09:00:00.000Z',
        reviewedAt: '2026-10-22T10:15:00.000Z',
        holderName: 'سارة عادل',
        riwaya: 'حفص عن عاصم',
        tariq: 'الشاطبية',
        chain: [
          { position: 1, names: ['النبي ﷺ'] },
          { position: 2, names: ['جبريل', 'عثمان بن عفان'] },
        ],
        document: { sizeBytes: 2048 },
      },
      {
        credentialId: pending.credentialId,
        subject: tajweed,
        status: 'pending',
        submittedAt: '2026-10-21T09:00:00.000Z',
        document: { sizeBytes: 2048 },
      },
    ]);
  });

  it('answers the reviewer’s reason while waiting on a document and after a rejection, never the chain', async () => {
    const waiting = await added(quran.id);
    stores.review(waiting.credentialId, {
      status: 'needs_document',
      reason: 'الملف غير واضح',
      at: REVIEWED,
    });
    const rejected = await added(tajweed.id);
    stores.review(rejected.credentialId, {
      status: 'rejected',
      reason: 'لا تطابق الاسم',
      at: REVIEWED,
    });

    const list = await service.list(TEACHER);
    expect(list.map(({ status, note, chain }) => ({ status, note, chain }))).toEqual([
      { status: 'needs_document', note: 'الملف غير واضح', chain: undefined },
      { status: 'rejected', note: 'لا تطابق الاسم', chain: undefined },
    ]);
  });

  it('answers no size for a document uploaded before sizes were recorded, and nothing of another teacher', async () => {
    const documentId = stores.upload(TEACHER, null);
    await service.add(TEACHER, { subjectId: quran.id, documentId });
    await added(tajweed.id, OTHER);
    const list = await service.list(TEACHER);
    expect(list).toHaveLength(1);
    expect(list[0]?.document).toEqual({});
  });
});

describe('replaceDocument (FR-153)', () => {
  it('takes a new PDF for a credential waiting on one, which waits for review again', async () => {
    const { credentialId } = await added();
    stores.review(credentialId, {
      status: 'needs_document',
      reason: 'الملف غير واضح',
      at: REVIEWED,
    });
    const documentId = stores.upload(TEACHER);
    await service.replaceDocument(TEACHER, { credentialId, documentId });
    expect(stores.credentialsFor(TEACHER)[0]).toMatchObject({ documentId, status: 'pending' });
  });

  it('refuses a credential waiting on nothing with CONFLICT', async () => {
    const { credentialId } = await added();
    await expect(
      service.replaceDocument(TEACHER, { credentialId, documentId: stores.upload(TEACHER) }),
    ).rejects.toEqual(refused('CONFLICT'));
  });

  it('refuses another teacher’s credential (NOT_FOUND) and another person’s document (DOCUMENT_NOT_OWNED)', async () => {
    const others = await added(quran.id, OTHER);
    stores.review(others.credentialId, {
      status: 'needs_document',
      reason: 'ملف آخر',
      at: REVIEWED,
    });
    await expect(
      service.replaceDocument(TEACHER, {
        credentialId: others.credentialId,
        documentId: stores.upload(TEACHER),
      }),
    ).rejects.toEqual(refused('NOT_FOUND'));

    const { credentialId } = await added();
    stores.review(credentialId, { status: 'needs_document', reason: 'ملف آخر', at: REVIEWED });
    await expect(
      service.replaceDocument(TEACHER, { credentialId, documentId: stores.upload(OTHER) }),
    ).rejects.toEqual(refused('DOCUMENT_NOT_OWNED'));
    expect(stores.writes).not.toContain('credential.replaceDocument');
  });
});

describe('documentLink (NFR-SEC-3)', () => {
  it('mints a link to the owner’s own PDF, as its owner', async () => {
    const { credentialId, documentId } = await added();
    await expect(service.documentLink(TEACHER, { credentialId })).resolves.toEqual({
      url: `https://storage.invalid/${documentId}`,
      expiresAt: '2026-10-21T09:05:00Z',
    });
    expect(minted).toEqual([{ documentId, viewer: { kind: 'user', userId: TEACHER } }]);
  });

  it('refuses another teacher’s credential with NOT_FOUND, minting nothing', async () => {
    const { credentialId } = await added(quran.id, OTHER);
    await expect(service.documentLink(TEACHER, { credentialId })).rejects.toEqual(
      refused('NOT_FOUND'),
    );
    expect(minted).toEqual([]);
  });
});
