// T030 (FR-336, screens.md §4): the teacher's profile as a student sees it, in both languages. It
// shows the name, the gender, the photo when one is set, the bio, the qualification, the subjects,
// the rating line or the no-reviews line, and each active package with its track, the track's
// remedy line (ADR 0018 D2), the session length, the total and the price per session drawn in
// pounds from piasters. It never shows a riwaya, a tariq or a chain (Phase 4's, FR-ISNAD-5). An
// excluded teacher (`NOT_FOUND`, R-GENDER-2) is one unknown-teacher state with no hint of why. Each
// case waits for the loaded content itself, never for a frame drawn while loading (PR #117). T044:
// a package is chosen on the page, the first one until another is pressed, and the action bar opens
// the booking sheet for it (screens.md §4 and §5).
import type { DiscoveryTeacherOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { piasters } from '@ijazah/money';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import {
  inBothDirections,
  nodesOf,
  renderIn,
  unmarked,
} from '../../../design/primitives/__tests__/harness';
import { type MessageKey, type MessageValues, translate } from '../../../i18n';
import { formatPounds, formatRating } from '../../../lib/formatters';
import { apiError, fakeApi } from '../../shared/__tests__/api-double';
import { TeacherProfile } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
// 005:T021: the report's idempotency key.
let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `report-key-${++mockKey}` }));

const mockNavigate = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => mockNavigate(route),
    back: () => mockNavigate('back'),
  },
  useLocalSearchParams: () => mockParams,
}));

type Direction = 'rtl' | 'ltr';

const TEACHER_ID = '0193a6f0-0000-7000-8000-0000000000d1';
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
const PHOTO = 'https://files.ijazah.test/photos/ahmed.jpg?signature=1';

const recitation = {
  packageId: '0193a6f0-0000-7000-8000-0000000000b1',
  subject: QURAN,
  track: 'recitation',
  sessionCount: 8,
  sessionDurationMinutes: 45,
  price_piasters: 120_000,
  perSession_piasters: 15_000,
} as const;
const ijazahTrack = {
  packageId: '0193a6f0-0000-7000-8000-0000000000b2',
  subject: TAJWEED,
  track: 'ijazah_track',
  sessionCount: 12,
  sessionDurationMinutes: 60,
  price_piasters: 216_000,
  perSession_piasters: 18_000,
} as const;
/** A price with piasters: 1,000.50 pounds over three sessions, 333.50 each. */
const withPiasters = {
  packageId: '0193a6f0-0000-7000-8000-0000000000b3',
  subject: QURAN,
  track: 'recitation',
  sessionCount: 3,
  sessionDurationMinutes: 30,
  price_piasters: 100_050,
  perSession_piasters: 33_350,
} as const;

const full: DiscoveryTeacherOutput = {
  teacherId: TEACHER_ID,
  displayName: 'الشيخ أحمد المصري',
  gender: 'male',
  photoUrl: PHOTO,
  bio: 'أدرّس الحفظ والمراجعة للكبار منذ اثني عشر عامًا.',
  qualificationSummary: 'إجازة في القراءات، واثنا عشر عامًا من التدريس',
  subjects: [QURAN, TAJWEED],
  // Drawn «5.0», to one decimal as the card draws it (T070; PR #118's review, nit 5).
  rating: 4.96,
  reviewCount: 86,
  packages: [recitation, ijazahTrack],
};

const bare: DiscoveryTeacherOutput = {
  teacherId: TEACHER_ID,
  displayName: 'عمر حسن',
  gender: 'male',
  bio: 'أعلّم التجويد للمبتدئين.',
  qualificationSummary: 'إجازة في التجويد',
  subjects: [TAJWEED],
  reviewCount: 0,
  packages: [ijazahTrack],
};

const said = (direction: Direction, key: MessageKey, values?: MessageValues) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);
const ar = (key: MessageKey, values?: MessageValues) => translate('ar', key, values);
const localeOf = (direction: Direction) => (direction === 'rtl' ? 'ar' : 'en');
const named = (direction: Direction, subject: typeof QURAN) =>
  direction === 'rtl' ? subject.nameAr : subject.nameEn;
const pounds = (direction: Direction, amount: number) =>
  formatPounds(piasters(amount), localeOf(direction));

/** The words of every text the screen draws, the direction marks aside (T109). */
const wordsOf = (rendered: Awaited<ReturnType<typeof renderIn>>) =>
  nodesOf(rendered)
    .filter((node) => node.type === 'Text')
    .map((node) =>
      unmarked((node.children ?? []).filter((child) => typeof child === 'string').join('')),
    );

/** The image sources the screen draws. */
const imagesOf = (rendered: Awaited<ReturnType<typeof renderIn>>) =>
  nodesOf(rendered)
    .filter((node) => node.type === 'Image')
    .map((node) => (node.props['source'] as { uri?: string } | undefined)?.uri);

let queries: QueryClient;
const profile = (): ReactElement => (
  <QueryClientProvider client={queries}>
    <TeacherProfile />
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  mockApi.api.discovery.teacher.query.mockResolvedValue(full);
  mockNavigate.mockReset();
  mockParams = { teacherId: TEACHER_ID };
  onlineManager.setOnline(true);
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => onlineManager.setOnline(true));

describe('TeacherProfile', () => {
  it('shows the whole profile: photo, name, gender, subjects, rating, bio, qualification and each package', async () => {
    await inBothDirections(profile, async (rendered, direction) => {
      expect(await screen.findByText(full.displayName)).toBeTruthy();
      expect(imagesOf(rendered)).toEqual([PHOTO]);
      expect(screen.getByText(said(direction, 'common.gender.male'))).toBeTruthy();
      expect(
        screen.getByText(
          [named(direction, QURAN), named(direction, TAJWEED)].join(
            said(direction, 'student.teacherProfile.subjectsSeparator'),
          ),
        ),
      ).toBeTruthy();
      const ratingLine = said(direction, 'student.teacherProfile.ratingOf', {
        rating: formatRating(4.96, localeOf(direction)),
        count: 86,
      });
      expect(ratingLine).toContain('5.0');
      expect(screen.getByText(ratingLine)).toBeTruthy();
      expect(screen.queryByText(said(direction, 'student.teacherProfile.noReviews'))).toBeNull();
      expect(screen.getByText(full.bio)).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'student.teacherProfile.qualification')),
      ).toBeTruthy();
      expect(screen.getByText(full.qualificationSummary)).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.teacherProfile.packages'))).toBeTruthy();
      for (const item of [recitation, ijazahTrack]) {
        expect(
          screen.getByText(
            said(direction, 'common.format.packageShort', {
              subject: named(direction, item.subject),
              count: item.sessionCount,
            }),
          ),
        ).toBeTruthy();
        expect(
          screen.getByText(
            said(direction, 'student.teacherProfile.minutesPerSession', {
              minutes: item.sessionDurationMinutes,
            }),
          ),
        ).toBeTruthy();
        expect(screen.getByText(pounds(direction, item.price_piasters))).toBeTruthy();
        expect(
          screen.getByText(
            said(direction, 'student.teacherProfile.pricePerSession', {
              price: pounds(direction, item.perSession_piasters),
            }),
          ),
        ).toBeTruthy();
      }
      expect(screen.getAllByText(said(direction, 'common.track.recitation'))).toHaveLength(1);
      expect(screen.getAllByText(said(direction, 'common.track.ijazahTrack'))).toHaveLength(1);
    });
    expect(mockApi.api.discovery.teacher.query).toHaveBeenCalledWith({ teacherId: TEACHER_ID });
  });

  it('draws the initials for no photo, and the no-reviews line with no rating for no review', async () => {
    mockApi.api.discovery.teacher.query.mockResolvedValue(bare);
    await inBothDirections(profile, async (rendered, direction) => {
      expect(await screen.findByText(bare.displayName)).toBeTruthy();
      expect(imagesOf(rendered)).toEqual([]);
      expect(screen.getByText('عح')).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.teacherProfile.noReviews'))).toBeTruthy();
      expect(screen.queryByText(/4\.9|من \d|from \d/)).toBeNull();
      expect(screen.getByText(named(direction, TAJWEED))).toBeTruthy();
    });
  });

  it.each([
    ['recitation', recitation, 'student.teacherProfile.remedy.recitation'],
    ['ijazah_track', ijazahTrack, 'student.teacherProfile.remedy.ijazahTrack'],
  ] as const)(
    'writes the remedy line of the %s track under its package',
    async (_track, item, key) => {
      mockApi.api.discovery.teacher.query.mockResolvedValue({ ...full, packages: [item] });
      const other =
        key === 'student.teacherProfile.remedy.recitation'
          ? 'student.teacherProfile.remedy.ijazahTrack'
          : 'student.teacherProfile.remedy.recitation';
      await inBothDirections(profile, async (_rendered, direction) => {
        expect(await screen.findByText(said(direction, key))).toBeTruthy();
        expect(screen.queryByText(said(direction, other))).toBeNull();
        // No promise of an ijazah on completion (FR-IJAZAH-1; the owner's decision of 2026-11-02).
        expect(screen.queryByText(/الإجازة بعد الإتمام|ijazah after completion/)).toBeNull();
      });
    },
  );

  it('draws the prices sent in piasters in pounds, whole pounds bare and piasters to two places', async () => {
    mockApi.api.discovery.teacher.query.mockResolvedValue({
      ...full,
      packages: [recitation, withPiasters],
    });
    const arabic = await renderIn('rtl', profile());
    expect(await screen.findByText(full.displayName)).toBeTruthy();
    expect(wordsOf(arabic)).toEqual(
      expect.arrayContaining(['1,200 ج.م', '150 ج.م للجلسة', '1,000.50 ج.م', '333.50 ج.م للجلسة']),
    );
    await arabic.unmount();
    const english = await renderIn('ltr', profile());
    expect(await screen.findByText(full.displayName)).toBeTruthy();
    expect(wordsOf(english)).toEqual(
      expect.arrayContaining([
        'EGP 1,200',
        'EGP 150 per session',
        'EGP 1,000.50',
        'EGP 333.50 per session',
      ]),
    );
  });

  it('shows no riwaya, tariq or chain, even were the answer to carry one (FR-336)', async () => {
    mockApi.api.discovery.teacher.query.mockResolvedValue({
      ...full,
      riwaya: 'حفص عن عاصم',
      tariq: 'من طريق الشاطبية',
      chain: ['رسول الله ﷺ', 'الشيخ أحمد المصري'],
    });
    await inBothDirections(profile, async (_rendered, direction) => {
      expect(await screen.findByText(full.displayName)).toBeTruthy();
      expect(screen.queryByText(/حفص عن عاصم|الشاطبية|رسول الله/)).toBeNull();
      expect(screen.queryByText(/السند|Chain of transmission/)).toBeNull();
      expect(
        screen.queryByText(said(direction, 'student.teacherProfile.showFullChain')),
      ).toBeNull();
      expect(
        screen.queryByLabelText(said(direction, 'student.teacherProfile.isnad.a11y.chain')),
      ).toBeNull();
    });
  });

  it('answers NOT_FOUND with the one unknown-teacher state, with no hint of why', async () => {
    mockApi.api.discovery.teacher.query.mockRejectedValue(apiError('NOT_FOUND'));
    await inBothDirections(profile, async (_rendered, direction) => {
      expect(
        await screen.findByText(said(direction, 'student.teacherProfile.notFound.title')),
      ).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'student.teacherProfile.notFound.text')),
      ).toBeTruthy();
      expect(screen.queryByText(said(direction, 'common.state.loadError'))).toBeNull();
      expect(
        screen.queryByRole('button', { name: said(direction, 'common.action.retry') }),
      ).toBeNull();
    });
  });

  it('reads an unknown teacher once, where the cache would read a failure again', async () => {
    mockApi.api.discovery.teacher.query.mockRejectedValue(apiError('NOT_FOUND'));
    queries = new QueryClient();
    await renderIn('rtl', profile());
    // Were it read again, the state would wait for the last of the cache's three retries.
    expect(await screen.findByText(ar('student.teacherProfile.notFound.title'))).toBeTruthy();
    expect(
      queries.getQueryState(['student', 'discovery', 'teacher', TEACHER_ID])?.fetchStatus,
    ).toBe('idle');
    expect(mockApi.api.discovery.teacher.query).toHaveBeenCalledTimes(1);
  });

  it('answers a link whose id is not a teacher id with the same state, asking nothing', async () => {
    mockParams = { teacherId: 'not-an-id' };
    await renderIn('rtl', profile());
    expect(await screen.findByText(ar('student.teacherProfile.notFound.title'))).toBeTruthy();
    expect(mockApi.api.discovery.teacher.query).not.toHaveBeenCalled();
  });

  it('says so and reads again on retry when the profile cannot be read', async () => {
    mockApi.api.discovery.teacher.query.mockRejectedValueOnce(apiError('INTERNAL'));
    await renderIn('rtl', profile());
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    expect(screen.queryByText(ar('student.teacherProfile.notFound.title'))).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.retry') }));
    expect(await screen.findByText(full.displayName)).toBeTruthy();
    expect(mockApi.api.discovery.teacher.query).toHaveBeenCalledTimes(2);
  });

  it('says there is no connection instead of loading, and reads once it is back', async () => {
    onlineManager.setOnline(false);
    await renderIn('rtl', profile());
    expect(await screen.findByText(ar('common.state.offline'))).toBeTruthy();
    expect(mockApi.api.discovery.teacher.query).not.toHaveBeenCalled();
    await act(async () => onlineManager.setOnline(true));
    expect(await screen.findByText(full.displayName)).toBeTruthy();
  });

  it('keeps a profile read before under the offline banner', async () => {
    queries.setQueryData(['student', 'discovery', 'teacher', TEACHER_ID], full);
    onlineManager.setOnline(false);
    await renderIn('rtl', profile());
    expect(await screen.findByText(full.displayName)).toBeTruthy();
    expect(screen.getByText(ar('common.state.offline'))).toBeTruthy();
  });

  it('goes back from the back arrow', async () => {
    await renderIn('rtl', profile());
    expect(await screen.findByText(full.displayName)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: ar('common.a11y.back') }));
    expect(mockNavigate).toHaveBeenCalledWith('back');
  });

  describe('choosing a package and its slot (T044, screens.md §4 and §5)', () => {
    const chooseSlot = (direction: Direction, item: typeof recitation | typeof ijazahTrack) =>
      said(direction, 'student.teacherProfile.chooseSlot', {
        package: said(direction, 'common.format.packageShort', {
          subject: named(direction, item.subject),
          count: item.sessionCount,
        }),
      });

    beforeEach(() => {
      mockApi.api.booking.slots.query.mockResolvedValue({
        teacherTimezone: 'Africa/Cairo',
        slots: [],
      });
    });

    it('offers the first package until another is pressed, then that one', async () => {
      await inBothDirections(profile, async (_rendered, direction) => {
        expect(await screen.findByText(full.displayName)).toBeTruthy();
        expect(
          screen.getByRole('button', { name: chooseSlot(direction, recitation) }),
        ).toBeTruthy();
        await fireEvent.press(
          screen.getByText(
            said(direction, 'common.format.packageShort', {
              subject: named(direction, TAJWEED),
              count: ijazahTrack.sessionCount,
            }),
          ),
        );
        expect(
          screen.getByRole('button', { name: chooseSlot(direction, ijazahTrack) }),
        ).toBeTruthy();
        expect(
          screen.queryByRole('button', { name: chooseSlot(direction, recitation) }),
        ).toBeNull();
      });
    });

    it('opens the booking sheet for the chosen package, and closes it', async () => {
      await renderIn('rtl', profile());
      expect(await screen.findByText(full.displayName)).toBeTruthy();
      await fireEvent.press(
        screen.getByText(ar('common.format.packageShort', { subject: TAJWEED.nameAr, count: 12 })),
      );
      await fireEvent.press(screen.getByRole('button', { name: chooseSlot('rtl', ijazahTrack) }));
      expect(await screen.findByText(ar('student.booking.noSlots.title'))).toBeTruthy();
      expect(screen.getByText(ar('student.booking.title'))).toBeTruthy();
      expect(mockApi.api.booking.slots.query).toHaveBeenCalledWith({
        packageId: ijazahTrack.packageId,
      });
      await fireEvent.press(screen.getByRole('button', { name: ar('common.a11y.close') }));
      expect(screen.queryByText(ar('student.booking.title'))).toBeNull();
    });

    it('offers no slot to choose for a teacher with no active package', async () => {
      mockApi.api.discovery.teacher.query.mockResolvedValue({ ...full, packages: [] });
      await renderIn('rtl', profile());
      expect(await screen.findByText(full.displayName)).toBeTruthy();
      expect(screen.queryByText(/اختيار الموعد/)).toBeNull();
    });
  });
});

// 005:T021 (FR-611, FR-614; B47's Q-R4 (a)): the report from a teacher's profile, the student's only
// (the profile is a student's screen); `discovery.teacher`'s `teacherId` names the teacher. An
// unknown teacher offers no report.
describe('the report from the profile (005:T021)', () => {
  const create = jest.fn(async (_input: unknown) => ({ received: true }));
  const raise = jest.fn(async (_input: unknown) => ({ received: true }));
  beforeEach(() => {
    create.mockClear();
    raise.mockClear();
    Object.assign(mockApi.api, {
      reports: { create: { mutate: create } },
      genderFlags: { raise: { mutate: raise } },
    });
  });

  it('reports the teacher from the profile, naming neither a session nor an enrollment', async () => {
    await inBothDirections(profile, async (_rendered, direction) => {
      expect(await screen.findByText(full.displayName)).toBeTruthy();
      await fireEvent.press(
        screen.getByRole('button', { name: said(direction, 'student.teacherProfile.report') }),
      );
      expect(
        screen.getByText(said(direction, 'student.report.title', { teacher: full.displayName })),
      ).toBeTruthy();
      await fireEvent.press(
        screen.getByRole('radio', { name: said(direction, 'student.report.reasons.other') }),
      );
      await fireEvent.press(
        screen.getByRole('button', { name: said(direction, 'student.report.submit') }),
      );
      expect(await screen.findByText(said(direction, 'common.toast.reportSent'))).toBeTruthy();
      expect(create).toHaveBeenLastCalledWith({
        reportedUserId: TEACHER_ID,
        context: 'profile',
        reason: said(direction, 'student.report.reasons.other'),
        idempotencyKey: expect.any(String),
      });
    });
    expect(raise).not.toHaveBeenCalled();
  });

  it('flags the teacher’s declared gender from the profile', async () => {
    await renderIn('rtl', profile());
    expect(await screen.findByText(full.displayName)).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: ar('student.teacherProfile.report') }),
    );
    await fireEvent.press(
      screen.getByRole('radio', { name: ar('student.report.reasons.wrongGender') }),
    );
    await fireEvent.press(screen.getByRole('button', { name: ar('student.report.submit') }));
    expect(await screen.findByText(ar('common.toast.reportSent'))).toBeTruthy();
    expect(raise).toHaveBeenCalledWith({
      flaggedUserId: TEACHER_ID,
      reason: ar('student.report.reasons.wrongGender'),
      idempotencyKey: expect.any(String),
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('offers no report on an unknown teacher', async () => {
    mockApi.api.discovery.teacher.query.mockRejectedValue(apiError('NOT_FOUND'));
    await renderIn('rtl', profile());
    expect(await screen.findByText(ar('student.teacherProfile.notFound.title'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar('student.teacherProfile.report') })).toBeNull();
  });
});
