// T083 of specs/004-sessions (FR-514; SRS FR-CANCEL-10; the note under T083, Q-R8 (a)): the teacher
// sees an enrollment the server answers `endedByAdmin` as «أنهت الإدارة هذا الاشتراك» followed by its
// reason, in Arabic and English, on «طلابي»'s ended tab and on the enrollment's screen. The reason is
// the server's `endedByAdmin.reason` drawn as plain text, never through a template; the internal note
// is never answered (T082), so it is never drawn. An enrollment answered without `endedByAdmin`
// draws neither.
import type {
  ListedSession,
  TeacherStudentItem,
  TeacherStudentsGetOutput,
} from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections } from '../../../design/primitives/__tests__/harness';
import { translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { fakeApi } from '../../shared/__tests__/api-double';
import { TeacherEnrollment, TeacherStudentsEnded } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ enrollmentId: '0193a6f0-0000-7000-8000-0000000000e1' }),
}));

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const STUDENT = 'نور سمير';
const CAIRO = 'Africa/Cairo';
/** Braces and asterisks drawn as written: the reason never passes through a template. */
const REASON = 'تكرّر غياب المعلم {دون عذر} **مرتين**';

const held: ListedSession = {
  sessionId: '0193a6f0-0000-7000-8000-000000000501',
  sequenceNumber: 1,
  localDate: '2026-11-11',
  startTimeLocal: '18:00',
  timezone: CAIRO,
  startsAt: '2026-11-11T16:00:00.000Z',
  endsAt: '2026-11-11T16:45:00.000Z',
  status: 'done',
  pendingCancellation: false,
  disputed: false,
};

/** A cancelled enrollment, one session held; `endedByAdmin` as the server answers it, or absent. */
function cancelled(endedByAdmin?: TeacherStudentItem['endedByAdmin']): TeacherStudentItem {
  return {
    enrollmentId: ENROLLMENT_ID,
    student: { displayName: STUDENT, displayNameOrNull: STUDENT, deleted: false },
    summary: {
      subject: {
        id: '0193a6f0-0000-7000-8000-0000000000a1',
        nameAr: 'حفظ القرآن',
        nameEn: 'Quran',
      },
      track: 'recitation',
      sessionCount: 8,
      sessionDurationMinutes: 45,
    },
    status: 'cancelled',
    paused: false,
    last: held,
    upcoming: 0,
    completed: 1,
    remaining: 7,
    ...(endedByAdmin === undefined ? {} : { endedByAdmin }),
  };
}
const detailOf = (item: TeacherStudentItem): TeacherStudentsGetOutput => ({
  ...item,
  sessions: [held],
});

const line = (direction: Direction) =>
  translate(direction === 'rtl' ? 'ar' : 'en', 'status.enrollment.endedByAdmin');
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let queries: QueryClient;
const within = (ui: ReactElement) => () => (
  <QueryClientProvider client={queries}>{ui}</QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  onlineManager.setOnline(true);
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, {
    userId: '0193a6f0-0000-7000-8000-000000000002',
    role: 'teacher',
    displayName: 'سارة عادل',
    timezone: CAIRO,
  });
});
afterEach(async () => {
  await cleanup();
  onlineManager.setOnline(true);
  queries.clear();
});

/** «أنهت الإدارة هذا الاشتراك» once, then the reason exactly as the server answered it. */
function expectEndedByAdmin(direction: Direction): void {
  const either = new RegExp(`^(${escaped(line(direction))}|${escaped(REASON)})$`);
  expect(screen.getAllByText(either).map((text) => text.props.children)).toEqual([
    line(direction),
    REASON,
  ]);
}

function expectNotEndedByAdmin(direction: Direction): void {
  expect(screen.queryByText(line(direction))).toBeNull();
  expect(screen.queryByText(REASON)).toBeNull();
}

describe('«طلابي»’s ended tab says an administrator ended the enrollment (T083, FR-514)', () => {
  it('an enrollment answering endedByAdmin: «أنهت الإدارة هذا الاشتراك» followed by its reason', async () => {
    mockApi.api.teacher.students.list.query.mockResolvedValue({
      items: [cancelled({ reason: REASON })],
    });
    await inBothDirections(within(<TeacherStudentsEnded />), async (_rendered, direction) => {
      expect(await screen.findByText(STUDENT)).toBeTruthy();
      expectEndedByAdmin(direction);
    });
  });

  it('an enrollment answered without endedByAdmin: neither the line nor a reason', async () => {
    mockApi.api.teacher.students.list.query.mockResolvedValue({ items: [cancelled()] });
    await inBothDirections(within(<TeacherStudentsEnded />), async (_rendered, direction) => {
      expect(await screen.findByText(STUDENT)).toBeTruthy();
      expectNotEndedByAdmin(direction);
    });
  });
});

describe('the teacher’s enrollment screen says an administrator ended it (T083, FR-514)', () => {
  it('an enrollment answering endedByAdmin: «أنهت الإدارة هذا الاشتراك» followed by its reason', async () => {
    mockApi.api.teacher.students.get.query.mockResolvedValue(
      detailOf(cancelled({ reason: REASON })),
    );
    await inBothDirections(within(<TeacherEnrollment />), async (_rendered, direction) => {
      expect(await screen.findByText(STUDENT)).toBeTruthy();
      expectEndedByAdmin(direction);
    });
  });

  it('an enrollment answered without endedByAdmin: neither the line nor a reason', async () => {
    mockApi.api.teacher.students.get.query.mockResolvedValue(detailOf(cancelled()));
    await inBothDirections(within(<TeacherEnrollment />), async (_rendered, direction) => {
      expect(await screen.findByText(STUDENT)).toBeTruthy();
      expectNotEndedByAdmin(direction);
    });
  });
});
