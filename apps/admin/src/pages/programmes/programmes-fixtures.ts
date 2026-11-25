// 006:T021: the `/programmes` specs' fake client and rows. Every procedure the page calls is a mock
// the case answers (`app-harness.tsx`); the rows are the contract's (`admin/programme.ts`). A row's
// time is set from the clock now, so «how late» reads a known number of days.
import { addHours } from '@ijazah/time';

import { mutation, query, renderApp } from '../../test/app-harness';

export const E1 = '0193a6f0-0000-7000-8000-0000000000e1';
export const E2 = '0193a6f0-0000-7000-8000-0000000000e2';
export const R1 = '0193a6f0-0000-7000-8000-0000000000c1';
export const R2 = '0193a6f0-0000-7000-8000-0000000000c2';
export const O_ASSESSMENT = '0193a6f0-0000-7000-8000-0000000000f1';
export const O_MONTH = '0193a6f0-0000-7000-8000-0000000000f2';
export const ADMIN = '0193a6f0-0000-7000-8000-0000000000a1';

const HOURS_PER_DAY = 24;

/** An instant `days` days and an hour before now (the package's arithmetic, R-TIME-1). */
export function daysAgo(days: number): string {
  return addHours(new Date(), -(days * HOURS_PER_DAY + 1));
}

export const teacher = { displayName: 'المعلمة سارة' };
export const student = { displayName: 'Huda Samir' };

type Kind = 'stop' | 'no_offer' | 'pay_blocked' | 'charge_unknown';

export function requestOf(kind: Kind, more: Record<string, unknown> = {}) {
  return {
    requestId: R1,
    kind,
    status: 'open',
    createdAt: daysAgo(3),
    ...more,
  };
}

export function rowOf(kind: Kind | 'paused', more: Record<string, unknown> = {}) {
  return {
    enrollmentId: E1,
    teacher,
    student,
    state: kind === 'pay_blocked' ? 'offered' : kind === 'no_offer' ? 'awaiting_offer' : 'paused',
    pausedSince: kind === 'paused' || kind === 'stop' ? daysAgo(9) : null,
    request: kind === 'paused' ? null : requestOf(kind),
    payeeVerifiedNow: kind === 'pay_blocked' ? false : null,
    ...more,
  };
}

export function detailOf(more: Record<string, unknown> = {}) {
  return {
    enrollmentId: E1,
    teacher,
    student,
    state: 'paused',
    offerDueAt: null,
    payBy: null,
    offer: {
      level: 'يحفظ عشرة أجزاء',
      readiness: 'جاهز بعد المراجعة',
      expectedLength: 'عشرة أشهر',
      durationMinutes: 60,
      sessionCount: 40,
      total_piasters: 1_000_000,
      sessionPrice_piasters: 25_000,
      offeredAt: daysAgo(40),
    },
    plan: 'monthly',
    monthsPaid: 3,
    monthCount: 10,
    nextDueAt: daysAgo(1),
    pausedAt: daysAgo(9),
    closedAt: null,
    orders: [
      {
        paymentId: O_ASSESSMENT,
        kind: 'assessment',
        status: 'paid',
        automatic: false,
        createdAt: daysAgo(45),
      },
      {
        paymentId: O_MONTH,
        kind: 'instalment',
        instalmentMonth: 4,
        status: 'failed',
        automatic: true,
        declineKind: 'soft',
        createdAt: daysAgo(10),
      },
    ],
    requests: [],
    cardSaved: true,
    ...more,
  };
}

/** The settings the extensions read their hours from. */
export const SETTINGS = [
  { key: 'programme_offer_hours', value: 24 },
  { key: 'programme_pay_rest_hours', value: 48 },
].map((one) => ({
  ...one,
  default: one.value,
  bounds: { shape: 'number', value: { min: 1, minExclusive: false, max: 168 } },
  unit: 'hours',
  group: 'booking',
  srsRow: '§3.14',
}));

export function fakeApi() {
  const api = {
    programmes: { queue: query(), get: query(), decide: mutation(), reopen: mutation() },
    settings: { list: query() },
    cases: { openManual: mutation() },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.programmes.queue.query.mockResolvedValue({ items: [] });
  api.programmes.get.query.mockResolvedValue(detailOf());
  api.settings.list.query.mockResolvedValue({ items: SETTINGS });
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

export type FakeApi = ReturnType<typeof fakeApi>;

const verified = { token: 't', step: 'verified' } as const;

export function openPage(api: FakeApi = fakeApi(), at = '/programmes') {
  return { ...renderApp({ at, session: verified, api }), api };
}
