// 005:T024 (B49; FR-624; R-410; the note under T024, Q-S1 (a)): what the settings page says of a
// setting, from what `settings.list` answers. A key's label is `admin.settings.keys.<key>` and a
// group's `admin.settings.groups.<group>`, both checked for every registry key and group, in both
// languages, by `tests/admin-i18n/settings-labels.spec.ts`. The groups come in the contract's order
// (`settingGroup`, the registry's `SettingGroup`). A value is drawn with its unit: a list item by item,
// a rate limit as «N per S s», a key no row holds as not set. A bound as the registry states it (its
// minimum included or not, its maximum where one stands). A change is written in the setting's own
// shape (`draftOf`, `parsedDraft`), and a refused one is said by its code: VALIDATION_FAILED with
// one of `settingUpdateRefusal`'s reasons in its own words, `CONFLICT` as the panel's reused-key
// words, `RATE_LIMITED` with when to try again through T058's `errorMessageKey`, which keeps the
// generic words for any other failure. 006:T002 (B-P1 Q-6, Q-B1 (a); the owner's «تظهر جنيه فقط»):
// an amount of the unit `piasters` is drawn, bounded, opened and typed in pounds only, at most two
// decimals, through `formatPounds` and `packages/money`'s `poundsText` and `piastersOfPoundsText`,
// and sent in whole piasters; no word names a piaster.
import { type AdminSetting, settingGroup, settingUpdateRefusal } from '@ijazah/contracts/admin';
import {
  isPiasters,
  piasters,
  piastersOfPoundsText,
  poundsText,
  toPlainNumber,
} from '@ijazah/money';

import { formattingTag, type Locale, type MessageKey, type MessageValues } from '../../i18n';
import { errorCodeOf, errorDetailsOf } from '../../lib/client';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';
import { formatPounds } from '../../lib/format';

type Group = AdminSetting['group'];
type Unit = AdminSetting['unit'];
type Bounds = AdminSetting['bounds'];
type Bound = Extract<Bounds, { shape: 'number' }>['value'];
type SettingValue = AdminSetting['value'];
type Refusal = (typeof settingUpdateRefusal.options)[number];
type Translate = (key: MessageKey, values?: MessageValues) => string;

/**
 * The signed-in default's limit is held up to 60 s after each read
 * (`apps/api/src/platform/guards/rate-limit.guard.ts:107`, `DEFAULT_LIMIT_SETTING_HOLD_MS`), so a
 * change to it applies within 60 s rather than at the next read.
 */
export const SIGNED_IN_DEFAULT = 'rate_limit_signed_in_default';

/** The groups in the page's order: the contract's. */
export const GROUP_ORDER: readonly Group[] = settingGroup.options;

export const GROUP_LABEL: Readonly<Record<Group, MessageKey>> = {
  booking: 'admin.settings.groups.booking',
  sessions: 'admin.settings.groups.sessions',
  notifications: 'admin.settings.groups.notifications',
  general: 'admin.settings.groups.general',
  accounts: 'admin.settings.groups.accounts',
  admin: 'admin.settings.groups.admin',
  rateLimits: 'admin.settings.groups.rateLimits',
};

/** A key's label: every registry key has one (the labels spec). */
export function labelKey(key: string): MessageKey {
  return `admin.settings.keys.${key}` as MessageKey;
}

/** A number in its unit; a rate limit's and a version's are drawn whole elsewhere. */
const UNIT: Readonly<Record<Exclude<Unit, 'rate_limit' | 'version'>, MessageKey>> = {
  percent: 'admin.settings.units.percent',
  seconds: 'admin.settings.units.seconds',
  minutes: 'admin.settings.units.minutes',
  hours: 'admin.settings.units.hours',
  days: 'admin.settings.units.days',
  weeks: 'admin.settings.units.weeks',
  count: 'admin.settings.units.count',
  bytes: 'admin.settings.units.bytes',
  piasters: 'admin.settings.units.piasters',
};

interface RateLimit {
  readonly limit: number;
  readonly window_seconds: number;
}

function isRateLimit(value: SettingValue): value is RateLimit & SettingValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value['limit'] === 'number' &&
    typeof value['window_seconds'] === 'number'
  );
}

/** Whether `value` is an amount of piasters the page draws and takes in pounds (006:T002). */
function isAmount(unit: Unit, value: unknown): value is number {
  return unit === 'piasters' && typeof value === 'number' && isPiasters(value);
}

function amount(t: Translate, locale: Locale, unit: Unit, value: SettingValue): string {
  if (isAmount(unit, value)) {
    return t(UNIT.piasters, { value: formatPounds(piasters(value), locale) });
  }
  if (typeof value === 'number' && unit !== 'rate_limit' && unit !== 'version') {
    return t(UNIT[unit], { value });
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** The value as the page draws it, with its unit. */
export function valueText(
  t: Translate,
  locale: Locale,
  { value, unit }: Pick<AdminSetting, 'value' | 'unit'>,
): string {
  if (value === null) return t('admin.settings.value.missing');
  if (isRateLimit(value)) {
    return t('admin.settings.value.rateLimit', {
      limit: value.limit,
      window: value.window_seconds,
    });
  }
  if (Array.isArray(value)) {
    return new Intl.ListFormat(formattingTag(locale), { type: 'unit', style: 'short' }).format(
      value.map((each) => amount(t, locale, unit, each)),
    );
  }
  return amount(t, locale, unit, value);
}

/** A bound's number as the page writes it: an amount of piasters in pounds, any other as itself. */
type BoundNumber = (value: number) => string | number;

function boundText(t: Translate, { min, minExclusive, max }: Bound, written: BoundNumber): string {
  if (max === null) {
    return t(minExclusive ? 'admin.settings.bounds.above' : 'admin.settings.bounds.atLeast', {
      min: written(min),
    });
  }
  return t(minExclusive ? 'admin.settings.bounds.aboveUpTo' : 'admin.settings.bounds.between', {
    min: written(min),
    max: written(max),
  });
}

/** The bounds as the registry states them; an amount of piasters in pounds (006:T002). */
export function boundsText(
  t: Translate,
  locale: Locale,
  { bounds, unit }: Pick<AdminSetting, 'bounds' | 'unit'>,
): string {
  const written: BoundNumber = (value) =>
    isAmount(unit, value) ? formatPounds(piasters(value), locale) : value;
  switch (bounds.shape) {
    case 'number':
      return boundText(t, bounds.value, written);
    case 'list':
      return t('admin.settings.bounds.each', { bound: boundText(t, bounds.each, written) });
    case 'rate_limit':
      return t('admin.settings.bounds.rateLimit', {
        limit: boundText(t, bounds.limit, written),
        window: boundText(t, bounds.windowSeconds, written),
      });
    case 'text':
      return t('admin.settings.bounds.none');
  }
}

/** What the change dialog's fields hold: one text, or a rate limit's two. */
export interface Draft {
  readonly first: string;
  readonly second: string;
}

/** The fields opened on the value now; an amount of piasters in pounds (006:T002). */
export function draftOf({ value, unit }: Pick<AdminSetting, 'value' | 'unit'>): Draft {
  if (value === null) return { first: '', second: '' };
  if (isAmount(unit, value)) return { first: poundsText(piasters(value)), second: '' };
  if (isRateLimit(value)) {
    return { first: String(value.limit), second: String(value.window_seconds) };
  }
  if (Array.isArray(value)) return { first: value.map(String).join(', '), second: '' };
  return { first: String(value), second: '' };
}

const NUMBER = /^-?\d+(?:\.\d+)?$/;

function numberOf(text: string): number | undefined {
  const trimmed = text.trim();
  return NUMBER.test(trimmed) ? Number(trimmed) : undefined;
}

/** An amount typed in pounds, at most two decimals, as whole piasters; undefined otherwise. */
function piastersTyped(text: string): number | undefined {
  const typed_piasters = piastersOfPoundsText(text);
  return typed_piasters === null ? undefined : toPlainNumber(typed_piasters);
}

/**
 * The value the fields say, in the setting's shape, or undefined while they say none. Whether it
 * is whole and inside its bounds is the server's to judge (`settingRefusal`); an amount of
 * piasters is typed in pounds and sent in piasters (006:T002).
 */
export function parsedDraft(
  { bounds, unit }: Pick<AdminSetting, 'bounds' | 'unit'>,
  { first, second }: Draft,
): SettingValue | undefined {
  switch (bounds.shape) {
    case 'number':
      return unit === 'piasters' ? piastersTyped(first) : numberOf(first);
    case 'list': {
      const each = first.split(/[,،]/).map(numberOf);
      return each.some((part) => part === undefined) ? undefined : (each as number[]);
    }
    case 'rate_limit': {
      const limit = numberOf(first);
      const windowSeconds = numberOf(second);
      return limit === undefined || windowSeconds === undefined
        ? undefined
        : { limit, window_seconds: windowSeconds };
    }
    case 'text': {
      const trimmed = first.trim();
      return trimmed === '' ? undefined : trimmed;
    }
  }
}

/** Each reason of a refused change (`settingUpdateRefusal`), in its own words. */
const REFUSED: Readonly<Record<Refusal, MessageKey>> = {
  unknown: 'admin.settings.refused.unknown',
  invalid: 'admin.settings.refused.invalid',
  out_of_bounds: 'admin.settings.refused.outOfBounds',
};

function isRefusal(code: string): code is Refusal {
  return Object.hasOwn(REFUSED, code);
}

/** The words of a refused change; `bounds` is the setting's, said with an out-of-bounds value. */
export function changeFailure(error: unknown, bounds: string): ErrorMessage {
  switch (errorCodeOf(error)) {
    case 'VALIDATION_FAILED': {
      const refusal = errorDetailsOf(error)
        .map(({ code }) => code)
        .find(isRefusal);
      if (refusal === undefined) break;
      return refusal === 'out_of_bounds'
        ? { key: REFUSED[refusal], values: { bounds } }
        : { key: REFUSED[refusal] };
    }
    case 'CONFLICT':
      return { key: 'admin.shared.keyReused' };
  }
  return errorMessageKey(error, 'admin.dialogs.submitError');
}
