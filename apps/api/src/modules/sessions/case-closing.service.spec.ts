// T035 of specs/004-sessions/tasks.md (FR-422, FR-478; research R-312, R-322; contracts/admin-surface.md,
// `cases.resolve` and `cases.dismiss`; the notes under T035) — `createCaseClosing` over a recorded
// store:
//
//   - a compensation case resolved is closed `resolved` with `compensation_ordered`, dismissed is
//     closed `dismissed` with no resolution, each with the note and the administrator, through
//     moderation's `closeCase` (the enrollment's lock and the one conditional update are
//     `tests/db-integrity/case-closing.spec.ts`');
//   - refused NOT_FOUND, writing nothing: no such case, a session dispute, and a complaint, which
//     `cases.decideComplaint` alone decides (R-322); refused CONFLICT with `details.cause`
//     `not_open` when the case is no longer open (`closeCase` answering null; the note under T035,
//     Q2); each refusal logged once with ids and its reason, marked «logged»;
//   - no completion check (the note under T035, F9).
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { CaseClosing, CaseRecord } from '../moderation/index.js';
import { type CaseClosingStore, createCaseClosing } from './case-closing.service.js';

const tx = {} as Transaction;
const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
const CASE = '0199d0a0-0000-7000-8000-000000000500';
const ENROLLMENT = '0199d0a0-0000-7000-8000-000000000800';
const CLOSED_AT = new Date('2026-11-11T09:00:00.123Z');

function record(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    caseId: CASE,
    kind: 'compensation_case',
    enrollmentId: ENROLLMENT,
    reason: 'refund_choice',
    status: 'open',
    resolution: null,
    resolutionNotes: null,
    createdAt: new Date('2026-11-01T10:00:00Z'),
    resolvedAt: null,
    ...overrides,
  };
}

function closingOver(found: CaseRecord | null, closes = true) {
  const closings: [string, CaseClosing][] = [];
  const lines: unknown[] = [];
  const store: CaseClosingStore = {
    caseRecordOf: async () => found,
    closeCase: async (_tx, caseId, closing) => {
      closings.push([caseId, closing]);
      return closes ? CLOSED_AT : null;
    },
  };
  const log = { info: (fields: unknown) => lines.push(fields) };
  return { closing: createCaseClosing({ log, store }), closings, lines };
}

async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error('expected a DomainError');
  return thrown;
}

describe('cases.resolve and cases.dismiss close a compensation case (FR-422)', () => {
  it('resolves it with compensation_ordered, the note and the administrator', async () => {
    const { closing, closings, lines } = closingOver(record());
    expect(await closing.resolve(tx, ADMIN, { caseId: CASE, note: 'أُعيد المبلغ' })).toEqual({
      caseId: CASE,
      status: 'resolved',
    });
    expect(closings).toEqual([
      [
        CASE,
        { status: 'resolved', resolution: 'compensation_ordered', note: 'أُعيد المبلغ', adminId: ADMIN },
      ],
    ]);
    expect(lines).toEqual([]);
  });

  it('dismisses it with no resolution, the note and the administrator', async () => {
    const { closing, closings } = closingOver(record({ reason: 'party_restricted' }));
    expect(await closing.dismiss(tx, ADMIN, { caseId: CASE, note: 'لا شيء مستحق' })).toEqual({
      caseId: CASE,
      status: 'dismissed',
    });
    expect(closings).toEqual([
      [CASE, { status: 'dismissed', resolution: null, note: 'لا شيء مستحق', adminId: ADMIN }],
    ]);
  });
});

describe('the refusals, each writing nothing and logged once', () => {
  it.each([
    ['no such case', null, 'not_found'],
    ['a session dispute', record({ kind: 'session_dispute' }), 'not_found'],
    ['a complaint (T060 decides it)', record({ kind: 'absence_complaint', reason: 'نص' }), 'complaint'],
  ] as const)('refuses %s NOT_FOUND on both', async (_name, found, reason) => {
    for (const close of ['resolve', 'dismiss'] as const) {
      const { closing, closings, lines } = closingOver(found);
      const refusal = await refusalOf(closing[close](tx, ADMIN, { caseId: CASE, note: 'n' }));
      expect(refusal.code).toBe('NOT_FOUND');
      expect(isRefusalLogged(refusal)).toBe(true);
      expect(closings).toEqual([]);
      expect(lines).toEqual([{ adminId: ADMIN, caseId: CASE, errorCode: 'NOT_FOUND', reason }]);
    }
  });

  it.each(['resolve', 'dismiss'] as const)(
    'refuses %s on a case no longer open CONFLICT, details.cause not_open (Q2)',
    async (close) => {
      const { closing, lines } = closingOver(record({ status: 'resolved' }), false);
      const refusal = await refusalOf(closing[close](tx, ADMIN, { caseId: CASE, note: 'n' }));
      expect(refusal.code).toBe('CONFLICT');
      expect(refusal.details).toEqual([{ path: 'cause', code: 'not_open' }]);
      expect(isRefusalLogged(refusal)).toBe(true);
      expect(lines).toEqual([
        {
          adminId: ADMIN,
          caseId: CASE,
          enrollmentId: ENROLLMENT,
          errorCode: 'CONFLICT',
          reason: 'not_open',
        },
      ]);
    },
  );
});
