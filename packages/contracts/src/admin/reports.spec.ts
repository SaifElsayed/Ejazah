// T011 of specs/005-certification — the administrator's `reports` schemas of
// contracts/admin-surface.md (FR-612; research R-408; the note under T011, Q-R3 (a)). Written before
// the schemas, and run red first.
//
// `list` takes an optional status (the queue's `open` unless said) and a report id as its cursor,
// and answers each report's context and the session or enrollment it came from (the evidence
// links); `get` adds the reporter's reason and, once resolved, the outcome, the note and when;
// `resolve` is keyed, takes `actioned` or `dismissed` and a note (stored in `resolution_notes`), and
// is refused `already_resolved` once the report is no longer open.
import { describe, expect, it } from 'vitest';

import { isIdempotentProcedure } from '../idempotent-procedures.js';
import {
  adminReportsGetInput,
  adminReportsGetOutput,
  adminReportsListInput,
  adminReportsListOutput,
  adminReportsResolveInput,
  reportOutcome,
  reportResolveRefusal,
  reportStatus,
} from './reports.js';

const REPORT = '0199d0a0-0000-7000-8000-0000000000f1';
const REPORTER = '0199d0a0-0000-7000-8000-0000000000a1';
const REPORTED = '0199d0a0-0000-7000-8000-0000000000a2';
const SESSION = '0199d0a0-0000-7000-8000-0000000000d1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const ADMIN = '0199d0a0-0000-7000-8000-0000000000b9';
const KEY = 'resolve-key-for-the-spec-0001';

const ITEM = {
  reportId: REPORT,
  context: 'session',
  status: 'open',
  reporterUserId: REPORTER,
  reportedUserId: REPORTED,
  sessionId: SESSION,
  enrollmentId: ENROLLMENT,
  createdAt: '2026-11-18T09:00:00.000Z',
};

describe('reports.list', () => {
  it('takes an optional status and cursor, the queue being the open reports', () => {
    expect(adminReportsListInput.parse({})).toEqual({ status: 'open' });
    expect(adminReportsListInput.parse({ status: 'dismissed', cursor: REPORT })).toEqual({
      status: 'dismissed',
      cursor: REPORT,
    });
  });

  it.each([
    ['an unknown status', { status: 'closed' }],
    ['a cursor that is not an id', { cursor: 'page-2' }],
  ])('refuses %s', (_name, input) => {
    expect(adminReportsListInput.safeParse(input).success).toBe(false);
  });

  it('answers each report with its context and evidence links, the reason left out', () => {
    const page = { items: [ITEM], nextCursor: REPORT };
    expect(adminReportsListOutput.parse(page)).toEqual(page);
    expect(adminReportsListOutput.parse({ items: [{ ...ITEM, reason: 'x' }] })).toEqual({
      items: [ITEM],
    });
    const profile = { ...ITEM, context: 'profile', sessionId: null, enrollmentId: null };
    expect(adminReportsListOutput.parse({ items: [profile] })).toEqual({ items: [profile] });
  });
});

describe('reports.get', () => {
  it('takes the report', () => {
    expect(adminReportsGetInput.parse({ reportId: REPORT })).toEqual({ reportId: REPORT });
    expect(adminReportsGetInput.safeParse({ reportId: 'one' }).success).toBe(false);
  });

  it('answers the reason, and the resolution once there is one', () => {
    const open = { ...ITEM, reason: 'كلام غير لائق', resolution: null };
    expect(adminReportsGetOutput.parse(open)).toEqual(open);
    const resolved = {
      ...ITEM,
      status: 'actioned',
      reason: 'كلام غير لائق',
      resolution: {
        outcome: 'actioned',
        note: 'تم التواصل مع المعلم',
        resolvedAt: '2026-11-18T10:00:00.000Z',
        resolvedByAdminId: ADMIN,
      },
    };
    expect(adminReportsGetOutput.parse(resolved)).toEqual(resolved);
  });
});

describe('reports.resolve', () => {
  it('takes the report, the outcome, a note and a key', () => {
    const input = {
      reportId: REPORT,
      outcome: 'dismissed',
      note: 'لا مخالفة',
      idempotencyKey: KEY,
    };
    expect(adminReportsResolveInput.parse(input)).toEqual(input);
  });

  it.each([
    ['an outcome that is not one', { outcome: 'open' }],
    ['a blank note', { note: '  ' }],
    ['no note', { note: undefined }],
    ['no key', { idempotencyKey: undefined }],
  ])('refuses %s', (_name, change) => {
    const input = {
      reportId: REPORT,
      outcome: 'actioned',
      note: 'تم',
      idempotencyKey: KEY,
      ...change,
    };
    expect(adminReportsResolveInput.safeParse(input).success).toBe(false);
  });

  it('names the statuses, the outcomes and the refusal', () => {
    expect(reportStatus.options).toEqual(['open', 'actioned', 'dismissed']);
    expect(reportOutcome.options).toEqual(['actioned', 'dismissed']);
    expect(reportResolveRefusal.options).toEqual(['already_resolved']);
  });

  it('is keyed', () => {
    expect(isIdempotentProcedure('reports.resolve')).toBe(true);
  });
});
