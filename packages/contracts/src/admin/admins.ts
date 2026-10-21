// T067: the administrator surface's `admins` namespace (admin-surface.md "`admins` — the admins
// page"; FR-173, FR-174). A destructive action's reason is mandatory (screens.md §24, "Dialog
// variants"), and every list is a page of `admin_list_page_size` rows.
import { z } from 'zod';

import { displayName } from '../onboarding.js';
import { emailAddress } from '../platform.js';

/** Why an administrator acted, typed in the dialog; it reaches the audit log as written. */
export const adminReason = z.string().trim().min(1).max(1000);

/** A list's search, matched as typed text, never a pattern (`%` and `_` are plain characters). */
export const adminSearch = z.string().trim().min(1).max(100);

/** A list's page, the first being 1. */
export const adminPage = z.int().min(1);

export const adminsTab = z.enum(['active', 'disabled']);

export const adminsListInput = z.object({
  tab: adminsTab,
  search: adminSearch.optional(),
  page: adminPage,
});

export const adminsListRow = z.object({
  adminId: z.uuid(),
  displayName: z.string(),
  email: z.string(),
  /** The row is the reading administrator's own, which the page does not offer to disable. */
  self: z.boolean(),
  mfaEnrolled: z.boolean(),
  lastSignInAt: z.iso.datetime().optional(),
  invitedAt: z.iso.datetime().optional(),
  invitedByName: z.string().optional(),
  recoveryCodesLeft: z.int().min(0),
  disabledAt: z.iso.datetime().optional(),
});

export const adminsListOutput = z.object({ rows: z.array(adminsListRow), total: z.int().min(0) });

export const adminsAddInput = z.object({ displayName, email: emailAddress });

export const adminsAddOutput = z.object({ adminId: z.uuid() });

export const adminsDisableInput = z.object({ adminId: z.uuid(), reason: adminReason });

export const adminsResetMfaInput = z.object({ adminId: z.uuid(), reason: adminReason });
