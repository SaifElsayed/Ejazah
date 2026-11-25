// 006:T020 (FR-704, FR-704a; ADR 0024, R-503; B-P4's conflict check): a programme package on the
// teacher's packages tab and in the editor, in Arabic and English. The card draws the subject, the
// track, its three session prices (30, 45 and 60 minutes) and its ongoing enrollments; the groups
// count it; the pause sheet names it. The editor of a programme package shows its subject and track
// as fixed and its three prices in pounds, each with today's share line and its own average
// (`teacher.packages.averagePrice` on the ijazah track and that length, FR-704a), and sends the three
// prices in piasters (`prices`), never a count, a length or a total.
import type { TeacherPackage } from '@ijazah/contracts';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { piasters, teacherShare } from '@ijazah/money';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, type MessageValues, translate } from '../../../i18n';
import { formatNumber, formatPoundAmount, formatPounds } from '../../../lib/formatters';
import { fakeApi } from '../../shared/__tests__/api-double';
import { PackageEditor, Packages } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
const mockNavigate = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => mockNavigate(route),
    replace: (route: unknown) => mockNavigate(route),
    back: () => mockNavigate('back'),
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'package-key-0193a6f0-1' }));

const QURAN = { id: '0193a6f0-0000-7000-8000-0000000000a1', nameAr: 'حفظ القرآن', nameEn: 'Quran' };

const recitation: TeacherPackage = {
  id: '0193a6f0-0000-7000-8000-0000000000b1',
  subject: QURAN,
  track: 'recitation',
  sessionCount: 8,
  sessionDurationMinutes: 45,
  price_piasters: 128_000,
  perSession_piasters: 16_000,
  isActive: true,
  activeEnrollmentCount: 5,
  frozen: true,
};
const programme: TeacherPackage = {
  id: '0193a6f0-0000-7000-8000-0000000000c1',
  subject: QURAN,
  track: 'ijazah_track',
  isProgramme: true,
  prices: { m30_piasters: 15_000, m45_piasters: 20_050, m60_piasters: 25_000 },
  isActive: true,
  activeEnrollmentCount: 3,
  frozen: true,
};
const pausedProgramme: TeacherPackage = {
  ...programme,
  id: '0193a6f0-0000-7000-8000-0000000000c2',
  isActive: false,
  activeEnrollmentCount: 0,
};

const said = (direction: 'rtl' | 'ltr', key: MessageKey, values?: MessageValues) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);
const ar = (key: MessageKey, values?: MessageValues) => translate('ar', key, values);
const localeOf = (direction: 'rtl' | 'ltr') => (direction === 'rtl' ? 'ar' : 'en');
const pounds = (direction: 'rtl' | 'ltr', amount: number) =>
  formatPounds(piasters(amount), localeOf(direction));
const amountOf = (direction: 'rtl' | 'ltr', amount: number) =>
  formatPoundAmount(piasters(amount), localeOf(direction));
const named = (direction: 'rtl' | 'ltr') => (direction === 'rtl' ? QURAN.nameAr : QURAN.nameEn);

let queries: QueryClient;
const withQueries = (ui: () => ReactElement) => () => (
  <QueryClientProvider client={queries}>{ui()}</QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  mockApi.api.teacher.packages.list.query.mockResolvedValue({
    published: true,
    packages: [recitation, programme, pausedProgramme],
  });
  mockApi.api.teacher.packages.averagePrice.query.mockImplementation(async (input?: unknown) => {
    const { track, sessionDurationMinutes } = input as {
      track: string;
      sessionDurationMinutes: number;
    };
    if (track !== 'ijazah_track') return {};
    return { averagePerSession_piasters: sessionDurationMinutes * 500 };
  });
  mockApi.api.teacher.packages.update.mutate.mockResolvedValue(programme);
  mockNavigate.mockReset();
  mockParams = {};
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('the programme package on the tab', () => {
  it('draws its card: the subject, the track, its three prices and its ongoing enrollments; the groups count it', async () => {
    await inBothDirections(
      withQueries(() => <Packages />),
      async (_rendered, direction) => {
        expect(
          await screen.findByText(said(direction, 'teacher.packages.activeGroup', { count: 2 })),
        ).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'teacher.packages.pausedGroup', { count: 1 })),
        ).toBeTruthy();
        expect(screen.getAllByText(named(direction))).toHaveLength(3);
        expect(screen.getAllByText(said(direction, 'programme.teacher.package.line'))).toHaveLength(
          2,
        );
        expect(screen.getAllByText(said(direction, 'common.track.ijazahTrack'))).toHaveLength(2);
        for (const [minutes, amount] of [
          [30, 15_000],
          [45, 20_050],
          [60, 25_000],
        ] as const) {
          expect(
            screen.getAllByText(said(direction, 'common.format.duration', { minutes })),
          ).toHaveLength(2);
          expect(screen.getAllByText(pounds(direction, amount))).toHaveLength(2);
        }
        expect(screen.getByText(formatNumber(3, localeOf(direction)))).toBeTruthy();
        expect(
          screen.getAllByRole('button', { name: said(direction, 'common.action.edit') }),
        ).toHaveLength(3);
        expect(
          screen.getAllByRole('button', { name: said(direction, 'teacher.packages.activate') }),
        ).toHaveLength(1);
      },
    );
  });

  it('pauses a programme package through its sheet, which names it', async () => {
    await renderIn('rtl', withQueries(() => <Packages />)());
    await fireEvent.press(
      (await screen.findAllByRole('button', { name: ar('teacher.packages.deactivate') }))[1]!,
    );
    expect(
      screen.getByText(
        ar('teacher.packages.deactivateSheet.title', {
          package: ar('programme.teacher.package.short', { subject: QURAN.nameAr }),
        }),
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(ar('teacher.packages.deactivateSheet.text', { count: 3 })),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: ar('teacher.packages.deactivateSheet.confirm') }),
    );
    await waitFor(() =>
      expect(mockApi.api.teacher.packages.update.mutate).toHaveBeenCalledWith({
        packageId: programme.id,
        isActive: false,
      }),
    );
  });
});

describe('the programme package in the editor (FR-704, FR-704a)', () => {
  const typeIn = async (direction: 'rtl' | 'ltr', minutes: number, text: string) =>
    fireEvent.changeText(
      screen.getByLabelText(said(direction, 'programme.teacher.package.price', { minutes })),
      text,
    );
  const save = (direction: 'rtl' | 'ltr' = 'rtl') =>
    screen.getByRole('button', { name: said(direction, 'teacher.packages.editor.save') });

  it('shows the subject and track as fixed, the three prices in pounds, each with its share and its own average', async () => {
    mockParams = { id: programme.id };
    await inBothDirections(
      withQueries(() => <PackageEditor />),
      async (_rendered, direction) => {
        expect(await screen.findByText(named(direction))).toBeTruthy();
        expect(screen.getByText(said(direction, 'common.track.ijazahTrack'))).toBeTruthy();
        expect(
          screen.queryByLabelText(said(direction, 'teacher.packages.editor.sessionCount')),
        ).toBeNull();
        expect(
          screen.queryByLabelText(said(direction, 'teacher.packages.editor.totalPrice')),
        ).toBeNull();
        for (const [minutes, typed, amount] of [
          [30, '150', 15_000],
          [45, '200.50', 20_050],
          [60, '250', 25_000],
        ] as const) {
          expect(
            screen.getByLabelText(said(direction, 'programme.teacher.package.price', { minutes }))
              .props.value,
          ).toBe(typed);
          expect(
            await screen.findByText(
              said(direction, 'money.packageEditor.averagePrice', {
                amount: amountOf(direction, minutes * 500),
              }),
            ),
          ).toBeTruthy();
          expect(
            screen.getByText(
              said(direction, 'money.packageEditor.teacherShare', {
                amount: amountOf(direction, teacherShare(piasters(amount), 70)),
                percent: 70,
              }),
            ),
          ).toBeTruthy();
        }
        expect(
          screen.getByText(said(direction, 'programme.teacher.package.editNote')),
        ).toBeTruthy();
      },
    );
    for (const minutes of [30, 45, 60]) {
      expect(mockApi.api.teacher.packages.averagePrice.query).toHaveBeenCalledWith({
        track: 'ijazah_track',
        sessionDurationMinutes: minutes,
      });
    }
  });

  it('sends the three prices in piasters and nothing else, then goes back', async () => {
    mockParams = { id: programme.id };
    await renderIn('rtl', withQueries(() => <PackageEditor />)());
    await screen.findByText(QURAN.nameAr);
    await typeIn('rtl', 30, '١٦٠');
    await typeIn('rtl', 60, '300.25');
    await fireEvent.press(save());
    await waitFor(() =>
      expect(mockApi.api.teacher.packages.update.mutate).toHaveBeenCalledWith({
        packageId: programme.id,
        prices: { m30_piasters: 16_000, m45_piasters: 20_050, m60_piasters: 30_025 },
      }),
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('back'));
  });

  it('cannot send a price of zero or with a third decimal, and says so under its field', async () => {
    mockParams = { id: programme.id };
    await renderIn('rtl', withQueries(() => <PackageEditor />)());
    await screen.findByText(QURAN.nameAr);
    await typeIn('rtl', 45, '0');
    expect(screen.getByText(ar('teacher.packages.editor.error.price'))).toBeTruthy();
    expect(save().props.accessibilityState).toMatchObject({ disabled: true });
    await typeIn('rtl', 45, '1.234');
    expect(save().props.accessibilityState).toMatchObject({ disabled: true });
    await typeIn('rtl', 45, '210');
    expect(save().props.accessibilityState).not.toMatchObject({ disabled: true });
  });
});
