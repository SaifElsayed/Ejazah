// T051 (FR-391, FR-393; screens.md §14): «طلابي» against its boards, in both languages. The active
// tab lists each confirmed enrollment by next session: the name's initial, the name, «الجلسة n من N»
// with the next session's date and time in its own zone (and in the teacher's when it is another,
// ADR 0009 D5), the status and the track. The ended tab lists what ended, page after page, with what
// was done of the package. Each tab searches by the student's name on the server (FR-391, R-203):
// what the field holds goes to `teacher.students.list` once typing pauses, and the rows are the
// answer, never filtered here. No student yet is `TeacherStudentsEmpty`; a search or an ended tab
// with nothing says so in place. The screens decide only on what they read since they opened (the
// owner's decision of 2026-11-04; T086).
import type {
  ListedSession,
  TeacherStudentItem,
  TeacherStudentsListInput,
  TeacherStudentsListOutput,
} from '@ijazah/contracts';
import { cityOf } from '@ijazah/time/cities';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { formatDate, formatTime, formatWeekdayDate } from '../../../lib/formatters';
import { apiError, fakeApi } from '../../shared/__tests__/api-double';
import { studentsQueryKey, TeacherStudents, TeacherStudentsEnded } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockPush = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => mockPush(route),
    navigate: (route: unknown) => mockNavigate(route),
  },
}));

const CAIRO = 'Africa/Cairo';
const DUBAI = 'Asia/Dubai';
const QURAN = {
  id: '0193a6f0-0000-7000-8000-0000000000a1',
  nameAr: 'حفظ القرآن',
  nameEn: 'Quran memorization',
};

function listed(n: number, startsAt: string, timezone = CAIRO): ListedSession {
  return {
    sessionId: `0193a6f0-0000-7000-8000-0000000005${String(n).padStart(2, '0')}`,
    sequenceNumber: n,
    localDate: startsAt.slice(0, 'YYYY-MM-DD'.length),
    startTimeLocal: '10:00',
    timezone,
    startsAt,
    endsAt: startsAt,
    status: 'scheduled',
    pendingCancellation: false,
    disputed: false,
  };
}

function item(
  id: string,
  student: string,
  of: Partial<TeacherStudentItem> & Pick<TeacherStudentItem, 'status'>,
): TeacherStudentItem {
  return {
    enrollmentId: `0193a6f0-0000-7000-8000-0000000000${id}`,
    student: { displayName: student, displayNameOrNull: student, deleted: false },
    summary: { subject: QURAN, track: 'recitation', sessionCount: 8, sessionDurationMinutes: 45 },
    upcoming: 5,
    completed: 3,
    remaining: 5,
    ...of,
  };
}

const NOOR = item('e1', 'نور سمير', {
  status: 'confirmed',
  next: listed(4, '2026-11-07T08:00:00.000Z'),
  last: listed(8, '2026-12-05T08:00:00.000Z'),
});
const HASSAN = item('e2', 'حسن إبراهيم', {
  status: 'confirmed',
  summary: {
    subject: QURAN,
    track: 'ijazah_track',
    sessionCount: 12,
    sessionDurationMinutes: 60,
  },
  next: listed(5, '2026-11-08T14:00:00.000Z', DUBAI),
  last: listed(12, '2026-12-27T14:00:00.000Z', DUBAI),
});
const SAEED = item('e3', 'سعيد منصور', {
  status: 'completed',
  upcoming: 0,
  completed: 8,
  remaining: 0,
  last: listed(8, '2026-10-07T08:00:00.000Z'),
});
const YOUSSEF = item('e4', 'يوسف أحمد', {
  status: 'terminated_no_show',
  upcoming: 0,
  completed: 2,
  remaining: 6,
});
const CURSOR = YOUSSEF.enrollmentId;

const me = {
  userId: '0193a6f0-0000-7000-8000-000000000002',
  role: 'teacher' as const,
  displayName: 'سارة عادل',
  timezone: CAIRO,
};

const localeOf = (direction: Direction) => (direction === 'rtl' ? 'ar' : 'en');
const said = (direction: Direction, key: MessageKey, values?: Record<string, string | number>) =>
  translate(localeOf(direction), key, values);
const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);
const nextLine = (direction: Direction, of: TeacherStudentItem) => {
  const next = of.next!;
  return said(direction, 'teacher.students.sessionOn', {
    n: next.sequenceNumber,
    total: of.summary.sessionCount,
    date: formatWeekdayDate(next.startsAt, next.timezone, localeOf(direction)),
    time: formatTime(next.startsAt, next.timezone, localeOf(direction)),
  });
};

let queries: QueryClient;
const withQueries = (ui: () => ReactElement) => () => (
  <QueryClientProvider client={queries}>{ui()}</QueryClientProvider>
);
const active = withQueries(() => <TeacherStudents />);
const ended = withQueries(() => <TeacherStudentsEnded />);
const list = () => mockApi.api.teacher.students.list.query;
const listedWith = () => list().mock.calls.map(([input]) => input as TeacherStudentsListInput);

function answering(byInput: (input: TeacherStudentsListInput) => TeacherStudentsListOutput) {
  list().mockImplementation(async (raw) => byInput(raw as TeacherStudentsListInput));
}

beforeEach(() => {
  mockApi = fakeApi();
  mockPush.mockReset();
  mockNavigate.mockReset();
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});
afterEach(() => onlineManager.setOnline(true));

describe('TeacherStudents (FR-391, FR-393)', () => {
  it('lists the active enrollments with the initial, the next session, the status and the track', async () => {
    answering(() => ({ items: [NOOR, HASSAN] }));
    await inBothDirections(active, async (_rendered, direction) => {
      expect(await screen.findByText(NOOR.student.displayName)).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.students.title'))).toBeTruthy();
      expect(screen.getByPlaceholderText(said(direction, 'teacher.students.search'))).toBeTruthy();
      expect(screen.getAllByRole('tab')).toHaveLength(2);
      expect(screen.getByText('ن')).toBeTruthy();
      expect(screen.getByText('ح')).toBeTruthy();
      expect(screen.getByText(nextLine(direction, NOOR))).toBeTruthy();
      expect(screen.getByText(nextLine(direction, HASSAN))).toBeTruthy();
      expect(screen.getAllByText(said(direction, 'status.enrollment.confirmed'))).toHaveLength(2);
      expect(screen.getByText(said(direction, 'common.track.recitation'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'common.track.ijazahTrack'))).toBeTruthy();
    });
    expect(listedWith()).toContainEqual({ tab: 'active' });
  });

  // T007 (FR-426): a deleted student has no name; the row draws the stand-in and an avatar with no
  // letter, never an empty line.
  it('draws a deleted student by the stand-in text, the avatar with no letter', async () => {
    const deleted: TeacherStudentItem = {
      ...NOOR,
      student: { displayName: '', displayNameOrNull: null, deleted: true },
    };
    answering(() => ({ items: [deleted] }));
    await inBothDirections(active, async (_rendered, direction) => {
      expect(await screen.findByText(said(direction, 'common.party.deletedStudent'))).toBeTruthy();
      expect(screen.getByText(nextLine(direction, deleted))).toBeTruthy();
      // The avatar draws no letter: not the stand-in's first.
      expect(
        screen.queryByText(said(direction, 'common.party.deletedStudent').charAt(0)),
      ).toBeNull();
    });
  });

  it('says a next session of another zone in the teacher’s too (ADR 0009 D5)', async () => {
    answering(() => ({ items: [HASSAN] }));
    await inBothDirections(active, async (_rendered, direction) => {
      expect(await screen.findByText(HASSAN.student.displayName)).toBeTruthy();
      const next = HASSAN.next!;
      expect(
        screen.getByText(
          said(direction, 'teacher.students.inViewerZone', {
            date: formatDate(next.startsAt, CAIRO, localeOf(direction)),
            time: formatTime(next.startsAt, CAIRO, localeOf(direction)),
            city: cityOf(CAIRO, localeOf(direction)) ?? CAIRO,
          }),
        ),
      ).toBeTruthy();
    });
  });

  it('opens an enrollment from its row, and the ended tab from its tab', async () => {
    answering(() => ({ items: [NOOR] }));
    await renderIn('rtl', active());
    await fireEvent.press(await screen.findByText(NOOR.student.displayName));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(teacher)/students/[enrollmentId]',
      params: { enrollmentId: NOOR.enrollmentId },
    });
    await fireEvent.press(screen.getByRole('tab', { name: ar('teacher.students.tabs.ended') }));
    expect(mockPush).toHaveBeenCalledWith('/(teacher)/students/ended');
  });

  it('sends the typed name to the server and draws its answer as it is, unfiltered', async () => {
    answering((input) => (input.query === undefined ? { items: [NOOR] } : { items: [HASSAN] }));
    await renderIn('rtl', active());
    expect(await screen.findByText(NOOR.student.displayName)).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText(ar('teacher.students.search')), ' نو ');
    expect(await screen.findByText(HASSAN.student.displayName)).toBeTruthy();
    expect(screen.queryByText(NOOR.student.displayName)).toBeNull();
    expect(listedWith()).toContainEqual({ tab: 'active', query: 'نو' });
  });

  it('says a search found nobody, keeping the field', async () => {
    answering((input) => (input.query === undefined ? { items: [NOOR] } : { items: [] }));
    await inBothDirections(active, async (_rendered, direction) => {
      expect(await screen.findByText(NOOR.student.displayName)).toBeTruthy();
      await fireEvent.changeText(
        screen.getByPlaceholderText(said(direction, 'teacher.students.search')),
        'زيد',
      );
      expect(
        await screen.findByText(said(direction, 'teacher.students.searchEmpty.title')),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.students.searchEmpty.text'))).toBeTruthy();
      expect(screen.getByPlaceholderText(said(direction, 'teacher.students.search'))).toBeTruthy();
    });
  });

  it('is TeacherStudentsEmpty with no student yet, leading to the packages and the ended tab', async () => {
    answering(() => ({ items: [] }));
    await inBothDirections(active, async (_rendered, direction) => {
      expect(await screen.findByText(said(direction, 'teacher.students.empty.title'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.students.empty.text'))).toBeTruthy();
      expect(screen.queryByPlaceholderText(said(direction, 'teacher.students.search'))).toBeNull();
      expect(screen.getAllByRole('tab')).toHaveLength(2);
      await fireEvent.press(
        screen.getByRole('button', { name: said(direction, 'teacher.students.empty.packages') }),
      );
    });
    expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/(tabs)/packages');
  });
});

describe('TeacherStudentsEnded (FR-391)', () => {
  it('lists what ended with what was done of the package, the status and the note', async () => {
    answering(() => ({ items: [SAEED, YOUSSEF] }));
    await inBothDirections(ended, async (_rendered, direction) => {
      expect(await screen.findByText(SAEED.student.displayName)).toBeTruthy();
      const tabs = screen.getAllByRole('tab');
      expect(tabs[1]?.props.accessibilityState).toEqual({ selected: true });
      expect(
        screen.getByText(said(direction, 'common.format.progress', { done: 8, total: 8 })),
      ).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'common.format.progress', { done: 2, total: 8 })),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'status.enrollment.completed'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'status.enrollment.terminatedNoShow'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.students.endedNote'))).toBeTruthy();
    });
    expect(listedWith()).toContainEqual({ tab: 'ended' });
  });

  it('asks the next page with the cursor the last page answered', async () => {
    answering((input) =>
      input.cursor === CURSOR ? { items: [NOOR] } : { items: [SAEED, YOUSSEF], nextCursor: CURSOR },
    );
    await renderIn('rtl', ended());
    await reachEnd(await screen.findByText(SAEED.student.displayName));
    expect(await screen.findByText(NOOR.student.displayName)).toBeTruthy();
    expect(listedWith()).toContainEqual({ tab: 'ended', cursor: CURSOR });
  });

  it('searches the ended tab on the server too (FR-391)', async () => {
    answering((input) => (input.query === undefined ? { items: [SAEED] } : { items: [YOUSSEF] }));
    await renderIn('rtl', ended());
    expect(await screen.findByText(SAEED.student.displayName)).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText(ar('teacher.students.search')), 'يو');
    expect(await screen.findByText(YOUSSEF.student.displayName)).toBeTruthy();
    expect(listedWith()).toContainEqual({ tab: 'ended', query: 'يو' });
  });

  it('says there is no ended enrollment, and goes back to the active tab', async () => {
    answering(() => ({ items: [] }));
    await inBothDirections(ended, async (_rendered, direction) => {
      expect(
        await screen.findByText(said(direction, 'teacher.students.endedEmpty.title')),
      ).toBeTruthy();
      await fireEvent.press(
        screen.getByRole('tab', { name: said(direction, 'teacher.students.tabs.active') }),
      );
    });
    expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/(tabs)/students');
  });
});

describe('the lists read since they opened (the owner’s decision of 2026-11-04; T086)', () => {
  it('shows the retry state, not the cached list, when the read on opening fails', async () => {
    queries.setQueryData(studentsQueryKey({ tab: 'active' }), {
      pages: [{ items: [NOOR] }],
      pageParams: [undefined],
    });
    list().mockRejectedValue(apiError('INTERNAL'));
    await renderIn('rtl', active());
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    expect(screen.queryByText(NOOR.student.displayName)).toBeNull();
    answering(() => ({ items: [HASSAN] }));
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.retry') }));
    expect(await screen.findByText(HASSAN.student.displayName)).toBeTruthy();
  });

  it('does not say «no student yet» from a cached empty list while its own read is on the way', async () => {
    queries.setQueryData(studentsQueryKey({ tab: 'active' }), {
      pages: [{ items: [] }],
      pageParams: [undefined],
    });
    list().mockReturnValue(new Promise(() => undefined));
    await renderIn('rtl', active());
    expect(screen.queryByText(ar('teacher.students.empty.title'))).toBeNull();
  });

  it('keeps the cached list under the offline banner with no connection (002:T138)', async () => {
    queries.setQueryData(studentsQueryKey({ tab: 'ended' }), {
      pages: [{ items: [SAEED] }],
      pageParams: [undefined],
    });
    onlineManager.setOnline(false);
    await renderIn('rtl', ended());
    expect(screen.getByText(ar('common.state.offline'))).toBeTruthy();
    await waitFor(() => expect(screen.getByText(SAEED.student.displayName)).toBeTruthy());
  });
});

type Instance = ReturnType<typeof screen.getByText>;

/** Brings the list holding `inside` to its end, as the teacher does scrolling to read the next page. */
async function reachEnd(inside: Instance) {
  let node: Instance | null = inside;
  while (node !== null && node.props['onEndReached'] === undefined) node = node.parent;
  if (node === null) throw new Error('no list pages');
  await fireEvent(node, 'endReached', { distanceFromEnd: 0 });
}
