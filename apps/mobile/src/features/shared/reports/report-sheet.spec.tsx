// T021 of specs/005-certification (FR-611, FR-614; the note under T021, Q-T4 (a), Q-T5 (a); B47's
// Q-R8 (a)): the one report and flag sheet, both roles, in Arabic and English. A student reports a
// teacher with the student's reasons, a teacher a student with the teacher's; «wrong gender» files
// `genderFlags.raise` with the person's user id, any other reason `reports.create` with the place's
// context and its id (a session its session, a chat its enrollment, a profile neither), the
// category composed into the text (Q-R8 (a)), keyed (one key per text, the same after a failure).
// The answer shows «received» only; `open_exists` and `self` in words that say nothing else; any
// other failure the generic words; the details bounded so the text stays within the contract's.
import { PARTICIPANT_REASON_MAX_LENGTH } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, type MessageValues, translate } from '../../../i18n';
import type { Direction } from '../../../lib/direction';
import { apiError, fakeApi } from '../__tests__/api-double';
import { ReportEntry, type ReportTarget } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `report-key-${++mockKey}` }));

const TEACHER_ID = '0193a6f0-0000-7000-8000-0000000000d1';
const STUDENT_ID = '0193a6f0-0000-7000-8000-0000000000d2';
const SESSION_ID = '0193a6f0-0000-7000-8000-0000000000c1';
const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const TEACHER = 'الشيخ أحمد';
const STUDENT = 'يوسف علي';

/** A student reporting a teacher, from a session. */
const teacherFromSession: ReportTarget = {
  userId: TEACHER_ID,
  role: 'teacher',
  name: TEACHER,
  place: { context: 'session', sessionId: SESSION_ID },
};
/** A teacher reporting a student, from the chat. */
const studentFromChat: ReportTarget = {
  userId: STUDENT_ID,
  role: 'student',
  name: STUDENT,
  place: { context: 'chat', enrollmentId: ENROLLMENT_ID },
};
/** A student reporting a teacher's profile. */
const teacherProfile: ReportTarget = { ...teacherFromSession, place: { context: 'profile' } };

const said = (direction: Direction, key: MessageKey, values?: MessageValues) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);
const create = jest.fn<(input: unknown) => Promise<unknown>>();
const raise = jest.fn<(input: unknown) => Promise<unknown>>();

beforeEach(() => {
  mockApi = fakeApi();
  mockKey = 0;
  create.mockReset();
  raise.mockReset();
  create.mockResolvedValue({ received: true });
  raise.mockResolvedValue({ received: true });
  Object.assign(mockApi.api, {
    reports: { create: { mutate: create } },
    genderFlags: { raise: { mutate: raise } },
  });
});

afterEach(async () => {
  await cleanup();
});

const ui = (target: ReportTarget) => () => <ReportEntry target={target} />;

async function open(direction: Direction): Promise<void> {
  await fireEvent.press(
    screen.getByRole('button', { name: said(direction, 'common.a11y.report') }),
  );
}

async function choose(direction: Direction, reason: MessageKey): Promise<void> {
  await fireEvent.press(screen.getByRole('radio', { name: said(direction, reason) }));
}

async function write(direction: Direction, details: string, group: 'student' | 'teacher') {
  await fireEvent.changeText(
    screen.getByLabelText(said(direction, `${group}.report.details`)),
    details,
  );
}

async function send(direction: Direction, group: 'student' | 'teacher'): Promise<void> {
  await fireEvent.press(
    screen.getByRole('button', { name: said(direction, `${group}.report.submit`) }),
  );
}

describe('the report sheet: what each role is offered (005:T021)', () => {
  it('a student reporting a teacher: the teacher named, the student’s five reasons, the details', async () => {
    await inBothDirections(ui(teacherFromSession), async (_rendered, direction) => {
      await open(direction);
      expect(
        screen.getByText(said(direction, 'student.report.title', { teacher: TEACHER })),
      ).toBeTruthy();
      for (const reason of [
        'misconduct',
        'fraud',
        'offensiveContent',
        'wrongGender',
        'other',
      ] as const) {
        expect(
          screen.getByRole('radio', { name: said(direction, `student.report.reasons.${reason}`) }),
        ).toBeTruthy();
      }
      expect(screen.getByLabelText(said(direction, 'student.report.details'))).toBeTruthy();
      const submit = screen.getByRole('button', { name: said(direction, 'student.report.submit') });
      expect(submit.props.accessibilityState).toMatchObject({ disabled: true });
    });
    expect(create).not.toHaveBeenCalled();
    expect(raise).not.toHaveBeenCalled();
  });

  it('a teacher reporting a student: the student named, the teacher’s five reasons', async () => {
    await inBothDirections(ui(studentFromChat), async (_rendered, direction) => {
      await open(direction);
      expect(
        screen.getByText(said(direction, 'teacher.report.title', { student: STUDENT })),
      ).toBeTruthy();
      for (const reason of [
        'behaviour',
        'offPlatform',
        'offensiveContent',
        'genderIncorrect',
        'other',
      ] as const) {
        expect(
          screen.getByRole('radio', { name: said(direction, `teacher.report.reasons.${reason}`) }),
        ).toBeTruthy();
      }
      expect(screen.getByLabelText(said(direction, 'teacher.report.details'))).toBeTruthy();
    });
  });
});

describe('the report sheet: what it files (005:T021, Q-T5 (a), Q-R8 (a))', () => {
  it.each(['rtl', 'ltr'] as const)(
    '«wrong gender» files a gender flag on the teacher, never a report, and answers «received» only (%s)',
    async (direction) => {
      await renderIn(direction, ui(teacherFromSession)());
      await open(direction);
      await choose(direction, 'student.report.reasons.wrongGender');
      await write(direction, '  صوت رجل  ', 'student');
      await send(direction, 'student');
      expect(await screen.findByText(said(direction, 'common.toast.reportSent'))).toBeTruthy();
      expect(raise).toHaveBeenCalledTimes(1);
      expect(raise).toHaveBeenCalledWith({
        flaggedUserId: TEACHER_ID,
        reason: `${said(direction, 'student.report.reasons.wrongGender')}\nصوت رجل`,
        idempotencyKey: 'report-key-1',
      });
      expect(create).not.toHaveBeenCalled();
      expect(
        screen.queryByRole('button', { name: said(direction, 'student.report.submit') }),
      ).toBeNull();
    },
  );

  it('the teacher’s «gender incorrect» files a gender flag on the student', async () => {
    await renderIn('rtl', ui(studentFromChat)());
    await open('rtl');
    await choose('rtl', 'teacher.report.reasons.genderIncorrect');
    await send('rtl', 'teacher');
    expect(await screen.findByText(said('rtl', 'common.toast.reportSent'))).toBeTruthy();
    expect(raise).toHaveBeenCalledWith({
      flaggedUserId: STUDENT_ID,
      reason: said('rtl', 'teacher.report.reasons.genderIncorrect'),
      idempotencyKey: 'report-key-1',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['rtl', 'ltr'] as const)(
    'another reason files a report from the session, naming its session, and answers «received» only (%s)',
    async (direction) => {
      await renderIn(direction, ui(teacherFromSession)());
      await open(direction);
      await choose(direction, 'student.report.reasons.misconduct');
      await send(direction, 'student');
      expect(await screen.findByText(said(direction, 'common.toast.reportSent'))).toBeTruthy();
      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith({
        reportedUserId: TEACHER_ID,
        context: 'session',
        sessionId: SESSION_ID,
        reason: said(direction, 'student.report.reasons.misconduct'),
        idempotencyKey: 'report-key-1',
      });
      expect(raise).not.toHaveBeenCalled();
    },
  );

  it('from the chat: a report naming the chat’s enrollment, the details after the category', async () => {
    await renderIn('ltr', ui(studentFromChat)());
    await open('ltr');
    await choose('ltr', 'teacher.report.reasons.offPlatform');
    await write('ltr', 'Asked for my number', 'teacher');
    await send('ltr', 'teacher');
    expect(await screen.findByText(said('ltr', 'common.toast.reportSent'))).toBeTruthy();
    expect(create).toHaveBeenCalledWith({
      reportedUserId: STUDENT_ID,
      context: 'chat',
      enrollmentId: ENROLLMENT_ID,
      reason: `${said('ltr', 'teacher.report.reasons.offPlatform')}\nAsked for my number`,
      idempotencyKey: 'report-key-1',
    });
  });

  it('from a profile: a report naming neither a session nor an enrollment', async () => {
    await renderIn('rtl', ui(teacherProfile)());
    await open('rtl');
    await choose('rtl', 'student.report.reasons.fraud');
    await send('rtl', 'student');
    expect(await screen.findByText(said('rtl', 'common.toast.reportSent'))).toBeTruthy();
    expect(create).toHaveBeenCalledWith({
      reportedUserId: TEACHER_ID,
      context: 'profile',
      reason: said('rtl', 'student.report.reasons.fraud'),
      idempotencyKey: 'report-key-1',
    });
  });
});

describe('the report sheet: refusals and bounds (005:T021)', () => {
  it.each(['rtl', 'ltr'] as const)(
    '`open_exists` in words that say nothing else, the sheet stays, and the same text keeps its key (%s)',
    async (direction) => {
      create.mockRejectedValue(
        apiError('CONFLICT', [{ path: 'reportedUserId', code: 'open_exists' }]),
      );
      await renderIn(direction, ui(teacherFromSession)());
      await open(direction);
      await choose(direction, 'student.report.reasons.misconduct');
      await send(direction, 'student');
      expect(
        await screen.findByText(said(direction, 'common.report.refused.openExists')),
      ).toBeTruthy();
      expect(screen.queryByText(said(direction, 'common.toast.reportSent'))).toBeNull();
      await send(direction, 'student');
      await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
      const keys = create.mock.calls.map(
        ([input]) => (input as { idempotencyKey: string }).idempotencyKey,
      );
      expect(keys[0]).toBe(keys[1]);
    },
  );

  it('a flag’s `open_exists` in the same words', async () => {
    raise.mockRejectedValue(apiError('CONFLICT', [{ path: 'flaggedUserId', code: 'open_exists' }]));
    await renderIn('rtl', ui(teacherFromSession)());
    await open('rtl');
    await choose('rtl', 'student.report.reasons.wrongGender');
    await send('rtl', 'student');
    expect(await screen.findByText(said('rtl', 'common.report.refused.openExists'))).toBeTruthy();
    expect(screen.queryByText(said('rtl', 'common.toast.reportSent'))).toBeNull();
  });

  it('`self` in its own words', async () => {
    create.mockRejectedValue(apiError('CONFLICT', [{ path: 'reportedUserId', code: 'self' }]));
    await renderIn('ltr', ui(teacherProfile)());
    await open('ltr');
    await choose('ltr', 'student.report.reasons.other');
    await send('ltr', 'student');
    expect(await screen.findByText(said('ltr', 'common.report.refused.self'))).toBeTruthy();
  });

  it('NOT_FOUND and any other failure: the generic words, nothing of why', async () => {
    create.mockRejectedValue(apiError('NOT_FOUND'));
    await renderIn('rtl', ui(teacherProfile)());
    await open('rtl');
    await choose('rtl', 'student.report.reasons.other');
    await send('rtl', 'student');
    expect(await screen.findByText(said('rtl', 'common.state.actionError'))).toBeTruthy();
    expect(screen.queryByText(said('rtl', 'common.toast.reportSent'))).toBeNull();
  });

  it('details that would carry the text past the contract’s bound say so and send nothing', async () => {
    await renderIn('rtl', ui(teacherFromSession)());
    await open('rtl');
    await choose('rtl', 'student.report.reasons.other');
    await write('rtl', 'ا'.repeat(PARTICIPANT_REASON_MAX_LENGTH), 'student');
    expect(screen.getByText(said('rtl', 'common.report.tooLong'))).toBeTruthy();
    await send('rtl', 'student');
    expect(create).not.toHaveBeenCalled();
    expect(raise).not.toHaveBeenCalled();
  });
});
