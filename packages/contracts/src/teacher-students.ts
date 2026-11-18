// T049: the teacher's «طلابي» and «اليوم» on the user surface (specs/003-booking/contracts/
// app-surface.md "`enrollments` and the teacher's lists"; FR-391, FR-392, FR-393, FR-395).
//
// `teacher.students.list` answers the teacher's own students' enrollments in the two tabs of
// `enrollments.ts`, the active one by next session; `query` is the start of the student's name,
// folded by the server in either tab (FR-391, ADR 0021 D6, R-203). `teacher.students.get` is one of
// them with every session; `teacher.today` the sessions of the teacher's local day. A student is
// named by display name, with their user id for the report and flag sheet (005:T021, Q-T4 (a)): no
// other id, photo, date of birth, minor flag, document or dispute history reaches the teacher
// (FR-395, R-HONEST-4), and zod strips any field the schemas do not name.
import { z } from 'zod';

import { enrollmentStatus } from './checkout.js';
import { enrollmentIjazahRequest } from './ijazah-requests.js';
import { DISCOVERY_QUERY_MAX_LENGTH } from './discovery.js';
import {
  enrollmentListCursor,
  enrollmentListTab,
  enrollmentProgress,
  enrollmentTerms,
  listedPartyName,
  listedSession,
} from './enrollments.js';
import { calendarDate, timeZone } from './onboarding.js';

/**
 * The student as the teacher's screens draw them: a name, its initial the avatar; a deleted
 * student's stand-in (T007, FR-426). 005:T021 (FR-611, FR-614; Q-T4 (a)): and their user id, which
 * the teacher's report and flag sheet names, a deleted student's too, as the student's
 * `teacher.teacherId` (`enrollments.ts:123`); the server still checks the pairing. Additive
 * (R-API-9).
 */
const listedStudent = z.object({ studentId: z.uuid(), ...listedPartyName.shape });

export const teacherStudentsListInput = z.object({
  tab: enrollmentListTab,
  /** The start of the student's name, folded by the server (FR-391, R-203). */
  query: z.string().trim().min(1).max(DISCOVERY_QUERY_MAX_LENGTH).optional(),
  cursor: enrollmentListCursor.optional(),
});

/** One of the teacher's students' enrollments (FR-391). */
export const teacherStudentItem = z.object({
  enrollmentId: z.uuid(),
  student: listedStudent,
  summary: enrollmentTerms,
  status: enrollmentStatus,
  ...enrollmentProgress.shape,
  /** 004:T074 (FR-506): paused to the teacher, as `studentEnrollmentItem`'s `paused` reads. */
  paused: z.boolean(),
  /**
   * 004:T082 (FR-513): an administrator's direct end, as `studentEnrollmentItem`'s `endedByAdmin`
   * reads: the reason both parties are shown, never the internal note. Additive (R-API-9).
   */
  endedByAdmin: z.object({ reason: z.string() }).optional(),
});

export const teacherStudentsListOutput = z.object({
  items: z.array(teacherStudentItem),
  nextCursor: enrollmentListCursor.optional(),
});

export const teacherStudentsGetInput = z.object({ enrollmentId: z.uuid() });

/** The enrollment and every session of it by sequence number (`TeacherEnrollment`). */
export const teacherStudentsGetOutput = teacherStudentItem.extend({
  sessions: z.array(listedSession),
  /**
   * 005:T006 (FR-608; app-surface.md, «Enrollment reads gain»): the enrollment's latest ijazah
   * request, its rejection's reason included, null without one.
   */
  ijazahRequest: enrollmentIjazahRequest.nullable(),
});

/** One session of the teacher's day, with its enrollment's student and package line. */
export const teacherTodaySession = listedSession.extend({
  enrollmentId: z.uuid(),
  student: listedStudent,
  summary: enrollmentTerms,
});

/** The teacher's local day in the teacher's zone, and its sessions by start (`TeacherHome`). */
export const teacherTodayOutput = z.object({
  localDate: calendarDate,
  timezone: timeZone,
  sessions: z.array(teacherTodaySession),
});

export type TeacherStudentsListInput = z.infer<typeof teacherStudentsListInput>;
export type TeacherStudentItem = z.infer<typeof teacherStudentItem>;
export type TeacherStudentsListOutput = z.infer<typeof teacherStudentsListOutput>;
export type TeacherStudentsGetInput = z.infer<typeof teacherStudentsGetInput>;
export type TeacherStudentsGetOutput = z.infer<typeof teacherStudentsGetOutput>;
export type TeacherTodaySession = z.infer<typeof teacherTodaySession>;
export type TeacherTodayOutput = z.infer<typeof teacherTodayOutput>;
