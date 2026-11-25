// 005:T024 (B49; FR-624; R-410; the note under T024, Q-S1 (a)): the settings page through the router,
// in both languages. Every key `settings.list` answers, under its group's heading, the groups in the
// contract's order and the keys in the list's: each row its label, its value with its unit (a list
// item by item, a rate limit as «N per S s», a key no row holds as not set), its default drawn as a
// value is, between the value and the bounds (B49's Q-A1 (a)), its bounds and its SRS
// row; `rate_limit_signed_in_default` marked as applying within 60 s, and no other row. The page
// leads to `/settings/admins`. A change: the new value in the setting's shape, the mandatory reason,
// trimmed, and a key, sent once; the dialog says the change applies to every later read at once (the
// signed-in default within 60 s); the list is read again. Each refusal in its own words.
import { piasters } from '@ijazah/money';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { formattingTag, type MessageKey, setLocale, translate } from '../../i18n';
import { formatPounds } from '../../lib/format';
import { actionText } from '../audit/actions';
import {
  currentPath,
  inBothLocales,
  mutation,
  query,
  refusal,
  renderApp,
  type Translate,
} from '../../test/app-harness';

afterEach(() => setLocale('ar'));

const ar: Translate = (key, values) => translate('ar', key, values);

const ADMIN = '0193a6f0-0000-7000-8000-000000000099';

const from = (min: number, max: number | null = null) => ({ min, minExclusive: false, max });

const signedInDefault = {
  key: 'rate_limit_signed_in_default',
  value: { limit: 150, window_seconds: 60 },
  default: { limit: 150, window_seconds: 60 },
  bounds: { shape: 'rate_limit', limit: from(1, 200), windowSeconds: from(1) },
  unit: 'rate_limit',
  group: 'rateLimits',
  srsRow: 'Signed-in default rate limit (per signed-in User or Administrator, per window)',
} as const;
const attendance = {
  key: 'attendance_threshold_pct',
  value: 80,
  default: 70,
  bounds: { shape: 'number', value: { min: 0, minExclusive: true, max: 100 } },
  unit: 'percent',
  group: 'sessions',
  srsRow: 'Attendance threshold (%)',
} as const;
const reminders = {
  key: 'reminder_offsets_minutes',
  value: [1440, 15],
  default: [1440, 15],
  bounds: { shape: 'list', each: from(1) },
  unit: 'minutes',
  group: 'notifications',
  srsRow: 'Session reminder offsets',
} as const;
const holdTtl = {
  key: 'slot_hold_ttl_minutes',
  value: 10,
  default: 10,
  bounds: { shape: 'number', value: from(1) },
  unit: 'minutes',
  group: 'booking',
  srsRow: 'Slot-hold and gateway-order TTL at checkout (minutes); the hold adds the grace below',
} as const;
const terms = {
  key: 'terms_version',
  value: '2026-10',
  default: '2026-10',
  bounds: { shape: 'text' },
  unit: 'version',
  group: 'general',
  srsRow: 'Terms of service version in force',
} as const;
const otpAttempts = {
  key: 'otp_max_attempts',
  value: null,
  default: 5,
  bounds: { shape: 'number', value: from(1) },
  unit: 'count',
  group: 'accounts',
  srsRow: 'One-time code attempts before it is void (count)',
} as const;
const lockout = {
  key: 'admin_lockout_minutes',
  value: 15,
  default: 15,
  bounds: { shape: 'number', value: from(1) },
  unit: 'minutes',
  group: 'admin',
  srsRow: 'Admin lockout duration (minutes)',
} as const;
const settingsChange = {
  key: 'rate_limit_settings_update',
  value: { limit: 10, window_seconds: 60 },
  default: { limit: 10, window_seconds: 60 },
  bounds: { shape: 'rate_limit', limit: from(1), windowSeconds: from(1) },
  unit: 'rate_limit',
  group: 'rateLimits',
  srsRow: 'Settings change rate limit (per Administrator, per window)',
} as const;

/** The list as the server answers it, its groups out of the page's order on purpose. */
const ITEMS = [
  signedInDefault,
  attendance,
  reminders,
  holdTtl,
  terms,
  otpAttempts,
  lockout,
  settingsChange,
];

function fakeApi() {
  const api = {
    settings: { list: query(), update: mutation() },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.settings.list.query.mockResolvedValue({ items: ITEMS });
  api.settings.update.mutate.mockImplementation(async (input) => {
    const { key, value } = input as { key: string; value: unknown };
    return { key, value };
  });
  api.home.summary.query.mockResolvedValue({
    queues: {
      applications: { open: 0, waitingOnApplicant: 0 },
      credentials: { open: 0, addedSubjects: 0 },
    },
    latestActions: [],
  });
  api.auth.me.query.mockResolvedValue({ adminId: ADMIN, displayName: 'سارة عادل', email: 'a@b.c' });
  return api;
}

const verified = { token: 't', step: 'verified' } as const;

function open(api = fakeApi()) {
  return { ...renderApp({ at: '/settings', session: verified, api }), api };
}

const labelOf = (key: string) => `admin.settings.keys.${key}` as MessageKey;
const groupOf = (group: string) => `admin.settings.groups.${group}` as MessageKey;

/** The row whose first cell is `label` (a label may also be an SRS row's words, in English). */
function rowIn(container: Pick<typeof screen, 'getAllByRole'>, label: string) {
  const row = container
    .getAllByRole('row')
    .find((each) => each.querySelector('td')?.textContent === label);
  if (row === undefined) throw new Error(`no row labelled ${label}`);
  return within(row);
}

/** The cell of the row labelled `label` under the column headed `header`. */
function cellIn(container: Pick<typeof screen, 'getAllByRole'>, label: string, header: string) {
  const column = container
    .getAllByRole('columnheader')
    .findIndex((each) => each.textContent === header);
  if (column < 0) throw new Error(`no column headed ${header}`);
  const row = container
    .getAllByRole('row')
    .find((each) => each.querySelector('td')?.textContent === label);
  const cell = row?.querySelectorAll('td')[column];
  if (cell === undefined) throw new Error(`no cell of ${label} under ${header}`);
  return cell;
}

/** The row of `setting`, found by its label. */
async function rowOf(setting: { readonly key: string }, t: Translate = ar) {
  await screen.findAllByText(t(labelOf(setting.key)));
  return rowIn(screen, t(labelOf(setting.key)));
}

async function changeDialog(setting: { readonly key: string }) {
  const row = await rowOf(setting);
  fireEvent.click(
    row.getByRole('button', {
      name: ar('admin.settings.changeA11y', { setting: ar(labelOf(setting.key)) }),
    }),
  );
  return within(await screen.findByRole('dialog'));
}

function write(dialog: ReturnType<typeof within>, label: MessageKey, value: string) {
  fireEvent.change(dialog.getByLabelText(ar(label)), { target: { value } });
}

const confirmOf = (dialog: ReturnType<typeof within>) =>
  dialog.getByRole('button', { name: ar('admin.dialogs.confirm.changeSetting.confirm') });

describe('the settings page (FR-624)', () => {
  it('lists every key under its group, the groups in order: its label, value with unit, default, bounds and SRS row, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        await screen.findByText(t(labelOf(attendance.key)));
        expect(
          screen.getByRole('heading', { level: 1, name: t('admin.settings.title') }),
        ).toBeTruthy();
        expect(
          screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
        ).toEqual(
          [
            'booking',
            'sessions',
            'notifications',
            'general',
            'accounts',
            'admin',
            'rateLimits',
          ].map((group) => t(groupOf(group))),
        );
        const listed = (minutes: readonly number[]) =>
          new Intl.ListFormat(formattingTag(locale), { type: 'unit', style: 'short' }).format(
            minutes.map((value) => t('admin.settings.units.minutes', { value })),
          );
        const rateLimit = t('admin.settings.value.rateLimit', { limit: 150, window: 60 });
        // [setting, value, default (B49's Q-A1 (a): drawn as a value is), bounds]
        const expected = [
          [
            holdTtl,
            t('admin.settings.units.minutes', { value: 10 }),
            t('admin.settings.units.minutes', { value: 10 }),
            t('admin.settings.bounds.atLeast', { min: 1 }),
          ],
          [
            attendance,
            t('admin.settings.units.percent', { value: 80 }),
            t('admin.settings.units.percent', { value: 70 }),
            t('admin.settings.bounds.aboveUpTo', { min: 0, max: 100 }),
          ],
          [
            reminders,
            listed([1440, 15]),
            listed([1440, 15]),
            t('admin.settings.bounds.each', {
              bound: t('admin.settings.bounds.atLeast', { min: 1 }),
            }),
          ],
          [terms, '2026-10', '2026-10', t('admin.settings.bounds.none')],
          [
            otpAttempts,
            t('admin.settings.value.missing'),
            t('admin.settings.units.count', { value: 5 }),
            t('admin.settings.bounds.atLeast', { min: 1 }),
          ],
          [
            lockout,
            t('admin.settings.units.minutes', { value: 15 }),
            t('admin.settings.units.minutes', { value: 15 }),
            t('admin.settings.bounds.atLeast', { min: 1 }),
          ],
          [
            signedInDefault,
            rateLimit,
            rateLimit,
            t('admin.settings.bounds.rateLimit', {
              limit: t('admin.settings.bounds.between', { min: 1, max: 200 }),
              window: t('admin.settings.bounds.atLeast', { min: 1 }),
            }),
          ],
        ] as const;
        for (const [setting, value, fallback, bounds] of expected) {
          const region = within(screen.getByRole('region', { name: t(groupOf(setting.group)) }));
          const label = t(labelOf(setting.key));
          const cell = (header: MessageKey) => cellIn(region, label, t(header));
          expect(within(cell('admin.settings.columns.value')).getByText(value)).toBeTruthy();
          expect(cell('admin.settings.columns.default').textContent).toBe(fallback);
          expect(cell('admin.settings.columns.bounds').textContent).toBe(bounds);
          expect(cell('admin.settings.columns.srsRow').textContent).toBe(setting.srsRow);
        }
        // The default stands between the value and the bounds.
        expect(
          within(screen.getByRole('region', { name: t(groupOf('sessions')) }))
            .getAllByRole('columnheader')
            .map((header) => header.textContent),
        ).toEqual(
          (['setting', 'value', 'default', 'bounds', 'srsRow', 'action'] as const).map((column) =>
            t(`admin.settings.columns.${column}` as MessageKey),
          ),
        );
        const limits = within(screen.getByRole('region', { name: t(groupOf('rateLimits')) }));
        const order = limits
          .getAllByRole('row')
          .slice(1)
          .map((row) => row.querySelector('td')?.textContent);
        expect(order).toEqual([t(labelOf(signedInDefault.key)), t(labelOf(settingsChange.key))]);
      },
    );
  });

  it('marks the signed-in default as applying within 60 s, and no other row', async () => {
    open();
    const row = await rowOf(signedInDefault);
    expect(row.getByText(ar('admin.settings.withinMinute'))).toBeTruthy();
    expect(screen.getAllByText(ar('admin.settings.withinMinute'))).toHaveLength(1);
  });

  it("leads to the administrators' page", async () => {
    open();
    const link = await screen.findByRole('link', { name: ar('admin.admins.title') });
    expect(link.getAttribute('href')).toBe('/settings/admins');
    fireEvent.click(link);
    expect(currentPath()).toBe('/settings/admins');
  });

  it('says the list could not be read, and reads it again on retry', async () => {
    const api = fakeApi();
    api.settings.list.query.mockRejectedValueOnce(refusal('INTERNAL'));
    open(api);
    expect(
      await screen.findByText(
        ar('admin.common.loadError.title', { page: ar('admin.settings.title') }),
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ar('admin.common.action.retry') }));
    expect(await screen.findByText(ar(labelOf(attendance.key)))).toBeTruthy();
  });
});

describe('a change (FR-624: a reason, audited before and after)', () => {
  it.each([
    [holdTtl, [['admin.dialogs.confirm.changeSetting.valueLabel', '12']], 12],
    [reminders, [['admin.dialogs.confirm.changeSetting.valueLabel', '1440، 30']], [1440, 30]],
    [
      settingsChange,
      [
        ['admin.dialogs.confirm.changeSetting.limitLabel', '20'],
        ['admin.dialogs.confirm.changeSetting.windowLabel', '120'],
      ],
      { limit: 20, window_seconds: 120 },
    ],
    [terms, [['admin.dialogs.confirm.changeSetting.valueLabel', ' 2026-12 ']], '2026-12'],
  ] as const)(
    '%# sends the value in its shape, the trimmed reason and a key, once; the list is read again',
    async (setting, fields, value) => {
      const { api } = open();
      const dialog = await changeDialog(setting);
      expect(
        dialog.getByText(ar('admin.dialogs.confirm.changeSetting.effects.everyRead')),
      ).toBeTruthy();
      for (const [label, text] of fields) write(dialog, label, text);
      write(dialog, 'admin.settings.reasonLabel', '  تعديل بعد المراجعة  ');
      fireEvent.click(confirmOf(dialog));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(api.settings.update.mutate).toHaveBeenCalledTimes(1);
      expect(api.settings.update.mutate).toHaveBeenCalledWith({
        key: setting.key,
        value,
        reason: 'تعديل بعد المراجعة',
        idempotencyKey: expect.any(String),
      });
      await waitFor(() => expect(api.settings.list.query).toHaveBeenCalledTimes(2));
    },
  );

  it('says the signed-in default applies within 60 s, not at once', async () => {
    open();
    const dialog = await changeDialog(signedInDefault);
    expect(
      dialog.getByText(ar('admin.dialogs.confirm.changeSetting.effects.withinMinute')),
    ).toBeTruthy();
    expect(
      dialog.queryByText(ar('admin.dialogs.confirm.changeSetting.effects.everyRead')),
    ).toBeNull();
  });

  it('opens on the value now, and holds the confirm until a reason is written', async () => {
    const { api } = open();
    const dialog = await changeDialog(holdTtl);
    expect(
      (
        dialog.getByLabelText(
          ar('admin.dialogs.confirm.changeSetting.valueLabel'),
        ) as HTMLInputElement
      ).value,
    ).toBe('10');
    write(dialog, 'admin.dialogs.confirm.changeSetting.valueLabel', '12');
    expect(confirmOf(dialog).hasAttribute('disabled')).toBe(true);
    write(dialog, 'admin.settings.reasonLabel', '   ');
    expect(confirmOf(dialog).hasAttribute('disabled')).toBe(true);
    fireEvent.click(confirmOf(dialog));
    expect(api.settings.update.mutate).not.toHaveBeenCalled();
  });

  it.each([
    [
      'out_of_bounds',
      refusal('VALIDATION_FAILED', [{ path: 'value', code: 'out_of_bounds' }]),
      ar('admin.settings.refused.outOfBounds', {
        bounds: ar('admin.settings.bounds.atLeast', { min: 1 }),
      }),
    ],
    [
      'invalid',
      refusal('VALIDATION_FAILED', [{ path: 'value', code: 'invalid' }]),
      ar('admin.settings.refused.invalid'),
    ],
    [
      'unknown',
      refusal('VALIDATION_FAILED', [{ path: 'key', code: 'unknown' }]),
      ar('admin.settings.refused.unknown'),
    ],
    [
      'the limit',
      refusal('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '61' }]),
      ar('admin.common.rateLimitedIn', { count: 2 }),
    ],
    ['a reused key', refusal('CONFLICT'), ar('admin.shared.keyReused')],
  ] as const)('says a refused change (%s) in its own words', async (_, error, words) => {
    const api = fakeApi();
    api.settings.update.mutate.mockRejectedValueOnce(error);
    open(api);
    const dialog = await changeDialog(holdTtl);
    write(dialog, 'admin.dialogs.confirm.changeSetting.valueLabel', '0');
    write(dialog, 'admin.settings.reasonLabel', 'تعديل');
    fireEvent.click(confirmOf(dialog));
    expect(await dialog.findByText(words)).toBeTruthy();
  });
});

// 006:T002 (research R-515; the note under T002, Q-6, the owner's «تظهر جنيه فقط»): the assessment's
// fee (`assessment_price_piasters`, B-P1 Q-B4 (a)) is stored in whole piasters and shown and typed in
// pounds only, at most two decimals, through the panel's one amount format
// (`formatPounds`), never as piasters and never with a «قرش» word.
const assessmentFee = {
  key: 'assessment_price_piasters',
  value: 15_000,
  default: 0,
  bounds: { shape: 'number', value: from(0) },
  unit: 'piasters',
  group: 'booking',
  srsRow:
    "Programme: the assessment's fee (EGP, one amount for every ijazah-track Teacher; an ijazah-track Package is not published while it is unset)",
} as const;

function withFee() {
  const api = fakeApi();
  api.settings.list.query.mockResolvedValue({ items: [...ITEMS, assessmentFee] });
  return open(api);
}

describe('the assessment’s fee in pounds (006:T002, Q-6)', () => {
  it('shows the fee and its default in pounds, in both languages', async () => {
    await inBothLocales(withFee, async (t, locale) => {
      const label = t(labelOf(assessmentFee.key));
      await screen.findByText(label);
      const region = within(screen.getByRole('region', { name: t(groupOf('booking')) }));
      const cell = (header: MessageKey) => cellIn(region, label, t(header));
      const pounds = (amount: number) =>
        t('admin.settings.units.piasters', { value: formatPounds(piasters(amount), locale) });
      expect(within(cell('admin.settings.columns.value')).getByText(pounds(15_000))).toBeTruthy();
      expect(cell('admin.settings.columns.default').textContent).toBe(pounds(0));
    });
  });

  it('never names a piaster', async () => {
    withFee();
    const label = ar(labelOf(assessmentFee.key));
    await screen.findByText(label);
    const row = rowIn(screen, label);
    expect(row.queryByText(/15000|15,000|قرش|piaster/i)).toBeNull();
  });
});

describe('the assessment’s fee typed in pounds (006:T002, Q-6, Q-B1 (a))', () => {
  it('states its bound in pounds', async () => {
    withFee();
    const label = ar(labelOf(assessmentFee.key));
    await screen.findByText(label);
    const region = within(screen.getByRole('region', { name: ar(groupOf('booking')) }));
    expect(cellIn(region, label, ar('admin.settings.columns.bounds')).textContent).toBe(
      ar('admin.settings.bounds.atLeast', { min: formatPounds(piasters(0), 'ar') }),
    );
  });

  it('opens the change on the fee in pounds', async () => {
    withFee();
    const dialog = await changeDialog(assessmentFee);
    expect(
      (
        dialog.getByLabelText(
          ar('admin.dialogs.confirm.changeSetting.valueLabel'),
        ) as HTMLInputElement
      ).value,
    ).toBe('150');
  });

  it.each([
    ['200', 20_000],
    ['150.5', 15_050],
    ['٢٠٠', 20_000],
    ['0', 0],
  ] as const)('stores «%s» typed as %i piasters', async (typed, stored) => {
    const { api } = withFee();
    const dialog = await changeDialog(assessmentFee);
    write(dialog, 'admin.dialogs.confirm.changeSetting.valueLabel', typed);
    write(dialog, 'admin.settings.reasonLabel', 'تحديد رسوم الاختبار');
    fireEvent.click(confirmOf(dialog));
    await waitFor(() => expect(api.settings.update.mutate).toHaveBeenCalledTimes(1));
    expect(api.settings.update.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ key: assessmentFee.key, value: stored }),
    );
  });

  it('refuses «150.555»: no value, the confirm stays off, nothing sent', async () => {
    const { api } = withFee();
    const dialog = await changeDialog(assessmentFee);
    write(dialog, 'admin.dialogs.confirm.changeSetting.valueLabel', '150.555');
    write(dialog, 'admin.settings.reasonLabel', 'تعديل');
    expect(confirmOf(dialog).hasAttribute('disabled')).toBe(true);
    fireEvent.click(confirmOf(dialog));
    expect(api.settings.update.mutate).not.toHaveBeenCalled();
  });
});

// 006:T002 (SRS DEC-110; the note under T002, Q-3 (a)(a)): the switch's turn-on writes its own
// audit entry, `packages.retired_by_switch`, on the switch's key; the audit list names it by the
// catalogue's sentence in both languages, never by the stored code.
describe('the switch’s audit entry by name (006:T002, Q-3)', () => {
  it('packages.retired_by_switch reads its sentence in Arabic and in English', () => {
    const action = 'packages.retired_by_switch';
    expect(actionText(action, (key: MessageKey) => translate('ar', key))).toBe(
      'إيقاف باقات الإجازة القديمة عند تشغيل البرنامج',
    );
    expect(actionText(action, (key: MessageKey) => translate('en', key))).toBe(
      'Deactivate the old ijazah packages when the programme is turned on',
    );
  });
});

// 006:T021 (B-P4's conflict check, Q-7, the owner's design, 2026-11-25: «لكل الزراير»): beside each
// setting's name an «i» button, named for its setting, whose hover hint says «اضغط للشرح»; a press
// opens a dialog titled by the setting's name with its explanation (`admin.settings.explain.<key>`),
// each line a paragraph. `programme_enabled`'s says what turning it on and off does, and that off
// reactivates no package.
const explainOf = (key: string) => `admin.settings.explain.${key}` as MessageKey;

async function explanation(setting: { readonly key: string }, t: Translate = ar) {
  const row = await rowOf(setting, t);
  const button = row.getByRole('button', {
    name: t('admin.settings.explainButton.a11y', { setting: t(labelOf(setting.key)) }),
  });
  fireEvent.click(button);
  const dialog = await screen.findByRole('dialog', { name: t(labelOf(setting.key)) });
  return { button, dialog: within(dialog) };
}

const paragraphsOf = (dialog: ReturnType<typeof within>) =>
  dialog
    .getAllByText((_content: string, element: Element | null) => element?.tagName === 'P')
    .map((paragraph: HTMLElement) => paragraph.textContent);

describe('the «i» beside each setting (006:T021, Q-7)', () => {
  it('puts an «i» beside every setting’s name, its hint on hover, and opens its explanation, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t) => {
        await screen.findByText(t(labelOf(attendance.key)));
        for (const setting of ITEMS) {
          const { button, dialog } = await explanation(setting, t);
          expect(button.closest('td')?.textContent).toBe(t(labelOf(setting.key)));
          expect(button.closest('[title]')?.getAttribute('title')).toBe(
            t('admin.settings.explainButton.hint'),
          );
          expect(paragraphsOf(dialog)).toEqual(t(explainOf(setting.key)).split('\n'));
          fireEvent.click(
            dialog.getByRole('button', { name: t('admin.settings.explainButton.close') }),
          );
          await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        }
      },
    );
  });

  it('explains the programme’s switch: on, off, and that off reactivates no package', async () => {
    const programmeEnabled = {
      key: 'programme_enabled',
      value: 0,
      default: 0,
      bounds: { shape: 'number', value: from(0, 1) },
      unit: 'count',
      group: 'booking',
      srsRow: 'Programme: the programme turned on (off: ijazah-track Packages sold as before)',
    } as const;
    const api = fakeApi();
    api.settings.list.query.mockResolvedValue({ items: [programmeEnabled] });
    await inBothLocales(
      () => open(api),
      async (t) => {
        const { dialog } = await explanation(programmeEnabled, t);
        const paragraphs = paragraphsOf(dialog);
        expect(paragraphs).toEqual(t(explainOf('programme_enabled')).split('\n'));
        expect(paragraphs).toHaveLength(3);
        expect(paragraphs[2]?.startsWith('⚠️')).toBe(true);
        fireEvent.click(
          dialog.getByRole('button', { name: t('admin.settings.explainButton.close') }),
        );
      },
    );
  });

  it('changes nothing by a press: no setting is written', async () => {
    const { api } = open();
    const { dialog } = await explanation(attendance);
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.settings.explainButton.close') }));
    expect(api.settings.update.mutate).not.toHaveBeenCalled();
  });
});
