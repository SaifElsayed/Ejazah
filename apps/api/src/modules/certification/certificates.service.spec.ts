// T009 of specs/005-certification — the parties' certificates over a store held in memory (FR-607,
// FR-609; research R-412; D1 (a), DEC-72; R-HONEST-6, R-GENDER-2, R-SEC-3).
//
// - list: the caller's ijazahs as student and as granting teacher, newest first, each with its
//   subject, the teacher's printed name and the issue instant; `ready` once signed off, `revoked`
//   after a revocation and then never `ready`; another person's ijazahs never.
// - link: the two parties only; anyone else, and an id that never existed, NOT_FOUND with one shape;
//   `revoked` after a revocation and `not_ready` until the sign-off, both CONFLICT with no link; a
//   signed-off one answered a signed link under `document_link_ttl_seconds`, never the storage key.
// - Every refusal one info line of ids and its reason; no line carries the key or a name.
import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  type CertificateRow,
  type CertificatesStore,
  CertificatesService,
} from './certificates.service.js';

const STUDENT = '0199d0a0-0000-7000-8000-0000000009a1';
const TEACHER = '0199d0a0-0000-7000-8000-0000000009a2';
const STRANGER = '0199d0a0-0000-7000-8000-0000000009a3';
const OTHER_STUDENT = '0199d0a0-0000-7000-8000-0000000009a4';
const SUBJECT = { id: '0199d0a0-0000-7000-8000-0000000009c1', nameAr: 'القرآن', nameEn: 'Quran' };
const SIGNED = '0199d0a0-0000-7000-8000-0000000009b1';
const UNSIGNED = '0199d0a0-0000-7000-8000-0000000009b2';
const REVOKED = '0199d0a0-0000-7000-8000-0000000009b3';
const REVOKED_UNSIGNED = '0199d0a0-0000-7000-8000-0000000009b4';
const ANOTHERS = '0199d0a0-0000-7000-8000-0000000009b5';
const MISSING = '0199d0a0-0000-7000-8000-0000000009ff';
const TTL = 900;
const TEACHER_NAME = 'فاطمة بنت علي';

function row(id: string, change: Partial<CertificateRow> = {}): CertificateRow {
  return {
    id,
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
    subjectId: SUBJECT.id,
    teacherNamePrinted: TEACHER_NAME,
    grantedAt: new Date('2026-11-17T10:00:00.000Z'),
    signedOffAt: new Date('2026-11-17T11:00:00.000Z'),
    revokedAt: null,
    certificateStorageKey: `certificates/${id}/0.pdf`,
    ...change,
  };
}

const ROWS: readonly CertificateRow[] = [
  row(SIGNED),
  row(UNSIGNED, { signedOffAt: null, grantedAt: new Date('2026-11-17T10:01:00.000Z') }),
  row(REVOKED, { revokedAt: new Date('2026-11-17T12:00:00.000Z') }),
  row(REVOKED_UNSIGNED, { signedOffAt: null, revokedAt: new Date('2026-11-17T12:00:00.000Z') }),
  row(ANOTHERS, { studentUserId: OTHER_STUDENT, teacherUserId: STRANGER }),
];

const TX = {} as Transaction;

let lines: { fields: Record<string, unknown>; message: string }[];
let links: { key: string; seconds: number }[];
let settingsRead: string[];

/** The store as the repository answers: the caller's rows newest first; a row by its id. */
const store: CertificatesStore = {
  ofParty: async (_tx, userId) =>
    ROWS.filter((r) => r.studentUserId === userId || r.teacherUserId === userId).toSorted((a, b) =>
      b.id.localeCompare(a.id),
    ),
  byId: async (_tx, ijazahId) => ROWS.find((r) => r.id === ijazahId) ?? null,
  subjectsOf: async (_tx, ids) =>
    new Map(ids.includes(SUBJECT.id) ? [[SUBJECT.id, SUBJECT] as const] : []),
};

const settings: SettingsReader = {
  read: async (key, schema) => {
    settingsRead.push(key);
    return schema.parse(key === 'document_link_ttl_seconds' ? TTL : undefined);
  },
};

function service(): CertificatesService {
  return new CertificatesService({
    transactions: { run: (work) => work(TX) },
    store,
    storage: {
      temporaryLink: async (key, seconds) => {
        links.push({ key, seconds });
        return `https://storage.example.invalid/signed?k=${encodeURIComponent(key)}&t=${seconds}`;
      },
    },
    settings,
    log: { info: (fields, message) => lines.push({ fields: { ...fields }, message }) },
  });
}

beforeEach(() => {
  lines = [];
  links = [];
  settingsRead = [];
});

async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  try {
    await call;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('answered where it must be refused');
}

describe('certificates.list (T009)', () => {
  it('answers the student’s ijazahs, newest first, each with its subject, the teacher’s printed name and the issue instant', async () => {
    const { items } = await service().list(STUDENT);
    expect(items.map((item) => item.ijazahId)).toEqual([
      REVOKED_UNSIGNED,
      REVOKED,
      UNSIGNED,
      SIGNED,
    ]);
    expect(items.at(-1)).toEqual({
      ijazahId: SIGNED,
      subject: SUBJECT,
      teacherName: TEACHER_NAME,
      issuedAt: '2026-11-17T10:00:00.000Z',
      revoked: false,
      ready: true,
    });
  });

  it('answers the granting teacher the same ijazahs', async () => {
    const { items } = await service().list(TEACHER);
    expect(items.map((item) => item.ijazahId)).toEqual([
      REVOKED_UNSIGNED,
      REVOKED,
      UNSIGNED,
      SIGNED,
    ]);
  });

  it('marks one not yet signed off as being prepared: not ready (R-412)', async () => {
    const { items } = await service().list(STUDENT);
    expect(items.find((item) => item.ijazahId === UNSIGNED)).toMatchObject({
      ready: false,
      revoked: false,
    });
  });

  it('marks a revoked one revoked and never ready, signed off or not (R-HONEST-6)', async () => {
    const { items } = await service().list(STUDENT);
    for (const id of [REVOKED, REVOKED_UNSIGNED]) {
      expect(
        items.find((item) => item.ijazahId === id),
        id,
      ).toMatchObject({
        revoked: true,
        ready: false,
      });
    }
  });

  it('answers a stranger nothing, and another party only their own', async () => {
    expect((await service().list(OTHER_STUDENT)).items.map((item) => item.ijazahId)).toEqual([
      ANOTHERS,
    ]);
    expect((await service().list(MISSING)).items).toEqual([]);
  });

  it('never answers a storage key or mints a link', async () => {
    const answer = await service().list(STUDENT);
    expect(JSON.stringify(answer)).not.toContain('certificates/');
    expect(links).toEqual([]);
  });
});

describe('certificates.link (T009)', () => {
  it('answers the student a signed link to a signed-off certificate under document_link_ttl_seconds', async () => {
    const { link } = await service().link(STUDENT, { ijazahId: SIGNED });
    expect(links).toEqual([{ key: `certificates/${SIGNED}/0.pdf`, seconds: TTL }]);
    expect(settingsRead).toEqual(['document_link_ttl_seconds']);
    expect(link).toMatch(/^https:\/\/storage\.example\.invalid\/signed\?/);
    expect(link).not.toBe(`certificates/${SIGNED}/0.pdf`);
  });

  it('answers the granting teacher a link too', async () => {
    await service().link(TEACHER, { ijazahId: SIGNED });
    expect(links).toEqual([{ key: `certificates/${SIGNED}/0.pdf`, seconds: TTL }]);
  });

  it('answers a person who is not a party NOT_FOUND, as an id that never existed (R-GENDER-2)', async () => {
    const stranger = await refusalOf(service().link(STRANGER, { ijazahId: SIGNED }));
    const absent = await refusalOf(service().link(STRANGER, { ijazahId: MISSING }));
    expect(stranger.code).toBe('NOT_FOUND');
    expect({ code: stranger.code, message: stranger.message, details: stranger.details }).toEqual({
      code: absent.code,
      message: absent.message,
      details: absent.details,
    });
    expect(links).toEqual([]);
  });

  it('answers another ijazah’s party NOT_FOUND on this one, whatever its state', async () => {
    for (const id of [SIGNED, UNSIGNED, REVOKED]) {
      const refusal = await refusalOf(service().link(OTHER_STUDENT, { ijazahId: id }));
      expect(refusal.code, id).toBe('NOT_FOUND');
      expect(refusal.details, id).toBeUndefined();
    }
    expect(links).toEqual([]);
  });

  it('refuses one not yet signed off not_ready, with no link (DEC-72)', async () => {
    for (const party of [STUDENT, TEACHER]) {
      const refusal = await refusalOf(service().link(party, { ijazahId: UNSIGNED }));
      expect(refusal.code).toBe('CONFLICT');
      expect(refusal.details).toEqual([{ path: 'ijazahId', code: 'not_ready' }]);
    }
    expect(links).toEqual([]);
  });

  it('refuses a revoked one revoked, with no link, signed off or not (D1 (a), R-HONEST-6)', async () => {
    for (const party of [STUDENT, TEACHER]) {
      for (const id of [REVOKED, REVOKED_UNSIGNED]) {
        const refusal = await refusalOf(service().link(party, { ijazahId: id }));
        expect(refusal.code, id).toBe('CONFLICT');
        expect(refusal.details, id).toEqual([{ path: 'ijazahId', code: 'revoked' }]);
      }
    }
    expect(links).toEqual([]);
  });

  it('logs each refusal once, by ids and its reason, marked logged, and never the key or a name', async () => {
    const cases = [
      { userId: STRANGER, ijazahId: SIGNED, reason: 'not_a_party' },
      { userId: STRANGER, ijazahId: MISSING, reason: 'not_found' },
      { userId: STUDENT, ijazahId: UNSIGNED, reason: 'not_ready' },
      { userId: TEACHER, ijazahId: REVOKED, reason: 'revoked' },
    ];
    for (const { userId, ijazahId, reason } of cases) {
      lines = [];
      const refusal = await refusalOf(service().link(userId, { ijazahId }));
      expect(isRefusalLogged(refusal), reason).toBe(true);
      expect(
        lines.map((line) => line.fields),
        reason,
      ).toEqual([{ userId, ijazahId, reason }]);
      expect(JSON.stringify(lines), reason).not.toMatch(/certificates\/|فاطمة/);
    }
  });
});
