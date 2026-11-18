// T073 (FR-175): the audit log against its board (`AdminAudit`), through the router, in both
// languages. The last thirty days by default, in the panel's zone, as a chip that removes itself;
// the search in the stored label and the reason, sent once the typing stops; the table with the
// time, the administrator, the action as the panel names it (the raw action when it names none),
// the target by its current name and the reason; the pager the page size answers; the selected
// entry's detail with what changed, its reason and its number; the empty log and a log that could
// not be read.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { getLocale, setLocale, translate, type MessageKey } from '../../i18n';
import { cityName, dayMonth, dayMonthYear, timeOfDay } from '../../lib/format';
import { daysBefore, panelTimeZone, todayIn } from '../../lib/zone';
import { currentPath, inBothLocales, query, refusal, renderApp } from '../../test/app-harness';
import { actionText, targetText } from './actions';

afterEach(() => setLocale('ar'));

const USER = '0193a6f0-0000-7000-8000-00000000000a';
const CREDENTIAL = '0193a6f0-0000-7000-8000-0000000000c1';
const SUSPEND = '0193a6f0-0000-7000-8000-0000000000e1';
const APPROVE = '0193a6f0-0000-7000-8000-0000000000e2';
const ODD = '0193a6f0-0000-7000-8000-0000000000e3';

const suspended = {
  entryId: SUSPEND,
  occurredAt: '2026-10-15T08:20:00.000Z',
  adminName: 'سارة عادل',
  action: 'teacher.suspend',
  targetLabel: `مستخدم · ${USER}`,
  targetName: 'الشيخ ياسر حمدي',
  targetType: 'user',
  targetId: USER,
  reason: 'بلاغات متكررة',
} as const;
const approved = {
  entryId: APPROVE,
  occurredAt: '2026-10-14T14:40:00.000Z',
  adminName: 'سارة عادل',
  action: 'credential.approve',
  targetLabel: `إجازة · ${CREDENTIAL}`,
  targetType: 'credential',
  targetId: CREDENTIAL,
} as const;
const odd = {
  entryId: ODD,
  occurredAt: '2026-10-13T10:00:00.000Z',
  adminName: 'منى',
  action: 'probe.future_action',
  targetLabel: 'إعداد · x',
  targetType: 'setting',
  targetId: 'x',
} as const;

function fakeApi() {
  const api = {
    audit: { list: query(), get: query() },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.audit.list.query.mockResolvedValue({
    rows: [suspended, approved, odd],
    total: 3,
    pageSize: 25,
  });
  api.audit.get.query.mockResolvedValue({
    ...suspended,
    before: { accountStatus: 'active' },
    after: { accountStatus: 'suspended' },
  });
  api.home.summary.query.mockResolvedValue({
    queues: {
      applications: { open: 0, waitingOnApplicant: 0 },
      credentials: { open: 0, addedSubjects: 0 },
    },
    latestActions: [],
  });
  api.auth.me.query.mockResolvedValue({ adminId: 'a', displayName: 'سارة عادل', email: 's@x.io' });
  return api;
}

const verified = { token: 't', step: 'verified' } as const;
const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);

function open(api = fakeApi(), { strict = false } = {}) {
  return { ...renderApp({ at: '/audit', session: verified, api, strict }), api };
}

describe('AdminAudit (FR-175)', () => {
  it('draws the last thirty days in both languages: the chip, the table, its footer', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        const zone = panelTimeZone();
        expect(await screen.findByText(t('admin.audit.lede'))).toBeTruthy();
        expect(
          screen.getByRole('button', { name: t('admin.audit.a11y.removeDateFilter') }).textContent,
        ).toBe(t('admin.audit.dateFilterChip', { days: 30 }));
        expect(await screen.findByText(t('admin.audit.actions.teacherSuspend'))).toBeTruthy();
        for (const column of ['time', 'admin', 'action', 'target', 'reason'] as const) {
          expect(
            screen.getByRole('columnheader', { name: t(`admin.audit.columns.${column}`) }),
          ).toBeTruthy();
        }
        expect(screen.getByText(dayMonth(suspended.occurredAt, locale, zone))).toBeTruthy();
        expect(screen.getByText(timeOfDay(suspended.occurredAt, locale, zone))).toBeTruthy();
        expect(
          screen.getByText(
            t('admin.audit.targetNamed', {
              type: t('admin.audit.targets.user'),
              name: suspended.targetName,
            }),
          ),
        ).toBeTruthy();
        expect(screen.getByText(suspended.reason)).toBeTruthy();
        expect(screen.getByText(t('admin.audit.actions.approveTeacherCredential'))).toBeTruthy();
        expect(screen.getByText('probe.future_action')).toBeTruthy();
        expect(
          screen.getByText(
            t('admin.audit.pagerSummary', {
              shown: 3,
              total: 3,
              days: 30,
              city: cityName(zone, locale),
            }),
          ),
        ).toBeTruthy();
      },
    );
  });

  // T111: the long text columns are not cut at the table's edge: the target wraps, as the board
  // draws it, and the reason ends in an ellipsis after two lines with its full text on hover.
  it('wraps the target and clips the reason, its full text on hover (T111)', async () => {
    open();
    const reason = await screen.findByText(suspended.reason);
    expect(reason.parentElement?.className).toBe('table__clip');
    expect(reason.parentElement?.getAttribute('title')).toBe(suspended.reason);
    const target = screen.getByText(
      ar('admin.audit.targetNamed', {
        type: ar('admin.audit.targets.user'),
        name: suspended.targetName,
      }),
    );
    expect(target.closest('td')?.className).toBe('table__wrap');
  });

  it('reads the first page of the last thirty days in the panel’s zone, once in strict mode', async () => {
    const { api } = open(fakeApi(), { strict: true });
    await screen.findByText(ar('admin.audit.actions.teacherSuspend'));
    const zone = panelTimeZone();
    const today = todayIn(zone);
    expect(api.audit.list.query).toHaveBeenCalledTimes(1);
    expect(api.audit.list.query).toHaveBeenCalledWith({
      from: daysBefore(today, 29),
      to: today,
      timeZone: zone,
      page: 1,
    });
  });

  it('reads the whole log once the chip is removed, and searches once the typing stops', async () => {
    const { api } = open();
    await screen.findByText(ar('admin.audit.actions.teacherSuspend'));
    fireEvent.click(screen.getByRole('button', { name: ar('admin.audit.a11y.removeDateFilter') }));
    await waitFor(() => expect(api.audit.list.query).toHaveBeenLastCalledWith({ page: 1 }));
    expect(
      await screen.findByText(
        ar('admin.audit.pagerSummaryAll', {
          shown: 3,
          total: 3,
          city: cityName(panelTimeZone(), 'ar'),
        }),
      ),
    ).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(ar('admin.audit.search.placeholder')), {
      target: { value: '  بلاغات ' },
    });
    await waitFor(() =>
      expect(api.audit.list.query).toHaveBeenLastCalledWith({ search: 'بلاغات', page: 1 }),
    );
  });

  it('opens an entry: what changed, its reason, its number', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        const zone = panelTimeZone();
        const cells = await screen.findAllByText(t('admin.audit.actions.teacherSuspend'));
        fireEvent.click(cells.map((cell) => cell.closest('tr')).find(Boolean) as HTMLElement);
        const detail = within(
          await screen.findByRole('complementary', { name: t('admin.audit.a11y.detail') }),
        );
        const target = t('admin.audit.targetNamed', {
          type: t('admin.audit.targets.user'),
          name: suspended.targetName,
        });
        expect(
          await detail.findByText(
            t('admin.audit.detail.title', {
              action: t('admin.audit.actions.teacherSuspend'),
              target,
            }),
          ),
        ).toBeTruthy();
        expect(
          detail.getByText(
            t('admin.audit.detail.meta', {
              date: dayMonthYear(suspended.occurredAt, locale, zone),
              time: timeOfDay(suspended.occurredAt, locale, zone),
              admin: suspended.adminName,
            }),
          ),
        ).toBeTruthy();
        expect(detail.getByText(t('admin.audit.fields.accountStatus'))).toBeTruthy();
        expect(detail.getByText(t('admin.status.account.active'))).toBeTruthy();
        expect(detail.getByText(t('admin.status.account.suspended'))).toBeTruthy();
        expect(detail.getByText(suspended.reason)).toBeTruthy();
        expect(detail.getByText(SUSPEND)).toBeTruthy();
        expect(detail.getByText(t('admin.audit.detail.footer'))).toBeTruthy();
      },
    );
  });

  it('draws a revoked approval as its badges, never as the stored word (B14d-1 review)', async () => {
    const api = fakeApi();
    api.audit.get.query.mockResolvedValue({
      ...suspended,
      action: 'teacher.revoke',
      before: { verificationStatus: 'approved' },
      after: { verificationStatus: 'revoked' },
    });
    open(api);
    const cells = await screen.findAllByText(ar('admin.audit.actions.teacherSuspend'));
    fireEvent.click(cells.map((cell) => cell.closest('tr')).find(Boolean) as HTMLElement);
    const detail = within(
      await screen.findByRole('complementary', { name: ar('admin.audit.a11y.detail') }),
    );
    expect(await detail.findByText(ar('admin.audit.values.verification.revoked'))).toBeTruthy();
    expect(detail.getByText(ar('admin.audit.values.verification.approved'))).toBeTruthy();
    expect(detail.queryByText('revoked')).toBeNull();
  });

  // T116 (c): an application decision's status reads as the application's state, never the
  // credential's; its reasons as the dialog's; a value with no word as stored (owner, 2026-10-29).
  async function detailOf(entry: Record<string, unknown>) {
    const api = fakeApi();
    api.audit.get.query.mockResolvedValue({ ...suspended, ...entry });
    open(api);
    const cells = await screen.findAllByText(ar('admin.audit.actions.teacherSuspend'));
    fireEvent.click(cells.map((cell) => cell.closest('tr')).find(Boolean) as HTMLElement);
    return within(
      await screen.findByRole('complementary', { name: ar('admin.audit.a11y.detail') }),
    );
  }

  it('reads an application approval as the application’s states, not the credential’s', async () => {
    const detail = await detailOf({
      action: 'application.approve',
      before: { status: 'in_review' },
      after: { status: 'approved', subjectIds: ['01a18400-0000-7000-8000-0000000000aa'] },
    });
    expect(await detail.findByText(ar('admin.status.application.inReview'))).toBeTruthy();
    expect(detail.getByText(ar('admin.status.application.approved'))).toBeTruthy();
    expect(detail.queryByText(ar('admin.status.credential.verified'))).toBeNull();
    expect(detail.queryByText('in_review')).toBeNull();
  });

  it('reads a decision’s reasons as the dialog names them, and an unknown value as stored', async () => {
    const rejected = await detailOf({
      action: 'application.reject',
      before: { status: 'needs_document' },
      after: { status: 'rejected', reasonChoice: 'name_mismatch' },
    });
    expect(
      await rejected.findByText(ar('admin.dialogs.decision.reasons.nameMismatch')),
    ).toBeTruthy();
    expect(rejected.getByText(ar('admin.status.application.waitingOnApplicant'))).toBeTruthy();
    expect(rejected.getByText(ar('admin.status.application.rejected'))).toBeTruthy();
    cleanup();
    const asked = await detailOf({
      action: 'application.request_info',
      before: { status: 'in_review' },
      after: { status: 'needs_document', needed: ['id_unclear', 'future_need'] },
    });
    expect(
      await asked.findByText(
        `${ar('admin.dialogs.decision.requestInfo.reasons.idUnclear')}، future_need`,
      ),
    ).toBeTruthy();
    cleanup();
    const banned = await detailOf({
      action: 'application.ban',
      before: { status: 'in_review' },
      after: { status: 'banned', reasonChoice: 'forged_documents' },
    });
    expect(await banned.findByText(ar('admin.status.application.banned'))).toBeTruthy();
    expect(banned.getByText(ar('admin.dialogs.decision.ban.reasons.forgedDocuments'))).toBeTruthy();
  });

  // T155: a credential's request for another file names the application it set waiting, and an
  // older request's retired reason keeps its words.
  it('reads the application a document request moved, and a retired reason of an older entry', async () => {
    const requested = await detailOf({
      action: 'credential.request_document',
      before: { applicationStatus: 'in_review' },
      after: { applicationStatus: 'needs_document' },
    });
    expect(await requested.findByText(ar('admin.audit.fields.applicationStatus'))).toBeTruthy();
    expect(requested.getByText(ar('admin.status.application.inReview'))).toBeTruthy();
    expect(requested.getByText(ar('admin.status.application.waitingOnApplicant'))).toBeTruthy();
    expect(requested.queryByText('needs_document')).toBeNull();
    cleanup();
    const older = await detailOf({
      action: 'application.request_info',
      before: { status: 'in_review' },
      after: { status: 'needs_document', needed: ['ijazah_unreadable'] },
    });
    expect(
      await older.findByText(ar('admin.audit.values.retiredReasons.ijazahUnreadable')),
    ).toBeTruthy();
    expect(older.queryByText('ijazah_unreadable')).toBeNull();
  });

  it('links a credential’s entry to its credential', async () => {
    open();
    const link = await screen.findByRole('link', { name: ar('admin.audit.targets.credential') });
    fireEvent.click(link);
    await waitFor(() => expect(currentPath()).toBe(`/credentials?credential=${CREDENTIAL}`));
  });

  // T052, T053: the monitor's `payments.viewed` names the order it opened, linked to the monitor.
  it('names a payment order’s view and links it to the payments monitor', async () => {
    const ORDER = '0193a6f0-0000-7000-8000-0000000000f1';
    const api = fakeApi();
    api.audit.list.query.mockResolvedValue({
      rows: [
        {
          entryId: '0193a6f0-0000-7000-8000-0000000000e9',
          occurredAt: '2026-11-04T10:00:00.000Z',
          adminName: 'سارة عادل',
          action: 'payments.viewed',
          targetLabel: `طلب دفع · ${ORDER}`,
          targetType: 'payment',
          targetId: ORDER,
        },
      ],
      total: 1,
      pageSize: 25,
    });
    open(api);
    expect(await screen.findByText(ar('admin.audit.actions.paymentsViewed'))).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: ar('admin.audit.targets.payment') }));
    await waitFor(() => expect(currentPath()).toBe(`/payments?payment=${ORDER}`));
  });

  it('says an empty period, an empty log, and a log that could not be read', async () => {
    const api = fakeApi();
    api.audit.list.query.mockResolvedValue({ rows: [], total: 0, pageSize: 25 });
    open(api);
    expect(await screen.findByText(ar('admin.audit.empty.title'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ar('admin.audit.a11y.removeDateFilter') }));
    expect(await screen.findByText(ar('admin.audit.emptyAll.title'))).toBeTruthy();
    api.audit.list.query.mockRejectedValue(refusal('INTERNAL'));
    fireEvent.change(screen.getByPlaceholderText(ar('admin.audit.search.placeholder')), {
      target: { value: 'x' },
    });
    expect(
      await screen.findByText(
        ar('admin.common.loadError.title', { page: ar('admin.audit.title') }),
      ),
    ).toBeTruthy();
    expect(getLocale()).toBe('ar');
  });
});

// T002 of specs/004-sessions (contracts/admin-surface.md, "The audit actions' names"; the owner's
// decision of 2026-11-06 on the sixth analysis, M3): each of the twenty-eight actions Phase 3
// records is named by the catalogue's text, never the stored code, in Arabic and in English.
const PHASE_3_ACTIONS: readonly (readonly [string, string, string])[] = [
  ['sessions.monitor.listed', 'عرض الاشتراكات', 'View enrollments'],
  ['sessions.monitor.viewed', 'عرض اشتراك', 'View an enrollment'],
  ['sessions.review.listed', 'عرض قائمة المراجعة', 'View the review queue'],
  ['sessions.review.viewed', 'عرض بيانات اتصال جلسة', "View a session's connection record"],
  ['provider_outages.listed', 'عرض انقطاعات الفيديو', 'View video outages'],
  ['disputes.listed', 'عرض النزاعات', 'View disputes'],
  ['dispute.viewed', 'عرض نزاع', 'View a dispute'],
  ['cases.listed', 'عرض القضايا والشكاوى', 'View cases and complaints'],
  ['case.viewed', 'عرض قضية أو شكوى', 'View a case or complaint'],
  ['users.listed', 'عرض المستخدمين', 'View users'],
  ['user.viewed', 'عرض مستخدم', 'View a user'],
  ['chat.read', 'قراءة محادثة نزاع', "Read a dispute's chat"],
  ['dispute.held_files_listed', 'عرض الملفات المحفوظة لنزاع', "View a dispute's held files"],
  ['held_file.view', 'عرض ملف محفوظ', 'View a held file'],
  ['session.cancelled', 'إلغاء جلسة', 'Cancel a session'],
  ['enrollment.restored', 'استعادة اشتراك', 'Restore an enrollment'],
  ['session.review_resolved', 'حسم مراجعة جلسة', 'Settle a session under review'],
  ['session.outcome_corrected', 'تصحيح نتيجة جلسة', "Correct a session's outcome"],
  ['provider_outage.recorded', 'تسجيل انقطاع الفيديو', 'Record a video outage'],
  ['dispute.resolved', 'الفصل في نزاع', 'Resolve a dispute'],
  ['dispute.revised', 'مراجعة حكم نزاع', "Revise a dispute's ruling"],
  ['case.resolved', 'حلّ قضية', 'Resolve a case'],
  ['case.dismissed', 'رفض قضية', 'Dismiss a case'],
  ['case.opened_manually', 'فتح قضية تعويض يدويًا', 'Open a compensation case manually'],
  ['complaint.decided', 'البتّ في شكوى غياب المعلم', "Decide a complaint of a teacher's absence"],
  ['student.suspend', 'إيقاف طالب', 'Suspend student'],
  ['student.ban', 'حظر طالب', 'Ban student'],
  ['student.reinstate', 'إعادة تفعيل طالب', 'Reinstate student'],
];

describe('the Phase 3 actions by name (T002 of specs/004-sessions, M3)', () => {
  it('holds the twenty-eight actions of admin-surface.md’s table', () => {
    expect(new Set(PHASE_3_ACTIONS.map(([action]) => action)).size).toBe(28);
  });

  it.each(PHASE_3_ACTIONS)(
    '%s reads «%s» and "%s", never the stored code',
    (action, arText, enText) => {
      expect(actionText(action, (key: MessageKey) => translate('ar', key))).toBe(arText);
      expect(actionText(action, (key: MessageKey) => translate('en', key))).toBe(enText);
    },
  );

  it.each([
    ['enrollment', 'اشتراك', 'Enrollment'],
    ['dispute', 'نزاع أو قضية', 'Dispute or case'],
    ['session', 'جلسة', 'Session'],
    ['provider_outage', 'انقطاع الفيديو', 'Video outage'],
  ] as const)('names the new target type %s «%s» and "%s"', (targetType, arText, enText) => {
    const row = { targetType };
    expect(targetText(row, (key: MessageKey) => translate('ar', key))).toBe(arText);
    expect(targetText(row, (key: MessageKey) => translate('en', key))).toBe(enText);
  });
});

// B42b, T075 of specs/004-sessions (the follow-ups under T070 and T072): B42a's four new actions,
// T070's release and T072's three lifts, named by the catalogue's text in Arabic and in English, as
// admin-surface.md's table names the lifts; the release's row is the integration's (Q-R9).
const B42A_ACTIONS: readonly (readonly [string, string, string])[] = [
  ['enrollment.slot_released', 'تحرير موعد اشتراك', "Release an enrollment's slot"],
  ['student.ban_lifted', 'رفع حظر طالب', "Lift a student's ban"],
  ['teacher.ban_lifted', 'رفع حظر معلم أو متقدم', "Lift a teacher's or an applicant's ban"],
  ['teacher.revocation_lifted', 'إلغاء سحب اعتماد معلم', "Lift a teacher's revocation"],
];

describe('T075: the release’s and the lifts’ actions by name', () => {
  it.each(B42A_ACTIONS)(
    '%s reads «%s» and "%s", never the stored code',
    (action, arText, enText) => {
      expect(actionText(action, (key: MessageKey) => translate('ar', key))).toBe(arText);
      expect(actionText(action, (key: MessageKey) => translate('en', key))).toBe(enText);
    },
  );
});

// B42c, T083 of specs/004-sessions (Q-R7 (a)): B42c's six new actions, T082's direct end, T077's
// three on a deleted teacher's kept data and its document's opening, and T081's deletion at the
// owner's request, named by the catalogue's text in Arabic and in English; admin-surface.md's rows
// and count are the integration's.
const B42C_ACTIONS: readonly (readonly [string, string, string])[] = [
  ['enrollment.ended_by_admin', 'إنهاء اشتراك', 'End an enrollment'],
  ['kept_document.view', 'عرض وثيقة محفوظة لمعلم محذوف', "View a deleted teacher's kept document"],
  [
    'teacher.kept_data.erase_date_set',
    'تحديد موعد محو بيانات معلم محذوف',
    "Set the erase date of a deleted teacher's kept data",
  ],
  [
    'teacher.kept_data.erase_date_cleared',
    'إلغاء موعد محو بيانات معلم محذوف',
    "Clear the erase date of a deleted teacher's kept data",
  ],
  [
    'teacher.kept_data.erased',
    'محو البيانات المحفوظة لمعلم محذوف',
    "Erase a deleted teacher's kept data",
  ],
  ['user.deleted_by_admin', 'حذف حساب بطلب صاحبه', "Delete an account at its owner's request"],
];

describe('T083: B42c’s six actions by name', () => {
  it.each(B42C_ACTIONS)(
    '%s reads «%s» and "%s", never the stored code',
    (action, arText, enText) => {
      expect(actionText(action, (key: MessageKey) => translate('ar', key))).toBe(arText);
      expect(actionText(action, (key: MessageKey) => translate('en', key))).toBe(enText);
    },
  );
});

describe('T058: RATE_LIMITED on the audit log', () => {
  it('the list says when to try again', async () => {
    const api = fakeApi();
    api.audit.list.query.mockRejectedValue(
      refusal('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '61' }]),
    );
    open(api);
    expect(await screen.findByText(ar('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
    expect(screen.queryByText(ar('admin.common.loadError.text'))).toBeNull();
  });

  it('an entry says to wait a little when no time is given', async () => {
    const api = fakeApi();
    api.audit.get.query.mockRejectedValue(refusal('RATE_LIMITED'));
    open(api);
    const cells = await screen.findAllByText(ar('admin.audit.actions.teacherSuspend'));
    fireEvent.click(cells.map((cell) => cell.closest('tr')).find(Boolean) as HTMLElement);
    const detail = within(
      await screen.findByRole('complementary', { name: ar('admin.audit.a11y.detail') }),
    );
    expect(await detail.findByText(ar('admin.common.rateLimited'))).toBeTruthy();
    expect(detail.queryByText(ar('admin.common.loadError.text'))).toBeNull();
  });
});

// 005:T011 (B47; FR-612; contracts/admin-surface.md, `reports.*`): the reports queue's three
// actions, named by the catalogue's text in Arabic and in English.
const B47_REPORT_ACTIONS: readonly (readonly [string, string, string])[] = [
  ['reports.listed', 'عرض البلاغات', 'View reports'],
  ['report.viewed', 'عرض بلاغ', 'View a report'],
  ['report.resolved', 'البتّ في بلاغ', 'Resolve a report'],
];

describe('005:T011: the reports queue’s actions by name', () => {
  it.each(B47_REPORT_ACTIONS)(
    '%s reads «%s» and "%s", never the stored code',
    (action, arText, enText) => {
      expect(actionText(action, (key: MessageKey) => translate('ar', key))).toBe(arText);
      expect(actionText(action, (key: MessageKey) => translate('en', key))).toBe(enText);
    },
  );
});

describe('005:T011: a report as an audit target', () => {
  it('names the target type user_report «بلاغ» and "Report"', () => {
    const row = { targetType: 'user_report' as const };
    expect(targetText(row, (key: MessageKey) => translate('ar', key))).toBe('بلاغ');
    expect(targetText(row, (key: MessageKey) => translate('en', key))).toBe('Report');
  });
});

// 005:T013 (B47; FR-614, FR-615; contracts/admin-surface.md, `genderFlags.*`): the gender-flag
// queue's four actions, named by the catalogue's text in Arabic and in English (T083's per-action
// pattern). Each is audited on the flagged person (`user`), so no new target type.
const B47_GENDER_FLAG_ACTIONS: readonly (readonly [string, string, string])[] = [
  ['gender_flags.listed', 'عرض بلاغات الجنس', 'View gender flags'],
  ['gender_flag.viewed', 'عرض بلاغ جنس', 'View a gender flag'],
  ['gender_flag.raised', 'رفع بلاغ جنس', 'Raise a gender flag'],
  ['gender_flag.dismissed', 'رفض بلاغ جنس', 'Dismiss a gender flag'],
];

describe('005:T013: the gender-flag queue’s actions by name', () => {
  it.each(B47_GENDER_FLAG_ACTIONS)(
    '%s reads «%s» and "%s", never the stored code',
    (action, arText, enText) => {
      expect(actionText(action, (key: MessageKey) => translate('ar', key))).toBe(arText);
      expect(actionText(action, (key: MessageKey) => translate('en', key))).toBe(enText);
    },
  );
});
