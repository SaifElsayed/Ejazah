// T046 (FR-495; contracts/app-surface.md, "Phase 2's lists, widened additively"): the teacher's ended
// tab, the `(teacher)/students/ended` route, in both languages. It draws each status the ended tab
// holds as its badge: `completed`, `terminated_no_show`, and `cancelled`, which is how an enrollment
// the administration, the teacher's suspension or an account's deletion ended reads (the lists
// answer no `cancellationReason`; the note under T046, Q9 (a)). A failed read says its words through
// `genericErrorKey` (T065): a `RATE_LIMITED` refusal reads «طلبات كثيرة…», on opening and on the next
// page.
import type { TeacherStudentItem, TeacherStudentsListInput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import TeacherStudentsEndedRoute from '../../../app/(teacher)/students/ended';
import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { apiError, fakeApi } from '../../shared/__tests__/api-double';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn() },
}));

const STUDENT = 'نور سمير';
const CURSOR = '0193a6f0-0000-7000-8000-0000000000e1';

const me = {
  userId: '0193a6f0-0000-7000-8000-000000000002',
  role: 'teacher' as const,
  displayName: 'سارة عادل',
  timezone: 'Africa/Cairo',
};

type EndedStatus = 'completed' | 'terminated_no_show' | 'cancelled';

/** An ended enrollment of `status`, with no session ahead. */
function endedAs(status: EndedStatus): TeacherStudentItem {
  return {
    enrollmentId: CURSOR,
    student: {
      studentId: '0193a6f0-0000-7000-8000-0000000000b9',
      displayName: STUDENT,
      displayNameOrNull: STUDENT,
      deleted: false,
    },
    summary: {
      subject: {
        id: '0193a6f0-0000-7000-8000-0000000000a1',
        nameAr: 'حفظ القرآن',
        nameEn: 'Quran memorization',
      },
      track: 'recitation',
      sessionCount: 8,
      sessionDurationMinutes: 45,
    },
    status,
    paused: false,
    upcoming: 0,
    completed: 3,
    remaining: 5,
  };
}

const said = (direction: Direction, key: MessageKey, values?: Record<string, number>) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);
/** A `RATE_LIMITED` refusal; with `seconds`, the time until its window ends (T062's detail). */
const rateLimited = (seconds?: string) =>
  apiError(
    'RATE_LIMITED',
    seconds === undefined ? [] : [{ path: 'retryAfterSeconds', code: seconds }],
  );
const list = () => mockApi.api.teacher.students.list.query;
const listedWith = () => list().mock.calls.map(([input]) => input as TeacherStudentsListInput);

let queries: QueryClient;
const ended = (): ReactElement => (
  <QueryClientProvider client={queries}>
    <TeacherStudentsEndedRoute />
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});
afterEach(() => {
  onlineManager.setOnline(true);
  queries.clear();
});

describe('the teacher’s ended tab draws each status as its badge (T046, FR-495)', () => {
  it.each<[string, EndedStatus, MessageKey]>([
    ['completed', 'completed', 'status.enrollment.completed'],
    ['terminated_no_show', 'terminated_no_show', 'status.enrollment.terminatedNoShow'],
    [
      'cancelled: ended by the administration, the teacher’s suspension or an account’s deletion',
      'cancelled',
      'status.enrollment.cancelled',
    ],
  ])('an enrollment %s', async (_name, status, badge) => {
    list().mockResolvedValue({ items: [endedAs(status)] });
    await inBothDirections(ended, async (_rendered, direction) => {
      expect(await screen.findByText(STUDENT)).toBeTruthy();
      expect(screen.getByText(said(direction, badge))).toBeTruthy();
    });
    expect(listedWith()).toContainEqual({ tab: 'ended' });
  });
});

describe('the teacher’s ended tab says a failed read through genericErrorKey (T046, T065)', () => {
  it('a read on opening refused RATE_LIMITED: «طلبات كثيرة…», never the generic error', async () => {
    list().mockRejectedValue(rateLimited());
    await inBothDirections(ended, async (_rendered, direction) => {
      expect(await screen.findByText(said(direction, 'common.state.rateLimited'))).toBeTruthy();
      expect(screen.queryByText(said(direction, 'common.state.loadError'))).toBeNull();
    });
  });

  it.each<Direction>(['rtl', 'ltr'])(
    'a next page refused RATE_LIMITED says when to try again (%s)',
    async (direction) => {
      list().mockImplementation(async (raw) => {
        if ((raw as TeacherStudentsListInput).cursor === CURSOR) throw rateLimited('61');
        return { items: [endedAs('completed')], nextCursor: CURSOR };
      });
      await renderIn(direction, ended());
      await reachEnd(await screen.findByText(STUDENT));
      expect(
        await screen.findByText(said(direction, 'common.state.rateLimitedIn', { count: 2 })),
      ).toBeTruthy();
      expect(screen.queryByText(said(direction, 'common.state.loadError'))).toBeNull();
      expect(listedWith()).toContainEqual({ tab: 'ended', cursor: CURSOR });
    },
  );
});

type Instance = ReturnType<typeof screen.getByText>;

/** Brings the list holding `inside` to its end, as the teacher does scrolling to read the next page. */
async function reachEnd(inside: Instance) {
  let node: Instance | null = inside;
  while (node !== null && node.props['onEndReached'] === undefined) node = node.parent;
  if (node === null) throw new Error('no list pages');
  await fireEvent(node, 'endReached', { distanceFromEnd: 0 });
}
