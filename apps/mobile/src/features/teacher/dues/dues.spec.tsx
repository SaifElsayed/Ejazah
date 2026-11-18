// 003:T105 (SRS DEC-89; the note under T105): «مستحقاتي», in both directions, as
// `teacher.dues.get` answers it. Two totals on top, held and paid; one row per part (a recitation
// package, the ijazah half and rest, a close's release) with its amount and state: held with when it
// falls due («لو مفيش شكوى»), or waiting for an open complaint; due, awaiting the administration;
// paid with its date. «عليه»: his own share of each refund, with the reason when one is given. No
// order line and no student's name, even one a server sent by mistake.
import { type Piasters, piasters } from '@ijazah/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import { formatDate, formatPounds, formatTime } from '../../../lib/formatters';
import { fakeApi, type Procedure } from '../../shared/__tests__/api-double';
import { TeacherDues } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => mockNavigate(route),
    back: () => mockNavigate('back'),
    canGoBack: () => true,
  },
}));

jest.mock('../../../lib/time-zone', () => ({ deviceTimeZone: () => 'Africa/Cairo' }));

const ZONE = 'Africa/Cairo';
const HELD_AT = '2026-11-20T18:00:00.000Z';
const DUE_AT = '2026-11-10T18:00:00.000Z';
const PAID_AT = '2026-11-05T09:30:00.000Z';
const STUDENT = 'آمال علي';

const me = {
  userId: '0193a6f0-0000-7000-8000-000000000002',
  role: 'teacher' as const,
  displayName: 'أحمد سالم',
  email: 'ahmed@example.com',
  gender: 'male' as const,
  dateOfBirth: '1980-01-01',
  preferredLanguage: 'ar' as const,
  timezone: ZONE,
  signInMethod: 'google' as const,
  memberSince: '2026-01-10T09:00:00Z',
  accountStatus: 'active' as const,
  landing: 'teacher_home' as const,
  teacher: {
    applicationStatus: 'approved' as const,
    verificationStatus: 'approved' as const,
    payout: { configured: true, verified: true },
  },
};

const dues = {
  held_piasters: 700_000,
  paid_piasters: 315_000,
  releases: [
    {
      part: 'ijazah_half',
      amount_piasters: 175_000,
      state: 'held',
      fallsDueAt: HELD_AT,
      waitsForCase: false,
    },
    { part: 'ijazah_end', amount_piasters: 525_000, state: 'held', waitsForCase: true },
    {
      part: 'recitation_end',
      amount_piasters: 490_000,
      state: 'due',
      fallsDueAt: DUE_AT,
      waitsForCase: false,
    },
    {
      part: 'teacher_dropout',
      amount_piasters: 210_000,
      state: 'paid',
      fallsDueAt: '2026-11-02T18:00:00.000Z',
      waitsForCase: false,
      paidAt: PAID_AT,
    },
    {
      part: 'student_complaint_close',
      amount_piasters: 105_000,
      state: 'paid',
      fallsDueAt: '2026-11-01T18:00:00.000Z',
      waitsForCase: false,
      paidAt: '2026-11-04T09:30:00.000Z',
    },
  ],
  deductions: [{ share_piasters: 63_000, caseReason: 'teacher_ended' }, { share_piasters: 31_550 }],
};

const said = (
  direction: 'rtl' | 'ltr',
  key: MessageKey,
  values?: Record<string, string | number>,
) => translate(direction === 'rtl' ? 'ar' : 'en', key, values);
const localeOf = (direction: 'rtl' | 'ltr') => (direction === 'rtl' ? 'ar' : 'en');
const pounds = (direction: 'rtl' | 'ltr', amount_piasters: Piasters) =>
  formatPounds(amount_piasters, localeOf(direction));

let get: Procedure;
let queries: QueryClient;
const withQueries = (ui: () => ReactElement) => () => (
  <QueryClientProvider client={queries}>{ui()}</QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  mockApi.api.account.me.query.mockResolvedValue(me);
  get = jest.fn(async () => undefined) as Procedure;
  // `teacher.dues` is this feature's alone, so the shared double does not carry it.
  Object.assign(mockApi.api.teacher, { dues: { get: { query: get } } });
  get.mockResolvedValue(dues);
  mockNavigate.mockReset();
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});

describe('TeacherDues («مستحقاتي»)', () => {
  it('draws its title, its line and the two totals, held and paid, and reads its own dues', async () => {
    await inBothDirections(
      withQueries(() => <TeacherDues />),
      async (_rendered, direction) => {
        expect(await screen.findByText(said(direction, 'money.dues.title'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'money.dues.lede'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'money.dues.totals.held'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'money.dues.totals.paid'))).toBeTruthy();
        expect(screen.getByText(pounds(direction, piasters(700_000)))).toBeTruthy();
        expect(screen.getByText(pounds(direction, piasters(315_000)))).toBeTruthy();
      },
    );
    expect(get).toHaveBeenCalledWith({});
  });

  it('draws one row per part with its amount and state: held with when, held for a complaint, due, paid with its date', async () => {
    await inBothDirections(
      withQueries(() => <TeacherDues />),
      async (_rendered, direction) => {
        const locale = localeOf(direction);
        expect(await screen.findByText(said(direction, 'money.dues.part.ijazahHalf'))).toBeTruthy();
        for (const part of [
          'ijazahEnd',
          'recitationEnd',
          'teacherDropout',
          'studentComplaintClose',
        ] as const) {
          expect(screen.getByText(said(direction, `money.dues.part.${part}`))).toBeTruthy();
        }
        for (const amount_piasters of [175_000, 525_000, 490_000, 210_000, 105_000]) {
          expect(screen.getByText(pounds(direction, piasters(amount_piasters)))).toBeTruthy();
        }
        expect(
          screen.getByText(
            said(direction, 'money.dues.heldUntil', {
              date: formatDate(HELD_AT, ZONE, locale),
              time: formatTime(HELD_AT, ZONE, locale),
            }),
          ),
        ).toBeTruthy();
        expect(screen.getByText(said(direction, 'money.dues.heldWaitsForCase'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'money.dues.dueAwaiting'))).toBeTruthy();
        expect(
          screen.getByText(
            said(direction, 'money.dues.paidOn', { date: formatDate(PAID_AT, ZONE, locale) }),
          ),
        ).toBeTruthy();
        expect(screen.getAllByText(said(direction, 'money.dues.state.held'))).toHaveLength(2);
        expect(screen.getAllByText(said(direction, 'money.dues.state.due'))).toHaveLength(1);
        expect(screen.getAllByText(said(direction, 'money.dues.state.paid'))).toHaveLength(2);
      },
    );
  });

  it('says a held part with no date yet falls due after the last session’s complaint window', async () => {
    get.mockResolvedValue({
      ...dues,
      releases: [
        { part: 'recitation_end', amount_piasters: 490_000, state: 'held', waitsForCase: false },
      ],
    });
    await renderIn('rtl', withQueries(() => <TeacherDues />)());
    expect(await screen.findByText(said('rtl', 'money.dues.heldAfterLast'))).toBeTruthy();
  });

  it('draws «عليه»: his own share of each refund, with the reason when one is given', async () => {
    await inBothDirections(
      withQueries(() => <TeacherDues />),
      async (_rendered, direction) => {
        expect(await screen.findByText(said(direction, 'money.dues.deductionsTitle'))).toBeTruthy();
        expect(screen.getByText(pounds(direction, piasters(63_000)))).toBeTruthy();
        expect(screen.getByText(pounds(direction, piasters(31_550)))).toBeTruthy();
        expect(
          screen.getAllByText(
            said(direction, 'money.dues.reasonLine', {
              reason: said(direction, 'money.dues.reason.teacherEnded'),
            }),
          ),
        ).toHaveLength(1);
      },
    );
  });

  it('draws no student’s name and no order, even one the server sent', async () => {
    get.mockResolvedValue({
      ...dues,
      releases: dues.releases.map((release) => ({
        ...release,
        student: { displayName: STUDENT },
        paymentId: '0193a6f0-0000-7000-8000-0000000000f1',
      })),
      deductions: dues.deductions.map((deduction) => ({
        ...deduction,
        student: { displayName: STUDENT },
      })),
    });
    await renderIn('rtl', withQueries(() => <TeacherDues />)());
    expect(await screen.findByText(said('rtl', 'money.dues.part.ijazahHalf'))).toBeTruthy();
    expect(screen.queryByText(STUDENT, { exact: false })).toBeNull();
    expect(screen.queryByText('0193a6f0-0000-7000-8000-0000000000f1', { exact: false })).toBeNull();
  });

  it('says so when nothing is owed yet', async () => {
    get.mockResolvedValue({ held_piasters: 0, paid_piasters: 0, releases: [], deductions: [] });
    await renderIn('rtl', withQueries(() => <TeacherDues />)());
    expect(await screen.findByText(said('rtl', 'money.dues.empty.title'))).toBeTruthy();
    expect(screen.getByText(said('rtl', 'money.dues.deductionsEmpty'))).toBeTruthy();
  });

  it('goes back from its header', async () => {
    await renderIn('rtl', withQueries(() => <TeacherDues />)());
    await screen.findByText(said('rtl', 'money.dues.title'));
    await fireEvent.press(screen.getByRole('button', { name: said('rtl', 'common.a11y.back') }));
    expect(mockNavigate).toHaveBeenCalledWith('back');
  });
});
