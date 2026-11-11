// T040 of specs/004-sessions/tasks.md (spec FR-487; research R-327, «The administrator's read»;
// contracts/kernel.md, "The composition root") — verification's `createDisputeHeldFiles()`, the
// binding of sessions' `DisputeHeldFiles` port, over a recorded store, cipher, storage and settings:
//
//   - the list: each deleted owner's held documents (`document:<id>`, its type and `uploaded_at`) and
//     held photo (`photo:<userId>`, no date), of the ids asked about only, never a link or a key;
//   - the link: a `document:` reference read through the held-document reader on the caller's
//     transaction, its key decrypted for its own row and column, one signed link valid
//     `document_link_ttl_seconds`; a `photo:` reference read through identity's held photo; null
//     (sessions' `NOT_FOUND`) for a reference of neither form, a malformed id, a file not held, or
//     one whose owner is not among the ids asked about, nothing decrypted or minted.
// The readers over the real tables are `tests/db-integrity/dispute-held-files.spec.ts`'.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { SettingError, type SettingsReader } from '../../platform/settings/settings-reader.js';
import { createDisputeHeldFiles, type HeldFilesStore } from './dispute-held-files.js';

const tx = {} as Transaction;
const STUDENT = '0199d0a0-0000-7000-8000-000000000901';
const TEACHER = '0199d0a0-0000-7000-8000-000000000902';
const STRANGER = '0199d0a0-0000-7000-8000-000000000903';
const DOCUMENT = '0199d0a0-0000-7000-8000-000000000a01';
const OTHER_DOCUMENT = '0199d0a0-0000-7000-8000-000000000a02';
const UPLOADED_AT = new Date('2026-10-01T08:30:00.000Z');
const NOW = new Date('2026-11-11T09:00:00.000Z');
const SEALED = Uint8Array.from([1, 2, 3]);
const PHOTO_KEY = `photos/${STUDENT}.jpg`;
const DOCUMENT_KEY = `documents/${DOCUMENT}.pdf`;

const settings: SettingsReader = {
  async read(key, schema) {
    if (key !== 'document_link_ttl_seconds') throw new SettingError(key, 'missing');
    return schema.parse(300);
  },
};

function world({
  documentOwner = STUDENT,
  photoHeld = true,
}: { documentOwner?: string; photoHeld?: boolean } = {}) {
  const calls: unknown[][] = [];
  const store: HeldFilesStore = {
    heldDocumentsOf: async (_tx, userIds) => {
      calls.push(['heldDocumentsOf', [...userIds]]);
      return userIds.includes(STUDENT)
        ? [{ id: DOCUMENT, userId: STUDENT, documentType: 'credential', uploadedAt: UPLOADED_AT }]
        : [];
    },
    heldDocument: async (_tx, id) => {
      calls.push(['heldDocument', id]);
      return id === DOCUMENT
        ? { id: DOCUMENT, userId: documentOwner, storageKeyEncrypted: SEALED }
        : null;
    },
    heldPhotoOf: async (userId) => {
      calls.push(['heldPhotoOf', userId]);
      return photoHeld && userId === STUDENT
        ? { id: STUDENT, ownerUserId: STUDENT, storageKey: PHOTO_KEY }
        : null;
    },
  };
  const ports = createDisputeHeldFiles({
    database: {} as never,
    store,
    cipher: {
      decrypt: (sealed, column, rowId) => {
        calls.push(['decrypt', sealed, column, rowId]);
        return DOCUMENT_KEY;
      },
    },
    storage: {
      temporaryLink: async (key, ttl) => {
        calls.push(['temporaryLink', key, ttl]);
        return `https://storage.invalid/signed/${encodeURIComponent(key)}`;
      },
    },
    settings,
    clock: () => NOW,
  });
  return { ports, calls };
}

describe('heldFilesOf (FR-487)', () => {
  it('lists each deleted owner’s held photo and documents, by reference, with no link and no key', async () => {
    const { ports } = world();
    const files = await ports.heldFilesOf(tx, [STUDENT, TEACHER]);
    expect(files).toEqual([
      { fileRef: `photo:${STUDENT}`, kind: 'photo', ownerUserId: STUDENT },
      {
        fileRef: `document:${DOCUMENT}`,
        kind: 'credential',
        ownerUserId: STUDENT,
        uploadedAt: UPLOADED_AT,
      },
    ]);
    expect(JSON.stringify(files)).not.toContain(PHOTO_KEY);
    expect(JSON.stringify(files)).not.toContain('https:');
  });

  it('asks only of the ids given, and mints nothing', async () => {
    const { ports, calls } = world();
    await ports.heldFilesOf(tx, [STUDENT, TEACHER]);
    expect(calls).toEqual(
      expect.arrayContaining([
        ['heldDocumentsOf', [STUDENT, TEACHER]],
        ['heldPhotoOf', STUDENT],
        ['heldPhotoOf', TEACHER],
      ]),
    );
    expect(calls.map(([name]) => name)).not.toContain('temporaryLink');
    expect(calls.map(([name]) => name)).not.toContain('decrypt');
  });

  it('lists nothing for owners with nothing held', async () => {
    const { ports } = world({ photoHeld: false });
    expect(await ports.heldFilesOf(tx, [TEACHER])).toEqual([]);
  });
});

describe('heldFileLink (FR-487)', () => {
  it('mints one link to a held document, its key decrypted for its own row and column', async () => {
    const { ports, calls } = world();
    expect(await ports.heldFileLink(tx, [STUDENT, TEACHER], `document:${DOCUMENT}`)).toEqual({
      url: `https://storage.invalid/signed/${encodeURIComponent(DOCUMENT_KEY)}`,
      expiresAt: '2026-11-11T09:05:00Z',
    });
    expect(calls).toEqual([
      ['heldDocument', DOCUMENT],
      ['decrypt', SEALED, 'verification_documents.storage_key_encrypted', DOCUMENT],
      ['temporaryLink', DOCUMENT_KEY, 300],
    ]);
  });

  it('mints one link to a held photo', async () => {
    const { ports, calls } = world();
    expect(await ports.heldFileLink(tx, [STUDENT, TEACHER], `photo:${STUDENT}`)).toEqual({
      url: `https://storage.invalid/signed/${encodeURIComponent(PHOTO_KEY)}`,
      expiresAt: '2026-11-11T09:05:00Z',
    });
    expect(calls).toEqual([
      ['heldPhotoOf', STUDENT],
      ['temporaryLink', PHOTO_KEY, 300],
    ]);
  });

  it.each([
    ['a reference of neither form', 'not-a-reference'],
    ['a storage key', DOCUMENT_KEY],
    ['an unknown prefix', `file:${DOCUMENT}`],
    ['a malformed document id', 'document:12345'],
    ['an upper-case id', `document:${DOCUMENT.toUpperCase()}`],
    ['a trailing addition', `photo:${STUDENT}/x`],
  ])('answers null for %s, reading nothing', async (_name, fileRef) => {
    const { ports, calls } = world();
    expect(await ports.heldFileLink(tx, [STUDENT, TEACHER], fileRef)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('answers null for a document not held, minting nothing', async () => {
    const { ports, calls } = world();
    expect(
      await ports.heldFileLink(tx, [STUDENT, TEACHER], `document:${OTHER_DOCUMENT}`),
    ).toBeNull();
    expect(calls).toEqual([['heldDocument', OTHER_DOCUMENT]]);
  });

  it('answers null for a held document of someone not asked about (another enrollment’s party)', async () => {
    const { ports, calls } = world({ documentOwner: STRANGER });
    expect(await ports.heldFileLink(tx, [STUDENT, TEACHER], `document:${DOCUMENT}`)).toBeNull();
    expect(calls.map(([name]) => name)).toEqual(['heldDocument']);
  });

  it('answers null for the photo of someone not asked about, reading nothing', async () => {
    const { ports, calls } = world();
    expect(await ports.heldFileLink(tx, [TEACHER], `photo:${STUDENT}`)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('answers null for a photo not held (a live person, or its file already removed)', async () => {
    const { ports, calls } = world({ photoHeld: false });
    expect(await ports.heldFileLink(tx, [STUDENT, TEACHER], `photo:${STUDENT}`)).toBeNull();
    expect(calls).toEqual([['heldPhotoOf', STUDENT]]);
  });
});
