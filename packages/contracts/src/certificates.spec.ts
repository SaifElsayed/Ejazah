// T009 of specs/005-certification: the `certificates` contracts (FR-607, FR-609; research R-412;
// contracts/app-surface.md, `certificates.list` and `certificates.link`; D1 (a), DEC-72; R-HONEST-6).
//
// - `list` answers the caller's ijazahs as student or as granting teacher: the subject, the teacher's
//   printed name, the issue instant, whether revoked and whether ready (signed off). A revoked one is
//   never ready, so no client offers its link (R-HONEST-6).
// - `link` takes an ijazah's id and answers a signed link, never a storage key (R-SEC-3).
// - The link's refusals: `not_ready` until the sign-off, `revoked` after a revocation.
import { describe, expect, it } from 'vitest';

import {
  certificateItem,
  certificateLinkRefusal,
  certificatesLinkInput,
  certificatesLinkOutput,
  certificatesListOutput,
} from './certificates.js';

const IJAZAH = '0199d0a0-0000-7000-8000-00000000b1b1';
const SUBJECT = { id: '0199d0a0-0000-7000-8000-00000000c1c1', nameAr: 'القرآن', nameEn: 'Quran' };
const ITEM = {
  ijazahId: IJAZAH,
  subject: SUBJECT,
  teacherName: 'فاطمة بنت علي',
  issuedAt: '2026-11-17T10:00:00.000Z',
  revoked: false,
  ready: true,
};

describe('certificates.list output (T009)', () => {
  it('answers each item with its subject, the teacher’s printed name, the issue instant and both flags', () => {
    expect(certificatesListOutput.parse({ items: [ITEM] })).toEqual({ items: [ITEM] });
    expect(certificatesListOutput.parse({ items: [] })).toEqual({ items: [] });
  });

  it('strips a storage key, a student name or a chain an answer might carry (R-SEC-3)', () => {
    const parsed = certificateItem.parse({
      ...ITEM,
      certificateStorageKey: `certificates/${IJAZAH}/0.pdf`,
      studentNamePrinted: 'مريم',
      chainSnapshot: [['محمد ﷺ']],
    });
    expect(parsed).toEqual(ITEM);
  });

  it('refuses a revoked item marked ready: a revoked ijazah is never shown valid (R-HONEST-6)', () => {
    expect(certificateItem.safeParse({ ...ITEM, revoked: true, ready: true }).success).toBe(false);
    expect(certificateItem.safeParse({ ...ITEM, revoked: true, ready: false }).success).toBe(true);
  });

  it('refuses an item without a flag, an issue instant that is not one, or an id that is not one', () => {
    const { ready: _ready, ...withoutReady } = ITEM;
    for (const item of [
      withoutReady,
      { ...ITEM, issuedAt: '2026-11-17' },
      { ...ITEM, ijazahId: 'not an id' },
      { ...ITEM, subject: { id: SUBJECT.id } },
    ]) {
      expect(certificateItem.safeParse(item).success).toBe(false);
    }
  });
});

describe('certificates.link (T009)', () => {
  it('takes an ijazah’s id and nothing that names a party', () => {
    expect(
      certificatesLinkInput.parse({ ijazahId: IJAZAH, userId: IJAZAH, gender: 'male' }),
    ).toEqual({
      ijazahId: IJAZAH,
    });
    expect(certificatesLinkInput.safeParse({ ijazahId: 'not an id' }).success).toBe(false);
    expect(certificatesLinkInput.safeParse({}).success).toBe(false);
  });

  it('answers a link that is a URL, never a storage key', () => {
    const link = 'https://storage.example.invalid/certificates/x.pdf?sig=abc';
    expect(certificatesLinkOutput.parse({ link })).toEqual({ link });
    expect(certificatesLinkOutput.safeParse({ link: `certificates/${IJAZAH}/0.pdf` }).success).toBe(
      false,
    );
    expect(certificatesLinkOutput.safeParse({ link: null }).success).toBe(false);
  });

  it('names its two refusals and no other', () => {
    expect(certificateLinkRefusal.options).toEqual(['not_ready', 'revoked']);
  });
});
