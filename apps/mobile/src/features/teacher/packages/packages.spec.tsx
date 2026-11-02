// T021 (FR-311, FR-312, FR-315): the teacher's packages against the boards (screens.md §13), in
// both languages. The tab groups the packages into active and paused; with the payout account not
// verified each active package carries «غير منشورة» and a banner leads to the payout; with none the
// empty state. The editor creates and edits a package: a subject among the approved ones only, a
// track, a count of one to 52, a length of 30, 45 or 60 minutes and a price typed in pounds and sent
// in piasters; a frozen package shows its track and length as fixed and never sends them. A package
// is paused through its sheet and activated in place. The API's two refusals are said plainly.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { piasters } from '@ijazah/money';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, type MessageValues, translate } from '../../../i18n';
import { formatPoundAmount, formatPounds } from '../../../lib/formatters';
import { apiError, fakeApi } from '../../shared/__tests__/api-double';
import { PackageEditor, Packages, PackagesEmpty, PackagesLocked } from './index';

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

let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `package-key-0193a6f0-${++mockKey}` }));

const QURAN = {
  id: '0193a6f0-0000-7000-8000-0000000000a1',
  nameAr: 'حفظ القرآن',
  nameEn: 'Quran memorization',
};
const TAJWEED = {
  id: '0193a6f0-0000-7000-8000-0000000000a2',
  nameAr: 'التجويد',
  nameEn: 'Tajweed',
};
const QIRAAT = { id: '0193a6f0-0000-7000-8000-0000000000a3', nameAr: 'القراءات', nameEn: 'Qiraat' };

const recitation = {
  id: '0193a6f0-0000-7000-8000-0000000000b1',
  subject: QURAN,
  track: 'recitation',
  sessionCount: 8,
  sessionDurationMinutes: 45,
  price_piasters: 120_000,
  perSession_piasters: 15_000,
  isActive: true,
  activeEnrollmentCount: 5,
  frozen: true,
};
const ijazahTrack = {
  id: '0193a6f0-0000-7000-8000-0000000000b2',
  subject: QURAN,
  track: 'ijazah_track',
  sessionCount: 12,
  sessionDurationMinutes: 60,
  price_piasters: 216_000,
  perSession_piasters: 18_000,
  isActive: true,
  activeEnrollmentCount: 0,
  frozen: false,
};
const paused = {
  id: '0193a6f0-0000-7000-8000-0000000000b3',
  subject: QURAN,
  track: 'ijazah_track',
  sessionCount: 8,
  sessionDurationMinutes: 45,
  price_piasters: 120_000,
  perSession_piasters: 15_000,
  isActive: false,
  activeEnrollmentCount: 0,
  frozen: false,
};

const credential = (subject: typeof QURAN, status: string, suffix: string) => ({
  credentialId: `0193a6f0-0000-7000-8000-0000000000${suffix}`,
  subject,
  status,
  submittedAt: '2026-10-21T09:00:00.000Z',
  document: {},
});

const said = (direction: 'rtl' | 'ltr', key: MessageKey, values?: MessageValues) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);
const ar = (key: MessageKey, values?: MessageValues) => translate('ar', key, values);
const named = (direction: 'rtl' | 'ltr', subject: typeof QURAN) =>
  direction === 'rtl' ? subject.nameAr : subject.nameEn;
const pounds = (direction: 'rtl' | 'ltr', amount: number) =>
  formatPounds(piasters(amount), direction === 'rtl' ? 'ar' : 'en');
const amountOf = (direction: 'rtl' | 'ltr', amount: number) =>
  formatPoundAmount(piasters(amount), direction === 'rtl' ? 'ar' : 'en');

let queries: QueryClient;
const withQueries = (ui: () => ReactElement) => () => (
  <QueryClientProvider client={queries}>{ui()}</QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  mockApi.api.teacher.packages.list.query.mockResolvedValue({
    published: true,
    packages: [recitation, ijazahTrack, paused],
  });
  mockApi.api.teacher.packages.create.mutate.mockResolvedValue(ijazahTrack);
  mockApi.api.teacher.packages.update.mutate.mockResolvedValue(ijazahTrack);
  mockApi.api.teacher.credentials.list.query.mockResolvedValue([
    credential(QURAN, 'approved', 'c1'),
    credential(TAJWEED, 'pending', 'c2'),
    credential(QIRAAT, 'rejected', 'c3'),
  ]);
  mockNavigate.mockReset();
  mockParams = {};
  mockKey = 0;
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('Packages', () => {
  it('draws the active group with its tiles and the paused group with its line, and no «غير منشورة» once published', async () => {
    await inBothDirections(
      withQueries(() => <Packages />),
      async (_rendered, direction) => {
        expect(
          await screen.findByText(said(direction, 'teacher.packages.activeGroup', { count: 2 })),
        ).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'teacher.packages.pausedGroup', { count: 1 })),
        ).toBeTruthy();
        expect(screen.getAllByText(named(direction, QURAN))).toHaveLength(3);
        expect(
          screen.getByText(said(direction, 'common.format.packageLine', { count: 8, minutes: 45 })),
        ).toBeTruthy();
        expect(screen.getAllByText(said(direction, 'common.track.recitation'))).toHaveLength(1);
        expect(screen.getAllByText(said(direction, 'common.track.ijazahTrack'))).toHaveLength(2);
        expect(screen.getAllByText(said(direction, 'teacher.packages.price'))).toHaveLength(2);
        expect(screen.getByText(pounds(direction, 120_000))).toBeTruthy();
        expect(screen.getByText(pounds(direction, 15_000))).toBeTruthy();
        expect(screen.getByText(pounds(direction, 18_000))).toBeTruthy();
        expect(screen.getByText('5')).toBeTruthy();
        expect(
          screen.getByText(
            said(direction, 'common.format.packageLineWithPrice', {
              count: 8,
              minutes: 45,
              amount: amountOf(direction, 120_000),
            }),
          ),
        ).toBeTruthy();
        expect(
          screen.getAllByRole('button', { name: said(direction, 'common.action.edit') }),
        ).toHaveLength(3);
        expect(
          screen.getAllByRole('button', { name: said(direction, 'teacher.packages.deactivate') }),
        ).toHaveLength(2);
        expect(
          screen.getAllByRole('button', { name: said(direction, 'teacher.packages.activate') }),
        ).toHaveLength(1);
        expect(screen.queryByText(said(direction, 'status.package.unpublished'))).toBeNull();
        expect(screen.queryByText(said(direction, 'teacher.packages.lockedBanner'))).toBeNull();
      },
    );
  });

  it('opens the editor for a new package and for one of the list', async () => {
    await renderIn('rtl', withQueries(() => <Packages />)());
    await fireEvent.press(await screen.findByRole('button', { name: ar('teacher.packages.new') }));
    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/(teacher)/packages/[id]',
      params: { id: 'new' },
    });
    await fireEvent.press(screen.getAllByRole('button', { name: ar('common.action.edit') })[1]!);
    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/(teacher)/packages/[id]',
      params: { id: ijazahTrack.id },
    });
  });

  it('marks each active package «غير منشورة» and leads from the banner to the payout while unpublished (FR-315)', async () => {
    mockApi.api.teacher.packages.list.query.mockResolvedValue({
      published: false,
      packages: [recitation, ijazahTrack, paused],
    });
    await inBothDirections(
      withQueries(() => <Packages />),
      async (_rendered, direction) => {
        expect(
          await screen.findByText(said(direction, 'teacher.packages.lockedBanner')),
        ).toBeTruthy();
        expect(screen.getAllByText(said(direction, 'status.package.unpublished'))).toHaveLength(2);
        // The locked cards draw one line with the price, no tiles.
        expect(screen.queryByText(said(direction, 'teacher.packages.perSession'))).toBeNull();
        expect(
          screen.getByText(
            said(direction, 'common.format.packageLineWithPrice', {
              count: 12,
              minutes: 60,
              amount: amountOf(direction, 216_000),
            }),
          ),
        ).toBeTruthy();
      },
    );
    await renderIn('rtl', withQueries(() => <Packages />)());
    await fireEvent.press(await screen.findByText(ar('teacher.packages.lockedBanner')));
    expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/payout');
  });

  it('draws the empty state with the header’s «باقة جديدة» as its one action', async () => {
    mockApi.api.teacher.packages.list.query.mockResolvedValue({ published: true, packages: [] });
    await inBothDirections(
      withQueries(() => <Packages />),
      async (_rendered, direction) => {
        expect(
          await screen.findByText(said(direction, 'teacher.packages.empty.title')),
        ).toBeTruthy();
        expect(screen.getByText(said(direction, 'teacher.packages.empty.text'))).toBeTruthy();
        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(screen.queryByText(said(direction, 'teacher.packages.lockedBanner'))).toBeNull();
      },
    );
  });

  it('draws the banner over the empty state while unpublished', async () => {
    mockApi.api.teacher.packages.list.query.mockResolvedValue({ published: false, packages: [] });
    await renderIn('rtl', withQueries(() => <Packages />)());
    expect(await screen.findByText(ar('teacher.packages.lockedBanner'))).toBeTruthy();
    expect(screen.getByText(ar('teacher.packages.empty.title'))).toBeTruthy();
  });

  it('draws the states as their own exports, in both directions', async () => {
    await inBothDirections(
      () => <PackagesEmpty />,
      (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'teacher.packages.empty.title'))).toBeTruthy();
      },
    );
    await inBothDirections(
      () => <PackagesLocked />,
      (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'teacher.packages.lockedBanner'))).toBeTruthy();
      },
    );
  });

  it('activates a paused package in place and reads the list again', async () => {
    await renderIn('rtl', withQueries(() => <Packages />)());
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('teacher.packages.activate') }),
    );
    await waitFor(() =>
      expect(mockApi.api.teacher.packages.update.mutate).toHaveBeenCalledWith({
        packageId: paused.id,
        isActive: true,
      }),
    );
    await waitFor(() => expect(mockApi.api.teacher.packages.list.query).toHaveBeenCalledTimes(2));
  });

  it('pauses a package only through its sheet, which names it and its ongoing enrollments', async () => {
    await inBothDirections(
      withQueries(() => <Packages />),
      async (_rendered, direction) => {
        await fireEvent.press(
          (
            await screen.findAllByRole('button', {
              name: said(direction, 'teacher.packages.deactivate'),
            })
          )[0]!,
        );
        expect(
          await screen.findByText(
            said(direction, 'teacher.packages.deactivateSheet.title', {
              package: said(direction, 'common.format.packageShort', {
                subject: named(direction, QURAN),
                count: 8,
              }),
            }),
          ),
        ).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'teacher.packages.deactivateSheet.text', { count: 5 })),
        ).toBeTruthy();
        await fireEvent.press(
          screen.getByRole('button', { name: said(direction, 'common.action.cancel') }),
        );
      },
    );
    expect(mockApi.api.teacher.packages.update.mutate).not.toHaveBeenCalled();

    await renderIn('rtl', withQueries(() => <Packages />)());
    await fireEvent.press(
      (await screen.findAllByRole('button', { name: ar('teacher.packages.deactivate') }))[0]!,
    );
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('teacher.packages.deactivateSheet.confirm') }),
    );
    await waitFor(() =>
      expect(mockApi.api.teacher.packages.update.mutate).toHaveBeenCalledWith({
        packageId: recitation.id,
        isActive: false,
      }),
    );
  });

  // The owner's decision of 2026-11-02 (B26): with no ongoing enrollment, the sheet says nothing of
  // enrollments.
  it('leaves the enrollments line out of the sheet when none is ongoing', async () => {
    await inBothDirections(
      withQueries(() => <Packages />),
      async (_rendered, direction) => {
        await fireEvent.press(
          (
            await screen.findAllByRole('button', {
              name: said(direction, 'teacher.packages.deactivate'),
            })
          )[1]!,
        );
        expect(
          await screen.findByText(
            said(direction, 'teacher.packages.deactivateSheet.textNoEnrollments'),
          ),
        ).toBeTruthy();
        expect(
          screen.queryByText(
            said(direction, 'teacher.packages.deactivateSheet.text', { count: 0 }),
          ),
        ).toBeNull();
        await fireEvent.press(
          screen.getByRole('button', { name: said(direction, 'common.action.cancel') }),
        );
      },
    );
    expect(mockApi.api.teacher.packages.update.mutate).not.toHaveBeenCalled();
  });

  it('says so and offers a retry when the list cannot be read', async () => {
    mockApi.api.teacher.packages.list.query.mockRejectedValue(apiError('INTERNAL'));
    await renderIn('rtl', withQueries(() => <Packages />)());
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
  });
});

describe('PackageEditor and PackageSubjectPicker', () => {
  const save = (direction: 'rtl' | 'ltr' = 'rtl') =>
    screen.getByRole('button', { name: said(direction, 'teacher.packages.editor.save') });
  const typeIn = async (direction: 'rtl' | 'ltr', label: MessageKey, text: string) =>
    fireEvent.changeText(screen.getByLabelText(said(direction, label)), text);

  it('offers the approved subjects only, with the entry to add a subject', async () => {
    mockParams = { id: 'new' };
    await inBothDirections(
      withQueries(() => <PackageEditor />),
      async (_rendered, direction) => {
        expect(
          await screen.findByText(said(direction, 'teacher.packages.editor.newTitle')),
        ).toBeTruthy();
        await fireEvent.press(
          screen.getByRole('button', { name: said(direction, 'teacher.packages.editor.subject') }),
        );
        expect(
          await screen.findByText(said(direction, 'teacher.packages.editor.subjectPicker.title')),
        ).toBeTruthy();
        expect(await screen.findByText(named(direction, QURAN))).toBeTruthy();
        expect(screen.queryByText(named(direction, TAJWEED))).toBeNull();
        expect(screen.queryByText(named(direction, QIRAAT))).toBeNull();
        expect(
          screen.getByText(said(direction, 'teacher.packages.editor.subjectPicker.addAnother')),
        ).toBeTruthy();
      },
    );
    await renderIn('rtl', withQueries(() => <PackageEditor />)());
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('teacher.packages.editor.subject') }),
    );
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('common.action.addSubject') }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/credentials/add');
  });

  it('creates a package: 30, 45 or 60, the price typed in pounds and sent in piasters, with its key', async () => {
    mockParams = { id: 'new' };
    await renderIn('rtl', withQueries(() => <PackageEditor />)());
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('teacher.packages.editor.subject') }),
    );
    await fireEvent.press(await screen.findByText(QURAN.nameAr));
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.done') }));
    for (const minutes of [30, 45, 60]) {
      expect(
        screen.getByRole('radio', {
          name: ar('teacher.packages.editor.durationOption', { minutes }),
        }),
      ).toBeTruthy();
    }
    await fireEvent.press(screen.getByRole('radio', { name: ar('common.track.ijazahTrack') }));
    await fireEvent.press(
      screen.getByRole('radio', {
        name: ar('teacher.packages.editor.durationOption', { minutes: 60 }),
      }),
    );
    await typeIn('rtl', 'teacher.packages.editor.sessionCount', '٨');
    await typeIn('rtl', 'teacher.packages.editor.totalPrice', '1200.5');
    expect(
      screen.getByText(
        ar('teacher.packages.editor.perSessionHint', { amount: amountOf('rtl', 15_006) }),
      ),
    ).toBeTruthy();
    await fireEvent.press(save());
    await waitFor(() =>
      expect(mockApi.api.teacher.packages.create.mutate).toHaveBeenCalledWith({
        subjectId: QURAN.id,
        track: 'ijazah_track',
        sessionCount: 8,
        sessionDurationMinutes: 60,
        price_piasters: 120_050,
        isActive: true,
        idempotencyKey: 'package-key-0193a6f0-1',
      }),
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('back'));
  });

  it('cannot send 53 sessions or a price of zero', async () => {
    mockParams = { id: 'new' };
    await renderIn('rtl', withQueries(() => <PackageEditor />)());
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('teacher.packages.editor.subject') }),
    );
    await fireEvent.press(await screen.findByText(QURAN.nameAr));
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.done') }));
    await typeIn('rtl', 'teacher.packages.editor.sessionCount', '53');
    await typeIn('rtl', 'teacher.packages.editor.totalPrice', '1200');
    expect(
      screen.getByText(ar('teacher.packages.editor.error.sessionCount', { min: 1, max: 52 })),
    ).toBeTruthy();
    expect(save().props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(save());
    await typeIn('rtl', 'teacher.packages.editor.sessionCount', '52');
    await typeIn('rtl', 'teacher.packages.editor.totalPrice', '0');
    expect(screen.getByText(ar('teacher.packages.editor.error.price'))).toBeTruthy();
    await fireEvent.press(save());
    expect(mockApi.api.teacher.packages.create.mutate).not.toHaveBeenCalled();
  });

  it('edits a package with no enrollment: its values filled in, the change sent as typed', async () => {
    mockParams = { id: ijazahTrack.id };
    await inBothDirections(
      withQueries(() => <PackageEditor />),
      async (_rendered, direction) => {
        expect(
          await screen.findByText(said(direction, 'teacher.packages.editor.title')),
        ).toBeTruthy();
        expect(
          await screen.findByText(said(direction, 'teacher.packages.editor.editNote')),
        ).toBeTruthy();
        expect(screen.getByDisplayValue('12')).toBeTruthy();
        expect(screen.getByDisplayValue('2160')).toBeTruthy();
        expect(
          screen.queryByText(said(direction, 'teacher.packages.editor.frozenHint')),
        ).toBeNull();
      },
    );
    await renderIn('rtl', withQueries(() => <PackageEditor />)());
    await screen.findByDisplayValue('2160');
    await fireEvent.press(
      screen.getByRole('radio', {
        name: ar('teacher.packages.editor.durationOption', { minutes: 30 }),
      }),
    );
    await typeIn('rtl', 'teacher.packages.editor.totalPrice', '1500');
    await fireEvent.press(save());
    await waitFor(() =>
      expect(mockApi.api.teacher.packages.update.mutate).toHaveBeenCalledWith({
        packageId: ijazahTrack.id,
        sessionCount: 12,
        track: 'ijazah_track',
        sessionDurationMinutes: 30,
        price_piasters: 150_000,
      }),
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('back'));
  });

  it('shows a frozen package’s track and length as fixed and never sends them (FR-312)', async () => {
    mockParams = { id: recitation.id };
    await inBothDirections(
      withQueries(() => <PackageEditor />),
      async (_rendered, direction) => {
        expect(
          await screen.findByText(said(direction, 'teacher.packages.editor.frozenHint')),
        ).toBeTruthy();
        expect(screen.getByText(said(direction, 'common.track.recitation'))).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'common.format.duration', { minutes: 45 })),
        ).toBeTruthy();
        expect(screen.queryByRole('radio')).toBeNull();
      },
    );
    await renderIn('rtl', withQueries(() => <PackageEditor />)());
    await screen.findByDisplayValue('1200');
    await typeIn('rtl', 'teacher.packages.editor.totalPrice', '1300');
    await fireEvent.press(save());
    await waitFor(() =>
      expect(mockApi.api.teacher.packages.update.mutate).toHaveBeenCalledWith({
        packageId: recitation.id,
        sessionCount: 8,
        price_piasters: 130_000,
      }),
    );
  });

  it('says plainly that the subject is not approved, stays, and resends with the same key', async () => {
    mockParams = { id: 'new' };
    mockApi.api.teacher.packages.create.mutate.mockRejectedValueOnce(
      apiError('SUBJECT_NOT_APPROVED'),
    );
    await renderIn('rtl', withQueries(() => <PackageEditor />)());
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('teacher.packages.editor.subject') }),
    );
    await fireEvent.press(await screen.findByText(QURAN.nameAr));
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.done') }));
    await typeIn('rtl', 'teacher.packages.editor.sessionCount', '8');
    await typeIn('rtl', 'teacher.packages.editor.totalPrice', '1200');
    await fireEvent.press(save());
    expect(
      await screen.findByText(ar('teacher.packages.editor.error.subjectNotApproved')),
    ).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalledWith('back');
    await fireEvent.press(save());
    await waitFor(() =>
      expect(mockApi.api.teacher.packages.create.mutate).toHaveBeenCalledTimes(2),
    );
    const keys = mockApi.api.teacher.packages.create.mutate.mock.calls.map(
      ([input]) => (input as { idempotencyKey: string }).idempotencyKey,
    );
    expect(new Set(keys).size).toBe(1);
  });

  it('says plainly that an enrollment has frozen the package, reads it again, and draws the package’s own track and length, not the unsent choice', async () => {
    mockParams = { id: ijazahTrack.id };
    for (const direction of ['rtl', 'ltr'] as const) {
      queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      mockApi.api.teacher.packages.list.query.mockClear();
      mockApi.api.teacher.packages.list.query.mockResolvedValueOnce({
        published: true,
        packages: [recitation, ijazahTrack, paused],
      });
      // The re-read answers the package frozen: an enrollment came in meanwhile (FR-312).
      mockApi.api.teacher.packages.list.query.mockResolvedValueOnce({
        published: true,
        packages: [recitation, { ...ijazahTrack, frozen: true, activeEnrollmentCount: 1 }, paused],
      });
      mockApi.api.teacher.packages.update.mutate.mockRejectedValueOnce(apiError('PACKAGE_FROZEN'));
      await renderIn(direction, withQueries(() => <PackageEditor />)());
      await screen.findByDisplayValue('2160');
      // The unsent choice: the other track and 30 minutes, where the package is the ijazah track of
      // 60 minutes.
      await fireEvent.press(
        screen.getByRole('radio', { name: said(direction, 'common.track.recitation') }),
      );
      await fireEvent.press(
        screen.getByRole('radio', {
          name: said(direction, 'teacher.packages.editor.durationOption', { minutes: 30 }),
        }),
      );
      await fireEvent.press(save(direction));
      expect(
        await screen.findByText(said(direction, 'teacher.packages.editor.error.frozen')),
      ).toBeTruthy();
      expect(mockNavigate).not.toHaveBeenCalledWith('back');
      await waitFor(() => expect(mockApi.api.teacher.packages.list.query).toHaveBeenCalledTimes(2));
      expect(
        await screen.findByText(said(direction, 'teacher.packages.editor.frozenHint')),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'common.track.ijazahTrack'))).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'common.format.duration', { minutes: 60 })),
      ).toBeTruthy();
      expect(screen.queryByText(said(direction, 'common.track.recitation'))).toBeNull();
      expect(
        screen.queryByText(said(direction, 'common.format.duration', { minutes: 30 })),
      ).toBeNull();
      expect(screen.queryByRole('radio')).toBeNull();
    }
  });
});
