// T024 of specs/005-certification: the administrator surface's `settings` namespace
// (contracts/admin-surface.md, `settings.list` and `settings.update`; FR-624; SRS FR-ADMIN-9,
// §3.14; research R-410; the note under T024, Q-X1 (a), Q-S1 (a)).
//
// `list` answers every key of the API's settings registry (`platform/settings/registry.ts`) with
// the value stored, its bounds, its unit, its group on the panel's page and the SRS §3.14 row it
// governs; the units, groups and bound shapes below are the registry's own words. `update` takes a
// key, a value in one of the registry's shapes, the administrator's reason and a key of
// idempotency; it is refused VALIDATION_FAILED with one of the registry's three reasons
// (`settingRefusal`) as the detail's code: `unknown` (path `key`), `invalid` or `out_of_bounds`
// (path `value`). It answers the key and the value stored. Additive only once merged (R-API-9).
import { z } from 'zod';

import { idempotencyKey } from '../idempotency-key.js';
import { adminReason } from './admins.js';

/** A settings key as the seed writes it: lower-case words joined by `_`. */
export const settingKey = z
  .string()
  .max(100)
  .regex(/^[a-z][a-z0-9_]*$/);

/** What a setting's number counts (the registry's `SettingUnit`). */
export const settingUnit = z.enum([
  'percent',
  'seconds',
  'minutes',
  'hours',
  'days',
  'weeks',
  'count',
  'bytes',
  'rate_limit',
  'version',
]);

/** The panel's section a setting is listed under (the registry's `SettingGroup`). */
export const settingGroup = z.enum([
  'booking',
  'sessions',
  'notifications',
  'general',
  'accounts',
  'admin',
  'rateLimits',
]);

/** One number's range; `max` null where no document names one (the registry's `SettingBound`). */
export const settingBound = z.object({
  min: z.number(),
  minExclusive: z.boolean(),
  max: z.number().nullable(),
});

/** Where a value's numbers sit (the registry's `SettingBounds`). */
export const settingBounds = z.discriminatedUnion('shape', [
  z.object({ shape: z.literal('number'), value: settingBound }),
  z.object({ shape: z.literal('list'), each: settingBound }),
  z.object({ shape: z.literal('rate_limit'), limit: settingBound, windowSeconds: settingBound }),
  z.object({ shape: z.literal('text') }),
]);

/** A value in one of the registry's shapes: a number, a list, a rate limit or a text. */
const settingValue = z.json();

export const adminSetting = z.object({
  key: settingKey,
  /** The stored JSON value; null when no row holds the key. */
  value: settingValue,
  bounds: settingBounds,
  unit: settingUnit,
  group: settingGroup,
  /** The SRS §3.14 row's setting cell, or «§3.14, operational settings». */
  srsRow: z.string(),
});

export const adminSettingsListOutput = z.object({ items: z.array(adminSetting) });

export const adminSettingsUpdateInput = z.object({
  key: settingKey,
  value: settingValue,
  reason: adminReason,
  idempotencyKey,
});

export const adminSettingsUpdateOutput = z.object({ key: settingKey, value: settingValue });

/** Why a change was refused: the registry's `SettingRefusal`, a VALIDATION_FAILED detail's code. */
export const settingUpdateRefusal = z.enum(['unknown', 'invalid', 'out_of_bounds']);

export type AdminSetting = z.infer<typeof adminSetting>;
export type AdminSettingsUpdateInput = z.infer<typeof adminSettingsUpdateInput>;
export type AdminSettingsUpdateOutput = z.infer<typeof adminSettingsUpdateOutput>;
