// T040 of specs/004-sessions/tasks.md (spec FR-487; SRS FR-AUTH-14 as amended on 2026-11-06; research
// R-327, «The administrator's read»; contracts/admin-surface.md, `disputes.heldFiles` and
// `disputes.heldFileLink`; the notes under T040) — `createDisputeMatterReads` over a recorded store,
// a recorded `EnrollmentSide` and a recorded `DisputeHeldFiles` port:
//
//   - a dispute of any kind (a session dispute, a compensation case, a complaint) read through
//     moderation's `caseRecordOf`, admitted only while `status = 'open'`; one resolved or dismissed
//     refused `CONFLICT` `details.cause` `not_open`, none `NOT_FOUND`, the port never asked;
//   - the port asked with the enrollment's two parties, read through `EnrollmentSide`, and each file
//     answered with its owner's role, its `fileRef` and kind, its upload date where recorded, and no
//     link or key;
//   - a link the port does not mint (a reference of neither form, not held, a live person's or
//     another enrollment's party's) refused `NOT_FOUND`;
//   - each refusal writes one info line of ids and its cause, marked «logged», never the reference.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { CaseRecord } from '../moderation/index.js';
import type { DisputeHeldFiles, HeldFile } from './dispute-held-files.port.js';
import { createDisputeMatterReads } from './dispute-matter.service.js';
import type { EnrollmentTerms } from './enrollment-side.port.js';

const tx = {} as Transaction;
const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
const DISPUTE = '0199d0a0-0000-7000-8000-0000000000d1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-000000000800';
const STUDENT = '0199d0a0-0000-7000-8000-000000000901';
const TEACHER = '0199d0a0-0000-7000-8000-000000000902';
const DOCUMENT = '0199d0a0-0000-7000-8000-000000000a01';
const UPLOADED_AT = new Date('2026-10-01T08:30:00.000Z');
const LINK = { url: 'https://storage.invalid/signed', expiresAt: '2026-11-11T09:05:00.000Z' };

function record(
  status: CaseRecord['status'] = 'open',
  kind: CaseRecord['kind'] = 'session_dispute',
): CaseRecord {
  return {
    caseId: DISPUTE,
    kind,
    enrollmentId: ENROLLMENT,
    reason: 'لم يحضر المعلم',
    status,
    resolution: null,
    resolutionNotes: null,
    createdAt: new Date('2026-11-09T09:00:00.000Z'),
    resolvedAt: status === 'open' ? null : new Date('2026-11-10T09:00:00.000Z'),
  };
}

const TERMS: EnrollmentTerms = {
  id: ENROLLMENT,
  status: 'cancelled',
  slotId: '0199d0a0-0000-7000-8000-000000000300',
  track: 'recitation',
  timezone: 'Africa/Cairo',
  durationMinutes: 60,
  sessionCount: 4,
  studentUserId: STUDENT,
  teacherUserId: TEACHER,
};

const HELD: readonly HeldFile[] = [
  { fileRef: `photo:${STUDENT}`, kind: 'photo', ownerUserId: STUDENT },
  {
    fileRef: `document:${DOCUMENT}`,
    kind: 'national_id',
    ownerUserId: STUDENT,
    uploadedAt: UPLOADED_AT,
  },
];

function world({
  dispute = record() as CaseRecord | null,
  terms = TERMS as EnrollmentTerms | null,
  held = HELD,
  link = LINK as typeof LINK | null,
} = {}) {
  const asked: unknown[][] = [];
  const lines: { fields: Record<string, unknown>; message: string | undefined }[] = [];
  const port: DisputeHeldFiles = {
    heldFilesOf: async (_tx, userIds) => {
      asked.push(['heldFilesOf', [...userIds]]);
      return held;
    },
    heldFileLink: async (_tx, userIds, fileRef) => {
      asked.push(['heldFileLink', [...userIds], fileRef]);
      return link;
    },
  };
  const reads = createDisputeMatterReads({
    enrollments: {
      enrollmentFor: async (_tx, id) => {
        asked.push(['enrollmentFor', id]);
        return terms;
      },
    },
    heldFiles: port,
    log: {
      info: (fields: Record<string, unknown>, message?: string) =>
        void lines.push({ fields, message }),
    },
    store: {
      caseRecordOf: async (_tx, id) => {
        asked.push(['caseRecordOf', id]);
        return dispute;
      },
    },
  });
  return { reads, asked, lines };
}

async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error('expected a DomainError');
  return thrown;
}

describe('disputes.heldFiles (FR-487, R-327)', () => {
  it.each(['session_dispute', 'compensation_case', 'absence_complaint'] as const)(
    'lists the deleted party’s held files inside an open %s, asked with the enrollment’s two parties',
    async (kind) => {
      const { reads, asked } = world({ dispute: record('open', kind) });
      expect(await reads.heldFiles(tx, ADMIN, { disputeId: DISPUTE })).toEqual({
        files: [
          { fileRef: `photo:${STUDENT}`, kind: 'photo', ownerRole: 'student' },
          {
            fileRef: `document:${DOCUMENT}`,
            kind: 'national_id',
            ownerRole: 'student',
            uploadedAt: UPLOADED_AT.toISOString(),
          },
        ],
      });
      expect(asked).toEqual([
        ['caseRecordOf', DISPUTE],
        ['enrollmentFor', ENROLLMENT],
        ['heldFilesOf', [STUDENT, TEACHER]],
      ]);
    },
  );

  it('names a deleted teacher’s file by the teacher’s role', async () => {
    const { reads } = world({
      held: [{ fileRef: `photo:${TEACHER}`, kind: 'photo', ownerUserId: TEACHER }],
    });
    expect(await reads.heldFiles(tx, ADMIN, { disputeId: DISPUTE })).toEqual({
      files: [{ fileRef: `photo:${TEACHER}`, kind: 'photo', ownerRole: 'teacher' }],
    });
  });

  it('answers no link and no key: each file carries its reference, kind, role and date only', async () => {
    const { reads } = world();
    const { files } = await reads.heldFiles(tx, ADMIN, { disputeId: DISPUTE });
    for (const file of files) {
      expect(Object.keys(file).sort()).toEqual(
        file.kind === 'photo'
          ? ['fileRef', 'kind', 'ownerRole']
          : ['fileRef', 'kind', 'ownerRole', 'uploadedAt'],
      );
      expect(JSON.stringify(file)).not.toMatch(/https?:|storage|\.pdf|\.jpg|photos\//);
    }
  });

  it.each(['resolved', 'dismissed'] as const)(
    'a %s dispute is CONFLICT not_open, the port never asked, one line of ids',
    async (status) => {
      const { reads, asked, lines } = world({ dispute: record(status) });
      const error = await refusalOf(reads.heldFiles(tx, ADMIN, { disputeId: DISPUTE }));
      expect(error.code).toBe('CONFLICT');
      expect(error.details).toEqual([{ path: 'cause', code: 'not_open' }]);
      expect(isRefusalLogged(error)).toBe(true);
      expect(asked).toEqual([['caseRecordOf', DISPUTE]]);
      expect(lines).toEqual([
        {
          fields: {
            adminId: ADMIN,
            disputeId: DISPUTE,
            enrollmentId: ENROLLMENT,
            errorCode: 'CONFLICT',
            cause: 'not_open',
          },
          message: 'A dispute matter read was refused',
        },
      ]);
    },
  );

  it('no dispute is NOT_FOUND, the port never asked', async () => {
    const { reads, asked, lines } = world({ dispute: null });
    const error = await refusalOf(reads.heldFiles(tx, ADMIN, { disputeId: DISPUTE }));
    expect(error.code).toBe('NOT_FOUND');
    expect(isRefusalLogged(error)).toBe(true);
    expect(asked).toEqual([['caseRecordOf', DISPUTE]]);
    expect(lines.map(({ fields }) => fields)).toEqual([
      { adminId: ADMIN, disputeId: DISPUTE, errorCode: 'NOT_FOUND', cause: 'not_found' },
    ]);
  });

  it('an enrollment no ordinary read finds is NOT_FOUND, the port never asked', async () => {
    const { reads, asked } = world({ terms: null });
    expect((await refusalOf(reads.heldFiles(tx, ADMIN, { disputeId: DISPUTE }))).code).toBe(
      'NOT_FOUND',
    );
    expect(asked.map(([name]) => name)).toEqual(['caseRecordOf', 'enrollmentFor']);
  });
});

describe('disputes.heldFileLink (FR-487, R-327)', () => {
  it('answers the port’s one link for a held file of the enrollment’s deleted party', async () => {
    const { reads, asked } = world();
    expect(
      await reads.heldFileLink(tx, ADMIN, { disputeId: DISPUTE, fileRef: `document:${DOCUMENT}` }),
    ).toEqual(LINK);
    expect(asked).toEqual([
      ['caseRecordOf', DISPUTE],
      ['enrollmentFor', ENROLLMENT],
      ['heldFileLink', [STUDENT, TEACHER], `document:${DOCUMENT}`],
    ]);
  });

  it('a file the port does not mint is NOT_FOUND, its line naming no reference', async () => {
    const { reads, lines } = world({ link: null });
    const error = await refusalOf(
      reads.heldFileLink(tx, ADMIN, { disputeId: DISPUTE, fileRef: 'not-a-reference' }),
    );
    expect(error.code).toBe('NOT_FOUND');
    expect(isRefusalLogged(error)).toBe(true);
    expect(lines.map(({ fields }) => fields)).toEqual([
      {
        adminId: ADMIN,
        disputeId: DISPUTE,
        enrollmentId: ENROLLMENT,
        errorCode: 'NOT_FOUND',
        cause: 'not_held',
      },
    ]);
  });

  it.each(['resolved', 'dismissed'] as const)(
    'a %s dispute is CONFLICT not_open, no link minted',
    async (status) => {
      const { reads, asked } = world({ dispute: record(status) });
      const error = await refusalOf(
        reads.heldFileLink(tx, ADMIN, { disputeId: DISPUTE, fileRef: `document:${DOCUMENT}` }),
      );
      expect(error.code).toBe('CONFLICT');
      expect(error.details).toEqual([{ path: 'cause', code: 'not_open' }]);
      expect(asked).toEqual([['caseRecordOf', DISPUTE]]);
    },
  );

  it('no dispute is NOT_FOUND, no link minted', async () => {
    const { reads, asked } = world({ dispute: null });
    expect(
      (
        await refusalOf(
          reads.heldFileLink(tx, ADMIN, { disputeId: DISPUTE, fileRef: `photo:${STUDENT}` }),
        )
      ).code,
    ).toBe('NOT_FOUND');
    expect(asked).toEqual([['caseRecordOf', DISPUTE]]);
  });
});
