// T067: the administrator surface's `audit` and `home` namespaces (admin-surface.md "`audit` and
// `home`"; FR-176, FR-180, FR-181). An entry carries the label stored at write time and, beside it,
// the target's name resolved at read time; neither list shows an action ending in `.read` (owner's
// decision 2026-10-21, T065).
import { z } from 'zod';

import { calendarDate, timeZone } from '../onboarding.js';
import { adminPage, adminSearch } from './admins.js';

/** What an audit entry may point at in this phase (ADR 0021 D2). */
export const auditTargetType = z.enum([
  'user',
  'teacher_application',
  'credential',
  'document',
  'verification_request',
  'admin',
  'setting',
  /** A gateway order the payments monitor opened (T052). */
  'payment',
]);

/**
 * The log's filters. The date bounds are calendar days, both included, in the zone the panel names
 * (the browser's): a client sends a local date with its zone, never an instant (R-TIME-6), so the
 * zone is required with either bound.
 */
export const auditListInput = z
  .object({
    /** Matched in the stored label and the reason, as the page's field says («الهدف أو السبب»). */
    search: adminSearch.optional(),
    targetType: auditTargetType.optional(),
    targetId: z.string().min(1).max(200).optional(),
    from: calendarDate.optional(),
    to: calendarDate.optional(),
    timeZone: timeZone.optional(),
    page: adminPage,
  })
  .refine(
    (input) => (input.from === undefined && input.to === undefined) || input.timeZone !== undefined,
    { path: ['timeZone'], message: 'A date bound names its zone.' },
  );

export const auditRow = z.object({
  entryId: z.uuid(),
  occurredAt: z.iso.datetime(),
  adminName: z.string(),
  action: z.string(),
  targetLabel: z.string(),
  /** The target's current name; the role word for a deleted person; absent for a type with none. */
  targetName: z.string().optional(),
  targetType: auditTargetType,
  targetId: z.string(),
  reason: z.string().optional(),
});

export const auditListOutput = z.object({
  rows: z.array(auditRow),
  total: z.int().min(0),
  /** `admin_list_page_size`, so the panel's pager counts the pages (B14d, owner's decision). */
  pageSize: z.int().min(1),
});

export const auditGetInput = z.object({ entryId: z.uuid() });

export const auditGetOutput = auditRow.extend({
  before: z.json().optional(),
  after: z.json().optional(),
});

export const homeSummaryOutput = z.object({
  queues: z.object({
    applications: z.object({
      open: z.int().min(0),
      oldestAgeHours: z.int().min(0).optional(),
      waitingOnApplicant: z.int().min(0),
    }),
    credentials: z.object({
      open: z.int().min(0),
      /** The oldest waiting credential's age, as the applications card says its own (B14d). */
      oldestAgeHours: z.int().min(0).optional(),
      addedSubjects: z.int().min(0),
    }),
  }),
  /** The latest `admin_home_latest_actions` entries, newest first. */
  latestActions: z.array(auditRow),
});
