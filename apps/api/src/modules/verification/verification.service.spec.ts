// T024 — `documentLinkFor` (FR-151, NFR-SEC-3, R-SEC-3): a signed, expiring link to a stored
// document, minted on demand for its owner or an administrator and refused to anyone else, living
// `document_link_ttl_seconds`. Over the in-memory storage stand-in (whose links are signed and
// expire like the real ones), the real column cipher and a recorded transaction.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColumnCipher } from '../../platform/crypto/encryption.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { SettingError, type SettingsReader } from '../../platform/settings/settings-reader.js';
import { storageStub } from '../../surfaces/upload-fixtures.js';
import { DOCUMENT_LINK_TTL_SETTING, VerificationService } from './verification.service.js';
import { DOCUMENT_STORAGE_KEY_COLUMN } from './verification.repository.js';

const OWNER = '0199d0a0-0000-7000-8000-00000000000a';
const OTHER = '0199d0a0-0000-7000-8000-00000000000b';
const ADMIN = '0199d0a0-0000-7000-8000-0000000000ad';
const DOCUMENT = '0199d0a0-0000-7000-8000-0000000000d0';
const KEY = `documents/${DOCUMENT}.pdf`;
const TTL = 300;

const cipher = new ColumnCipher(Buffer.alloc(32, 5).toString('base64'));

const settings: SettingsReader = {
  read: async (key, schema) => {
    if (key !== DOCUMENT_LINK_TTL_SETTING) throw new SettingError(key, 'missing');
    return schema.parse(TTL);
  },
};

afterEach(() => {
  vi.useRealTimers();
});

function fixture(now = new Date('2026-10-19T10:00:00Z')) {
  let clock = now;
  const storage = storageStub({ now: () => clock });
  const rows = new Map([
    [
      DOCUMENT,
      {
        id: DOCUMENT,
        userId: OWNER,
        storageKeyEncrypted: cipher.encrypt(KEY, DOCUMENT_STORAGE_KEY_COLUMN, DOCUMENT),
      },
    ],
  ]);
  const tx = {
    verificationDocument: {
      findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
    },
  } as unknown as Transaction;
  const service = new VerificationService({ storage, cipher, settings, clock: () => clock });
  return { service, storage, tx, advance: (to: Date) => (clock = to) };
}

describe('documentLinkFor (T024, FR-151)', () => {
  it('mints a signed link to the owner, living document_link_ttl_seconds', async () => {
    const { service, storage, tx } = fixture();
    const link = await service.documentLinkFor(tx, DOCUMENT, { kind: 'user', userId: OWNER });
    expect(storage.verifyLink(link.url)).toBe(KEY);
    expect(link.expiresAt).toBe('2026-10-19T10:05:00Z');
  });

  it('mints the same to an administrator', async () => {
    const { service, storage, tx } = fixture();
    const link = await service.documentLinkFor(tx, DOCUMENT, { kind: 'admin', adminId: ADMIN });
    expect(storage.verifyLink(link.url)).toBe(KEY);
  });

  it('refuses another user with DOCUMENT_NOT_OWNED, minting nothing', async () => {
    const { service, storage, tx } = fixture();
    await expect(
      service.documentLinkFor(tx, DOCUMENT, { kind: 'user', userId: OTHER }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_NOT_OWNED' });
    expect(storage.calls).toEqual([]);
  });

  it('answers NOT_FOUND for a document that does not exist, to anyone', async () => {
    const { service, tx } = fixture();
    await expect(
      service.documentLinkFor(tx, '0199d0a0-0000-7000-8000-0000000000ff', {
        kind: 'admin',
        adminId: ADMIN,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('issues a link that no longer reads once its moment has passed', async () => {
    const { service, storage, tx, advance } = fixture();
    const { url } = await service.documentLinkFor(tx, DOCUMENT, { kind: 'user', userId: OWNER });
    advance(new Date('2026-10-19T10:04:59Z'));
    expect(storage.verifyLink(url)).toBe(KEY);
    advance(new Date('2026-10-19T10:05:00Z'));
    expect(storage.verifyLink(url)).toBeUndefined();
  });
});
