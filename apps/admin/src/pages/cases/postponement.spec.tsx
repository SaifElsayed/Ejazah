// 003:T112 (SRS FR-POSTPONE-5, FR-POSTPONE-6, DEC-90; Q-2 (a), Q-4 (a)): a case's page, in both
// languages, names a case the administrator's end on a complaint against the student opened
// (`student_complaint_ended`) in its own words, and a covered postponed session by «مؤجلة».
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { setLocale } from '../../i18n';
import { inBothLocales, mutation, query, renderApp } from '../../test/app-harness';

afterEach(() => setLocale('ar'));

const id = (n: number) => `0193a6f0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ENROLLMENT = id(901);
const CASE = id(11);
const ADMIN = id(99);

function fakeApi() {
  const api = {
    cases: {
      list: query(),
      get: query(),
      resolve: mutation(),
      dismiss: mutation(),
      decideComplaint: mutation(),
      openManual: mutation(),
    },
    payments: { caseAmount: query() },
    disputes: { heldFiles: query(), heldFileLink: mutation() },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.cases.list.query.mockResolvedValue({ items: [] });
  api.cases.get.query.mockResolvedValue({
    case: {
      caseId: CASE,
      kind: 'compensation_case',
      enrollmentId: ENROLLMENT,
      reason: 'student_complaint_ended',
      status: 'open',
      openedAt: '2026-11-19T09:00:00.000Z',
    },
    enrollment: {
      enrollmentId: ENROLLMENT,
      student: { userId: id(51), displayName: 'عبد الله حسن', deleted: false },
      teacher: { userId: id(52), displayName: 'Sara Adel', deleted: false },
      status: 'cancelled',
      track: 'recitation',
      teacherNoShows: 0,
      repeatedAbsence: false,
    },
    covers: [{ sessionId: id(501), sequenceNumber: 4, status: 'postponed' }],
    paymentsLink: { enrollmentId: ENROLLMENT },
  });
  api.payments.caseAmount.query.mockResolvedValue({});
  api.home.summary.query.mockResolvedValue({
    queues: {
      applications: { open: 0, waitingOnApplicant: 0 },
      credentials: { open: 0, addedSubjects: 0 },
    },
    latestActions: [],
  });
  api.auth.me.query.mockResolvedValue({ adminId: ADMIN, displayName: 'سارة عادل', email: 'a@b.c' });
  return api;
}

const verified = { token: 't', step: 'verified' } as const;

describe('a case of the end on a complaint against the student (003:T112, Q-4 (a))', () => {
  it('names the case by its reason, and a covered postponed session by «مؤجلة»', async () => {
    await inBothLocales(
      () => ({
        view: renderApp({ at: `/cases?case=${CASE}`, session: verified, api: fakeApi() }).view,
      }),
      async (t) => {
        expect(await screen.findByText(t('admin.cases.reason.studentComplaintEnded'))).toBeTruthy();
        expect(await screen.findByText(t('admin.status.session.postponed'))).toBeTruthy();
      },
    );
  });
});
