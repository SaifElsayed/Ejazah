// 003:T112 (SRS FR-POSTPONE-5, FR-POSTPONE-6, DEC-90; Q-2 (a), Q-4 (a)) on `/sessions`, in both
// languages: a postponed session reads «مؤجلة» and its timeline event «أُجّلت الجلسة»; the case the
// end on a complaint against the student opened is named by its reason. The end's dialog offers its
// cause: the direct end (the default, sent as before, with no cause) or «a complaint against the
// student», which says what that close does and is sent as `cause: 'student_complaint_ended'`.
// The panel's other session-status maps (disputes, telemetry) say «مؤجلة» too.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MessageKey, setLocale, translate } from '../../i18n';
import { inBothLocales, mutation, query, renderApp, type Translate } from '../../test/app-harness';
import { SESSION_STATUS as DISPUTE_SESSION_STATUS } from '../disputes/labels';
import { SESSION_STATUS as TELEMETRY_SESSION_STATUS } from '../review/TelemetryPanel';
import { SESSION_STATUS } from './words';

afterEach(() => setLocale('ar'));

const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);
const id = (suffix: string) => `0193a6f0-0000-7000-8000-${suffix.padStart(12, '0')}`;
const E1 = id('e1');
const S1 = id('51');
const S2 = id('52');
const C1 = id('c1');
const RIYADH = 'Asia/Riyadh';

function session(n: number, status: string) {
  const day = String(16 + n).padStart(2, '0');
  return {
    sessionId: [S1, S2][n - 1],
    sequenceNumber: n,
    localDate: `2026-11-${day}`,
    startTimeLocal: '14:00',
    timezone: RIYADH,
    startsAt: `2026-11-${day}T11:00:00.000Z`,
    endsAt: `2026-11-${day}T12:00:00.000Z`,
    status,
    cancellable: status === 'scheduled',
    correctable: false,
  };
}

const detail = {
  enrollment: {
    enrollmentId: E1,
    student: { userId: id('a1'), displayName: 'آمال علي', deleted: false },
    teacher: { userId: id('b1'), displayName: 'المعلمة سارة', deleted: false },
    status: 'confirmed',
    track: 'recitation',
    sessionCount: 2,
    completed: 0,
    remaining: 2,
    teacherNoShows: 0,
    repeatedAbsence: false,
    enrollmentRestoreWindowDays: 14,
  },
  sessions: [session(1, 'postponed'), session(2, 'scheduled')],
  cases: [{ caseId: C1, reason: 'student_complaint_ended', status: 'open' }],
  cancellationRequests: [],
  events: [
    { source: 'session', kind: 'postponed', sessionId: S1, occurredAt: '2026-11-15T09:00:00.000Z' },
  ],
};

function fakeApi() {
  const api = {
    sessions: {
      monitor: { list: query(), get: query() },
      cancel: mutation(),
      restore: mutation(),
      endEnrollment: mutation(),
      review: { revise: mutation() },
    },
    enrollments: { releaseSlot: mutation() },
    cases: { openManual: mutation() },
    payments: { list: query(), get: query() },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.sessions.monitor.list.query.mockResolvedValue({ items: [] });
  api.sessions.monitor.get.query.mockResolvedValue(detail);
  api.sessions.endEnrollment.mutate.mockResolvedValue({
    enrollmentId: E1,
    caseId: C1,
    slot: 'hold',
    cancelledSessions: 1,
  });
  api.home.summary.query.mockResolvedValue({
    queues: {
      applications: { open: 0, waitingOnApplicant: 0 },
      credentials: { open: 0, addedSubjects: 0 },
    },
    latestActions: [],
  });
  api.auth.me.query.mockResolvedValue({ adminId: id('99'), displayName: 'سارة', email: 'a@b.c' });
  return api;
}

const verified = { token: 't', step: 'verified' } as const;
const open = (api = fakeApi()) => ({
  ...renderApp({ at: `/sessions?enrollment=${E1}`, session: verified, api }),
  api,
});

async function panelOf(t: Translate = ar) {
  const aside = await screen.findByRole('complementary', { name: t('admin.sessions.detail.a11y') });
  const panel = within(aside);
  await panel.findByRole('region', { name: t('admin.sessions.detail.sessionsTitle') });
  return panel;
}

async function endDialog(api = fakeApi()) {
  open(api);
  const panel = await panelOf();
  fireEvent.click(panel.getByRole('button', { name: ar('admin.sessions.detail.end') }));
  const dialog = within(
    await screen.findByRole('dialog', { name: ar('admin.sessions.end.title') }),
  );
  fireEvent.change(dialog.getByLabelText(ar('admin.sessions.end.reasonLabel')), {
    target: { value: 'بلاغ المعلم عن الطالب' },
  });
  return { api, dialog };
}

describe('a postponed session on the monitor (003:T112, FR-POSTPONE-5)', () => {
  it('reads «مؤجلة» on its row, «أُجّلت الجلسة» on the timeline, and the case by its reason', async () => {
    await inBothLocales(
      () => open(),
      async (t) => {
        const panel = await panelOf(t);
        const row = within(
          panel.getByRole('listitem', { name: t('admin.sessions.detail.session', { n: 1 }) }),
        );
        expect(row.getByText(t('admin.status.session.postponed'))).toBeTruthy();
        expect(
          panel.getByText(
            t('admin.sessions.event.withSession', {
              event: t('admin.sessions.postponement.event'),
              n: 1,
            }),
          ),
        ).toBeTruthy();
        expect(panel.getByText(t('admin.sessions.endCause.caseReason'))).toBeTruthy();
      },
    );
  });

  it('is «مؤجلة» on the disputes page and in the telemetry too', () => {
    expect(DISPUTE_SESSION_STATUS.postponed).toBe('admin.status.session.postponed');
    expect(TELEMETRY_SESSION_STATUS.postponed.label).toBe('admin.status.session.postponed');
    expect(SESSION_STATUS.postponed.label).toBe('admin.status.session.postponed');
  });
});

describe('the end’s cause (003:T112, FR-POSTPONE-6, Q-4 (a))', () => {
  it('offers the direct end, chosen, and the complaint against the student, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t) => {
        const panel = await panelOf(t);
        fireEvent.click(panel.getByRole('button', { name: t('admin.sessions.detail.end') }));
        const dialog = within(
          await screen.findByRole('dialog', { name: t('admin.sessions.end.title') }),
        );
        const group = within(
          dialog.getByRole('group', { name: t('admin.sessions.endCause.legend') }),
        );
        expect(
          group.getByRole('radio', { name: t('admin.sessions.endCause.adminEnded') }),
        ).toHaveProperty('checked', true);
        expect(
          group.getByRole('radio', { name: t('admin.sessions.endCause.studentComplaintEnded') }),
        ).toHaveProperty('checked', false);
        expect(dialog.queryByText(t('admin.sessions.endCause.studentComplaintEffect'))).toBeNull();
      },
    );
  });

  it('sends the direct end as before, with no cause', async () => {
    const { api, dialog } = await endDialog();
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.sessions.end.confirm') }));
    await waitFor(() => expect(api.sessions.endEnrollment.mutate).toHaveBeenCalledTimes(1));
    expect(api.sessions.endEnrollment.mutate.mock.calls[0]?.[0]).not.toHaveProperty('cause');
  });

  it('sends the complaint against the student as its cause, once it says what that close does', async () => {
    const { api, dialog } = await endDialog();
    fireEvent.click(
      dialog.getByRole('radio', { name: ar('admin.sessions.endCause.studentComplaintEnded') }),
    );
    expect(dialog.getByText(ar('admin.sessions.endCause.studentComplaintEffect'))).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.sessions.end.confirm') }));
    await waitFor(() => expect(api.sessions.endEnrollment.mutate).toHaveBeenCalledTimes(1));
    expect(api.sessions.endEnrollment.mutate).toHaveBeenCalledWith({
      enrollmentId: E1,
      partyReason: 'بلاغ المعلم عن الطالب',
      slot: 'hold',
      cause: 'student_complaint_ended',
      idempotencyKey: expect.stringMatching(/^[\w-]{16,128}$/u),
    });
  });
});
