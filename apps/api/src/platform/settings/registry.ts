// T002 of specs/005-certification (research R-410; FR-624, FR-626): every settings key the seed
// plants, with its schema, its bounds, its unit, its group on the panel's settings page (T024) and the
// SRS §3.14 row it governs.
//
// EXACTLY THE SEED'S KEYS (Q2 (a), B45's conflict check). `tests/seed/settings-registry.spec.ts`
// runs the real `prisma/seed.ts` and asserts the two lists are equal, both ways. A §3.14 row with no
// seed key yet joins with its seed row, in the batch that seeds it.
//
// THE SCHEMA IS THE READ SITE'S. Where the kernel or a shared package reads a key, its schema is
// imported here, never restated: `rateLimitSetting`, `uploadMaxBytes`, `documentLinkTtl`,
// `liveMaxConnections`, and the contracts' `termsVersion`, `checkoutPolling`, `teacherSharePercent`
// and `priceAverageMinTeachers` (track 2's two keys, joined at B45's merge of develop). A module's read
// site cannot be imported (the kernel depends on no module, docs/ARCHITECTURE.md:206), so the rule
// it reads with is stated once below and the spec checks it against every module schema a public
// entry exports.
//
// BOUNDS (Q3 (a)). The minimum is the read site's schema's: the spec asserts the schema admits it
// and refuses the value below it. A maximum stands only where a document or the unit names one:
// a percent is at most 100; the signed-in default's limit is at most 200 (SRS NFR-SEC-12);
// `price_average_min_teachers` is at most 100 (§3.14's row, «2–100»); a signed
// link lives at most `MAX_LINK_SECONDS` (the storage port refuses longer). No other number is
// chosen here; the full table of minima and maxima waits for the owner's signature after 11/27
// (the «Moved» line under T002).
import {
  checkoutPolling,
  priceAverageMinTeachers,
  teacherSharePercent,
  termsVersion,
} from '@ijazah/contracts';
import { z } from 'zod';

import { rateLimitSetting } from '../guards/rate-limit.guard.js';
import { uploadMaxBytes } from '../guards/upload.middleware.js';
import { MAX_LINK_SECONDS } from '../ports/storage/storage.port.js';
import { documentLinkTtl, liveMaxConnections } from './keys.js';

export type SettingUnit =
  | 'percent'
  | 'seconds'
  | 'minutes'
  | 'hours'
  | 'days'
  | 'weeks'
  | 'count'
  | 'bytes'
  | 'rate_limit'
  | 'version';

/** The panel's sections; the first four are the catalogue's (`apps/admin/src/i18n/*.json`, `settings.groups`). */
export type SettingGroup =
  'booking' | 'sessions' | 'notifications' | 'general' | 'accounts' | 'admin' | 'rateLimits';

/** One number's range. `minExclusive` when the schema refuses the minimum itself (`positive()` on a decimal). */
export interface SettingBound {
  readonly min: number;
  readonly minExclusive: boolean;
  /** Only where a document or the unit names one (Q3 (a)); otherwise none. */
  readonly max: number | null;
}

/** Where the numbers of a value sit: the value, each offset of a list, or a rate limit's two fields. */
export type SettingBounds =
  | { readonly shape: 'number'; readonly value: SettingBound }
  | { readonly shape: 'list'; readonly each: SettingBound }
  | {
      readonly shape: 'rate_limit';
      readonly limit: SettingBound;
      readonly windowSeconds: SettingBound;
    }
  | { readonly shape: 'text' };

export interface SettingEntry {
  readonly schema: z.ZodType;
  readonly bounds: SettingBounds;
  readonly unit: SettingUnit;
  readonly group: SettingGroup;
  /** The §3.14 row's setting cell, without its italic notes, or `OPERATIONAL_SETTINGS_ROW`. */
  readonly srsRow: string;
}

/** A key of the paragraph after §3.14's table, read by a sweep or a service, not a person's decision. */
export const OPERATIONAL_SETTINGS_ROW = '§3.14, operational settings';

/** A whole number, at least one: the rule most read sites hold, each in its own module. */
export const positiveWhole = z.int().positive();

/** A whole number, zero included: a lead, a grace, a buffer or a window that may be none. */
export const wholeNonNegative = z.int().nonnegative();

/** `attendance_threshold_pct`, as `sessions/evaluation.service.ts` and `telemetry.ts` read it. */
export const attendancePercent = z.number().positive();

/**
 * `reminder_offsets_minutes`: read by `jobs/send-reminder.ts` (005:T017). Each
 * offset is a whole number of minutes ahead of the session (SRS FR-BOOK-8, «ahead of each session»).
 */
export const reminderOffsets = z.array(z.int().positive());

/** A percent's ceiling: the unit's. */
const PERCENT_MAX = 100;

/**
 * `ijazah_half_release_percent` (003:T105): a whole percent from 0 to 100, SRS §3.14's row. The read
 * site's schema: payments' checkout imports it from here (the kernel depends on no module).
 */
export const ijazahHalfReleasePercent = z.int().min(0).max(PERCENT_MAX);

/** `price_average_min_teachers`' ceiling: SRS §3.14's row, «2–100» (003:T113, DEC-88). */
const PRICE_AVERAGE_MIN_TEACHERS_MAX = 100;

/** The signed-in default's ceiling: «a result above 200 sets no number» (SRS NFR-SEC-12). */
const SIGNED_IN_DEFAULT_LIMIT_MAX = 200;

const atLeast = (min: number, max: number | null = null): SettingBound => ({
  min,
  minExclusive: false,
  max,
});

function whole(
  schema: z.ZodType,
  unit: SettingUnit,
  group: SettingGroup,
  srsRow: string,
  options: { readonly min?: number; readonly max?: number } = {},
): SettingEntry {
  return {
    schema,
    bounds: { shape: 'number', value: atLeast(options.min ?? 1, options.max ?? null) },
    unit,
    group,
    srsRow,
  };
}

function rateLimit(srsRow: string, limitMax: number | null = null): SettingEntry {
  return {
    schema: rateLimitSetting,
    bounds: { shape: 'rate_limit', limit: atLeast(1, limitMax), windowSeconds: atLeast(1) },
    unit: 'rate_limit',
    group: 'rateLimits',
    srsRow,
  };
}

const KEPT_DATA_LIMITS =
  'Kept data rate limits: the erasure date, the erasure now and the document link, each (per Administrator, per window)';

export const SETTINGS_REGISTRY: Readonly<Record<string, SettingEntry>> = {
  attendance_threshold_pct: {
    schema: attendancePercent,
    bounds: { shape: 'number', value: { min: 0, minExclusive: true, max: PERCENT_MAX } },
    unit: 'percent',
    group: 'sessions',
    srsRow: 'Attendance threshold (%)',
  },
  join_window_minutes: whole(
    wholeNonNegative,
    'minutes',
    'sessions',
    'Join window (minutes after start)',
    { min: 0 },
  ),
  minimum_connection_seconds: whole(
    wholeNonNegative,
    'seconds',
    'sessions',
    'Minimum connection duration (seconds)',
    { min: 0 },
  ),
  early_join_lead_minutes: whole(
    wholeNonNegative,
    'minutes',
    'sessions',
    'Early-join lead time (minutes)',
    { min: 0 },
  ),
  dispute_window_hours: whole(positiveWhole, 'hours', 'sessions', 'Dispute window (hours)'),
  slot_hold_ttl_minutes: whole(
    positiveWhole,
    'minutes',
    'booking',
    'Slot-hold and gateway-order TTL at checkout (minutes); the hold adds the grace below',
  ),
  slot_hold_grace_minutes: whole(
    wholeNonNegative,
    'minutes',
    'booking',
    'Slot-hold grace after the gateway order expires (minutes)',
    { min: 0 },
  ),
  checkout_confirmation_timeout_seconds: whole(
    checkoutPolling.shape.confirmationTimeoutSeconds,
    'seconds',
    'booking',
    'Checkout confirmation timeout (seconds)',
  ),
  idempotency_key_ttl_hours: whole(
    positiveWhole,
    'hours',
    'booking',
    'Idempotency key retention (hours)',
  ),
  slot_release_buffer_weeks: whole(
    wholeNonNegative,
    'weeks',
    'booking',
    'Slot release buffer (weeks)',
    { min: 0 },
  ),
  reminder_offsets_minutes: {
    schema: reminderOffsets,
    bounds: { shape: 'list', each: atLeast(1) },
    unit: 'minutes',
    group: 'notifications',
    srsRow: 'Session reminder offsets',
  },
  chat_retention_days: whole(
    wholeNonNegative,
    'days',
    'notifications',
    'Chat retention beyond dispute window (days)',
    { min: 0 },
  ),
  rate_limit_authentication: rateLimit('Authentication rate limit (per subject, per window)'),
  rate_limit_one_time_code: rateLimit('One-time code rate limit (per subject, per window)'),
  rate_limit_search: rateLimit('Search rate limit (per subject, per window)'),
  rate_limit_payment_initiation: rateLimit(
    'Payment initiation rate limit (per subject, per window)',
  ),
  rate_limit_one_time_code_budget: rateLimit('One-time code budget (platform-wide, per window)'),
  rate_limit_authentication_budget: rateLimit('Authentication budget (platform-wide, per window)'),
  admin_lockout_attempts: whole(
    positiveWhole,
    'count',
    'admin',
    'Admin failed sign-in attempts before lockout',
  ),
  admin_lockout_minutes: whole(
    positiveWhole,
    'minutes',
    'admin',
    'Admin lockout duration (minutes)',
  ),
  makeup_choice_window_days: whole(
    positiveWhole,
    'days',
    'sessions',
    'Make-up choice window (days)',
  ),
  otp_code_ttl_minutes: whole(
    positiveWhole,
    'minutes',
    'accounts',
    'One-time code validity (minutes)',
  ),
  otp_max_attempts: whole(
    positiveWhole,
    'count',
    'accounts',
    'One-time code attempts before it is void (count)',
  ),
  otp_purge_after_hours: whole(positiveWhole, 'hours', 'accounts', OPERATIONAL_SETTINGS_ROW),
  onboarding_token_ttl_minutes: whole(
    positiveWhole,
    'minutes',
    'accounts',
    'Onboarding token validity (minutes)',
  ),
  session_access_ttl_minutes: whole(
    positiveWhole,
    'minutes',
    'accounts',
    'Access token validity (minutes)',
  ),
  session_refresh_ttl_days: whole(
    positiveWhole,
    'days',
    'accounts',
    'Refresh token validity (days)',
  ),
  session_refresh_grace_seconds: whole(
    positiveWhole,
    'seconds',
    'accounts',
    OPERATIONAL_SETTINGS_ROW,
  ),
  session_purge_after_days: whole(positiveWhole, 'days', 'accounts', OPERATIONAL_SETTINGS_ROW),
  admin_session_idle_minutes: whole(
    positiveWhole,
    'minutes',
    'admin',
    'Admin session idle timeout (minutes)',
  ),
  admin_session_max_hours: whole(
    positiveWhole,
    'hours',
    'admin',
    'Admin session maximum length (hours)',
  ),
  admin_invite_ttl_hours: whole(
    positiveWhole,
    'hours',
    'admin',
    'Admin invite link validity (hours)',
  ),
  push_token_stale_days: whole(positiveWhole, 'days', 'notifications', OPERATIONAL_SETTINGS_ROW),
  terms_version: {
    schema: termsVersion,
    bounds: { shape: 'text' },
    unit: 'version',
    group: 'general',
    srsRow: 'Terms of service version in force',
  },
  upload_max_bytes: whole(uploadMaxBytes, 'bytes', 'general', 'Upload size limit (bytes)'),
  rate_limit_public_page: rateLimit('Public page rate limit (requests per window)'),
  rate_limit_upload: rateLimit('Upload rate limit (requests per window)'),
  admin_recovery_code_count: whole(
    positiveWhole,
    'count',
    'admin',
    'Admin recovery codes issued (count)',
  ),
  admin_home_latest_actions: whole(
    positiveWhole,
    'count',
    'admin',
    'Admin home: latest actions shown (count)',
  ),
  admin_list_page_size: whole(positiveWhole, 'count', 'admin', 'Admin list page size (rows)'),
  provider_nonce_ttl_minutes: whole(
    positiveWhole,
    'minutes',
    'accounts',
    'Provider sign-in nonce validity (minutes)',
  ),
  document_link_ttl_seconds: whole(
    documentLinkTtl,
    'seconds',
    'general',
    'Signed document link validity (seconds)',
    {
      max: MAX_LINK_SECONDS,
    },
  ),
  rate_limit_token_refresh: rateLimit('Token refresh rate limit (per token, per window)'),
  rate_limit_provider_nonce: rateLimit(
    'Provider nonce rate limit (per client address, per window)',
  ),
  document_unreferenced_purge_after_hours: whole(
    positiveWhole,
    'hours',
    'general',
    OPERATIONAL_SETTINGS_ROW,
  ),
  document_unreferenced_max_per_user: whole(
    positiveWhole,
    'count',
    'general',
    OPERATIONAL_SETTINGS_ROW,
  ),
  rate_limit_admin_authentication: rateLimit(
    'Admin authentication rate limit (per subject, per window)',
  ),
  rate_limit_admin_authentication_budget: rateLimit(
    'Admin authentication budget (platform-wide, per window)',
  ),
  rate_limit_provider_nonce_budget: rateLimit('Provider nonce budget (platform-wide, per window)'),
  first_session_lead_hours: whole(
    wholeNonNegative,
    'hours',
    'booking',
    'First session lead after confirmation (hours)',
    { min: 0 },
  ),
  checkout_processing_poll_seconds: whole(
    checkoutPolling.shape.processingPollSeconds,
    'seconds',
    'booking',
    'Checkout Processing status read interval (seconds)',
  ),
  checkout_confirming_poll_seconds: whole(
    checkoutPolling.shape.confirmingPollSeconds,
    'seconds',
    'booking',
    'Checkout Confirming status read interval (seconds)',
  ),
  checkout_confirming_poll_window_minutes: whole(
    checkoutPolling.shape.confirmingPollWindowMinutes,
    'minutes',
    'booking',
    'Checkout Confirming read window from release (minutes)',
  ),
  discovery_page_size: whole(positiveWhole, 'count', 'booking', 'Discovery page size (teachers)'),
  // 003:T104 (ADR 0025 D1, SRS DEC-80): the read site's own bounds, 0 to 100, a percent's; on the
  // panel's general settings page, as DEC-80 and ADR 0025 D1 place it (#145 r1 nit 2).
  teacher_share_percent: whole(
    teacherSharePercent,
    'percent',
    'general',
    "Teacher's share of each gateway order (whole percent, 0–100)",
    { min: 0, max: PERCENT_MAX },
  ),
  // 003:T113 (SRS DEC-88): 2 to 100, the bounds §3.14's row names and the read site holds.
  price_average_min_teachers: whole(
    priceAverageMinTeachers,
    'count',
    'booking',
    "Fewest other Teachers for the average price (whole number, 2–100: at least 2, so no single Teacher's price is shown)",
    { min: 2, max: PRICE_AVERAGE_MIN_TEACHERS_MAX },
  ),
  // 003:T105 (SRS DEC-81): 0 to 100, a percent's; on the general settings page with the teacher's
  // share, as rule 16 places every rate (Q-B1-7).
  ijazah_half_release_percent: whole(
    ijazahHalfReleasePercent,
    'percent',
    'general',
    "Ijazah track: share released at half the sessions (percent of the Teacher's share, 0–100)",
    { min: 0, max: PERCENT_MAX },
  ),
  // 003:T105: the administrator's mark «تم الصرف» and its undo, §3.14's row of 2026-11-18 (Q-B1-12 (a)).
  rate_limit_payout_mark: rateLimit(
    'Payout release mark or unmark rate limit (per Administrator, per window)',
  ),
  // 003:T112 (SRS §3.8.6, DEC-86, DEC-90): a postponement's notice before each session it covers
  // (FR-POSTPONE-3) and its interval per party per enrollment (FR-POSTPONE-4), each at least 1.
  postponement_notice_hours: whole(
    positiveWhole,
    'hours',
    'sessions',
    'Postponement notice before a session (hours, at least 1)',
  ),
  postponement_interval_weeks: whole(
    positiveWhole,
    'weeks',
    'sessions',
    'Postponement interval per party (weeks, at least 1)',
  ),
  session_evaluation_delay_minutes: whole(
    wholeNonNegative,
    'minutes',
    'sessions',
    'Session evaluation delay after scheduled end (minutes)',
    { min: 0 },
  ),
  rate_limit_chat_message: rateLimit('Chat message rate limit (per subject, per window)'),
  makeup_counter_answer_hours: whole(
    positiveWhole,
    'hours',
    'sessions',
    'Make-up counter-proposal answer window (hours)',
  ),
  chat_page_size: whole(positiveWhole, 'count', 'notifications', 'Chat page size (messages)'),
  cancellation_requests_recent_days: whole(
    positiveWhole,
    'days',
    'sessions',
    'Cancellation requests recent period (days)',
  ),
  video_empty_timeout_seconds: whole(
    positiveWhole,
    'seconds',
    'sessions',
    'Video room empty timeout (seconds)',
  ),
  video_departure_timeout_seconds: whole(
    positiveWhole,
    'seconds',
    'sessions',
    'Video room departure timeout (seconds)',
  ),
  repeated_absence_flag_count: whole(
    positiveWhole,
    'count',
    'sessions',
    'Repeated-absence flag count (Teacher-No-Shows per Enrollment)',
  ),
  enrollment_restore_window_days: whole(
    positiveWhole,
    'days',
    'sessions',
    'Enrollment restore window (days)',
  ),
  rate_limit_absence_complaint: rateLimit('Absence complaint rate limit (per subject, per window)'),
  rate_limit_signed_in_default: rateLimit(
    'Signed-in default rate limit (per signed-in User or Administrator, per window)',
    SIGNED_IN_DEFAULT_LIMIT_MAX,
  ),
  rate_limit_dispute_revision: rateLimit(
    'Dispute ruling revision rate limit (per Administrator, per window)',
  ),
  rate_limit_enrollment_restore: rateLimit(
    'Enrollment restore rate limit (per Administrator, per window)',
  ),
  rate_limit_manual_compensation_case: rateLimit(
    'Manual compensation case rate limit (per Administrator, per window)',
  ),
  rate_limit_outcome_correction: rateLimit(
    'Outcome correction rate limit (per Administrator, per window)',
  ),
  rate_limit_live_channel: rateLimit('Live channel open rate limit (per User, per window)'),
  live_channel_max_connections_per_user: whole(
    liveMaxConnections,
    'count',
    'general',
    'Live channel connections per User',
  ),
  room_close_grace_minutes: whole(
    wholeNonNegative,
    'minutes',
    'sessions',
    'Session room close grace after the scheduled end (minutes)',
    { min: 0 },
  ),
  room_close_retry_minutes: whole(
    positiveWhole,
    'minutes',
    'sessions',
    'Session room close retries after the scheduled end plus the grace (minutes)',
  ),
  ban_restore_window_days: whole(positiveWhole, 'days', 'sessions', 'Ban restore window (days)'),
  rate_limit_ban_lift: rateLimit('Ban lift rate limit (per Administrator, per window)'),
  rate_limit_slot_release: rateLimit(
    'Held slot release rate limit (per Administrator, per window)',
  ),
  rate_limit_kept_data_erase_date: rateLimit(KEPT_DATA_LIMITS),
  rate_limit_kept_data_erase_now: rateLimit(KEPT_DATA_LIMITS),
  rate_limit_kept_document_link: rateLimit(KEPT_DATA_LIMITS),
  rate_limit_admin_user_delete: rateLimit(
    "Administrator's deletion rate limit (per Administrator, per window)",
  ),
  rate_limit_enrollment_end: rateLimit('Enrollment end rate limit (per Administrator, per window)'),
  rate_limit_user_report: rateLimit('User report rate limit (per User, per window)'),
  rate_limit_gender_flag: rateLimit('Gender flag rate limit (per User, per window)'),
  rate_limit_ijazah_request: rateLimit('Ijazah request rate limit (per Teacher, per window)'),
  rate_limit_ijazah_decision: rateLimit(
    "Ijazah decision rate limit: approve, reject, sign off, re-render, revoke, bar and the certificate name's change, each (per Administrator, per window)",
  ),
  rate_limit_gender_decision: rateLimit(
    'Gender decision rate limit: raise, dismiss, correct and fraud ban, each (per Administrator, per window)',
  ),
  rate_limit_settings_update: rateLimit(
    'Settings change rate limit (per Administrator, per window)',
  ),
  // T017 of specs/005-certification (SRS DEC-74; the follow-up under T005 and the note under T017,
  // Q-N4 (a)): `send-reminder` queues again a notification whose push was not queued after its
  // commit, once it is this old, and no longer once it is older than the maximum age.
  notification_requeue_after_minutes: whole(
    positiveWhole,
    'minutes',
    'notifications',
    'Notification queued again after a lost enqueue: the wait before it is queued again (minutes)',
  ),
  notification_requeue_max_age_minutes: whole(
    positiveWhole,
    'minutes',
    'notifications',
    'Notification queued again after a lost enqueue: the age after which it is no longer sent (minutes)',
  ),
};

/** Whether `key` is a setting the registry names (and so one the panel may change). */
export function isRegisteredSetting(key: string): boolean {
  return Object.hasOwn(SETTINGS_REGISTRY, key);
}

export type SettingRefusal = 'unknown' | 'invalid' | 'out_of_bounds';

function inBound({ min, minExclusive, max }: SettingBound, value: number): boolean {
  const aboveMin = minExclusive ? value > min : value >= min;
  return aboveMin && (max === null || value <= max);
}

function inBounds(bounds: SettingBounds, value: unknown): boolean {
  switch (bounds.shape) {
    case 'number':
      return inBound(bounds.value, value as number);
    case 'list':
      return (value as readonly number[]).every((each) => inBound(bounds.each, each));
    case 'rate_limit': {
      const { limit, window_seconds } = value as { limit: number; window_seconds: number };
      return inBound(bounds.limit, limit) && inBound(bounds.windowSeconds, window_seconds);
    }
    case 'text':
      return true;
  }
}

/** Why `value` may not be stored under `key`, or undefined when it may. */
export function settingRefusal(key: string, value: unknown): SettingRefusal | undefined {
  if (!isRegisteredSetting(key)) return 'unknown';
  const entry = SETTINGS_REGISTRY[key] as SettingEntry;
  const parsed = entry.schema.safeParse(value);
  if (!parsed.success) return 'invalid';
  return inBounds(entry.bounds, parsed.data) ? undefined : 'out_of_bounds';
}

/** The keys on one side only: seeded but not registered, and registered but not seeded. */
export function registryMismatch(seededKeys: Iterable<string>): {
  readonly notInRegistry: readonly string[];
  readonly notSeeded: readonly string[];
} {
  const seeded = new Set(seededKeys);
  return {
    notInRegistry: [...seeded].filter((key) => !isRegisteredSetting(key)),
    notSeeded: Object.keys(SETTINGS_REGISTRY).filter((key) => !seeded.has(key)),
  };
}
