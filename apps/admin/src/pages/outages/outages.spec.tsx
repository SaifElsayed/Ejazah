// T048 (FR-445; T016; R-TIME-6): `/outages` through the router, in both languages. The recorded
// windows, newest first as the server answers them, each with its start and end in the panel's
// zone, its reason and who recorded it, in pages; the record form taking a local date and time for
// each end, a zone and a mandatory reason, sending nothing until each is whole; the answer's
// reclassified sessions said in words; a validation refusal said in place, any other failure the
// generic words.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MessageKey, setLocale, translate } from '../../i18n';
import { cityName, dayMonthYear, timeOfDay } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { inBothLocales, mutation, query, refusal, renderApp } from '../../test/app-harness';

afterEach(() => setLocale('ar'));

const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);
/** Lets a press's mutation, if one was started, reach the client before a "nothing sent" check. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const O1 = '0193a6f0-0000-7000-8000-0000000000a1';
const O2 = '0193a6f0-0000-7000-8000-0000000000a2';
const O3 = '0193a6f0-0000-7000-8000-0000000000a3';
const ADMIN = '0193a6f0-0000-7000-8000-0000000000f1';

const newest = {
  outageId: O2,
  startsAt: '2026-11-10T13:30:00.000Z',
  endsAt: '2026-11-10T14:15:00.000Z',
  reason: 'صفحة حالة الخدمة أعلنت انقطاعًا',
  recordedBy: { adminId: ADMIN, displayName: 'سارة عادل' },
} as const;
const older = {
  outageId: O1,
  startsAt: '2026-11-02T08:00:00.000Z',
  endsAt: '2026-11-02T09:00:00.000Z',
  reason: 'Provider status page: degraded rooms',
  recordedBy: { adminId: ADMIN, displayName: 'Omar Hassan' },
} as const;
const oldest = { ...older, outageId: O3, reason: 'انقطاع قديم' } as const;

function fakeApi() {
  const api = {
    sessions: { outages: { list: query(), record: mutation() } },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.sessions.outages.list.query.mockImplementation(async (input) => {
    const { cursor } = (input ?? {}) as { cursor?: string };
    if (cursor === O1) return { items: [oldest] };
    return { items: [newest, older], nextCursor: O1 };
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
  return { ...renderApp({ at: '/outages', session: verified, api }), api };
}

async function rowOf(text: string) {
  const cell = await screen.findByText(text);
  return cell.closest('tr') as HTMLElement;
}

async function dialog(title: string) {
  const heading = await screen.findByRole('heading', { level: 2, name: title });
  return within(heading.closest('section.dialog') as HTMLElement);
}

/** Opens the record form. */
async function form() {
  fireEvent.click(await screen.findByRole('button', { name: ar('admin.outages.record') }));
  return dialog(ar('admin.outages.dialog.title'));
}

type Form = Awaited<ReturnType<typeof form>>;

/** Writes the form's fields; a field left out keeps what it holds. */
function fill(
  box: Form,
  fields: {
    readonly startDate?: string;
    readonly startTime?: string;
    readonly endDate?: string;
    readonly endTime?: string;
    readonly zone?: string;
    readonly reason?: string;
  },
) {
  const labels = {
    startDate: 'admin.outages.dialog.startDate',
    startTime: 'admin.outages.dialog.startTime',
    endDate: 'admin.outages.dialog.endDate',
    endTime: 'admin.outages.dialog.endTime',
    zone: 'admin.outages.dialog.zone',
    reason: 'admin.outages.dialog.reason',
  } as const;
  for (const [field, value] of Object.entries(fields)) {
    fireEvent.change(box.getByLabelText(ar(labels[field as keyof typeof labels])), {
      target: { value },
    });
  }
}

const WHOLE = {
  startDate: '10112026',
  startTime: '15:30',
  endDate: '10/11/2026',
  endTime: '16:15',
  zone: 'Africa/Cairo',
  reason: '  صفحة حالة الخدمة أعلنت انقطاعًا  ',
} as const;

const press = (box: Form) =>
  fireEvent.click(box.getByRole('button', { name: ar('admin.outages.dialog.confirm') }));

describe('/outages, the list (FR-445)', () => {
  it('lists each window with its start, its end, its reason and who recorded it, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        expect(await screen.findByText(t('admin.outages.lede'))).toBeTruthy();
        await rowOf(newest.reason);
        for (const column of ['start', 'end', 'reason', 'recordedBy'] as const) {
          expect(
            screen.getByRole('columnheader', { name: t(`admin.outages.columns.${column}`) }),
          ).toBeTruthy();
        }
        const zone = panelTimeZone();
        const at = (value: string) =>
          t('admin.common.dateTime', {
            date: dayMonthYear(value, locale, zone),
            time: timeOfDay(value, locale, zone),
          });
        const row = within(await rowOf(newest.reason));
        expect(row.getByText(at(newest.startsAt))).toBeTruthy();
        expect(row.getByText(at(newest.endsAt))).toBeTruthy();
        expect(row.getByText('سارة عادل')).toBeTruthy();
        expect(within(await rowOf(older.reason)).getByText('Omar Hassan')).toBeTruthy();
      },
    );
  });

  it('reads the first page with no cursor, then the next by the cursor the server wrote', async () => {
    const { api } = open();
    await rowOf(newest.reason);
    expect(api.sessions.outages.list.query).toHaveBeenLastCalledWith({});
    const pages = screen.getByRole('navigation', { name: ar('admin.common.a11y.pages') });
    fireEvent.click(within(pages).getByRole('button', { name: '2' }));
    await rowOf(oldest.reason);
    expect(api.sessions.outages.list.query).toHaveBeenLastCalledWith({ cursor: O1 });
  });

  it('says an empty list in words', async () => {
    const api = fakeApi();
    api.sessions.outages.list.query.mockResolvedValue({ items: [] });
    open(api);
    expect(await screen.findByText(ar('admin.outages.empty.title'))).toBeTruthy();
    expect(screen.getByText(ar('admin.outages.empty.text'))).toBeTruthy();
  });

  it('says a failed read with the page’s generic words', async () => {
    const api = fakeApi();
    api.sessions.outages.list.query.mockRejectedValue(new Error('offline'));
    open(api);
    expect(await screen.findByText(ar('admin.common.loadError.text'))).toBeTruthy();
  });
});

describe('/outages, the record (FR-445)', () => {
  it('asks for each end’s local date and time, the zone (the panel’s, named by its city) and a reason, and says what follows, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        fireEvent.click(await screen.findByRole('button', { name: t('admin.outages.record') }));
        const box = await dialog(t('admin.outages.dialog.title'));
        expect(box.getByText(t('admin.outages.dialog.effect'))).toBeTruthy();
        for (const label of [
          'admin.outages.dialog.startDate',
          'admin.outages.dialog.startTime',
          'admin.outages.dialog.endDate',
          'admin.outages.dialog.endTime',
          'admin.outages.dialog.reason',
        ] as const) {
          expect(box.getByLabelText(t(label))).toBeTruthy();
        }
        const zone = panelTimeZone();
        expect((box.getByLabelText(t('admin.outages.dialog.zone')) as HTMLInputElement).value).toBe(
          zone,
        );
        expect(
          box.getByText(t('admin.outages.dialog.zoneHint', { city: cityName(zone, locale) })),
        ).toBeTruthy();
      },
    );
  });

  it('sends the window as local dates and times in the zone, the reason trimmed; says the sessions moved; reads the list and the queue again', async () => {
    const { api, queries } = open();
    api.sessions.outages.record.mutate.mockResolvedValue({
      outageId: O2,
      startsAt: '2026-11-10T13:30:00.000Z',
      endsAt: '2026-11-10T14:15:00.000Z',
      reclassified: 3,
    });
    await rowOf(newest.reason);
    queries.setQueryData(['review', 'list', null], { items: [] });
    const box = await form();
    fill(box, { ...WHOLE, startTime: '9:05' });
    press(box);
    await waitFor(() =>
      expect(api.sessions.outages.record.mutate).toHaveBeenCalledWith({
        start: { localDate: '2026-11-10', localTime: '09:05' },
        end: { localDate: '2026-11-10', localTime: '16:15' },
        timezone: 'Africa/Cairo',
        reason: 'صفحة حالة الخدمة أعلنت انقطاعًا',
      }),
    );
    expect(await screen.findByText(ar('admin.outages.recorded', { count: 3 }))).toBeTruthy();
    expect(
      screen.queryByRole('heading', { level: 2, name: ar('admin.outages.dialog.title') }),
    ).toBeNull();
    await waitFor(() => expect(api.sessions.outages.list.query).toHaveBeenCalledTimes(2));
    expect(queries.getQueryState(['review', 'list', null])?.isInvalidated).toBe(true);
  });

  it.each([0, 1, 2])('says %i sessions moved in words, in both languages', async (count) => {
    await inBothLocales(
      () => {
        const opened = open();
        opened.api.sessions.outages.record.mutate.mockResolvedValue({
          outageId: O2,
          startsAt: '2026-11-10T13:30:00.000Z',
          endsAt: '2026-11-10T14:15:00.000Z',
          reclassified: count,
        });
        return opened;
      },
      async (t) => {
        fireEvent.click(await screen.findByRole('button', { name: t('admin.outages.record') }));
        const box = await dialog(t('admin.outages.dialog.title'));
        const label = (key: MessageKey) => box.getByLabelText(t(key));
        const write = (key: MessageKey, value: string) =>
          fireEvent.change(label(key), { target: { value } });
        write('admin.outages.dialog.startDate', WHOLE.startDate);
        write('admin.outages.dialog.startTime', WHOLE.startTime);
        write('admin.outages.dialog.endDate', WHOLE.endDate);
        write('admin.outages.dialog.endTime', WHOLE.endTime);
        write('admin.outages.dialog.reason', WHOLE.reason);
        fireEvent.click(box.getByRole('button', { name: t('admin.outages.dialog.confirm') }));
        expect(await screen.findByText(t('admin.outages.recorded', { count }))).toBeTruthy();
      },
    );
  });

  it.each([
    ['a blank reason', { reason: '   ' }],
    ['a start day not whole', { startDate: '1011202' }],
    ['an end day that does not exist', { endDate: '31/11/2026' }],
    ['a start time that does not exist', { startTime: '24:00' }],
    ['an end time not whole', { endTime: '16:' }],
    ['no zone', { zone: '  ' }],
  ] as const)('sends nothing with %s', async (_case, broken) => {
    const { api } = open();
    const box = await form();
    fill(box, { ...WHOLE, ...broken });
    press(box);
    await settle();
    expect(api.sessions.outages.record.mutate).not.toHaveBeenCalled();
  });

  it('says a day that does not exist and a time that does not exist beside their fields', async () => {
    open();
    const box = await form();
    fill(box, { ...WHOLE, endDate: '31/11/2026', startTime: '25:00' });
    expect(box.getByText(ar('admin.applications.detail.callDateInvalid'))).toBeTruthy();
    expect(box.getByText(ar('admin.outages.dialog.timeInvalid'))).toBeTruthy();
  });

  it.each([
    [
      'an end not after the start',
      refusal('VALIDATION_FAILED', [{ path: 'end', code: 'not_after_start' }]),
      'admin.outages.dialog.refused.endNotAfterStart',
    ],
    [
      'a zone the time package does not know',
      refusal('VALIDATION_FAILED', [{ path: 'timezone', code: 'unknown' }]),
      'admin.outages.dialog.refused.zoneUnknown',
    ],
    ['any other failure', new Error('offline'), 'admin.dialogs.submitError'],
  ] as const)('says %s in place, the form left open', async (_case, error, words) => {
    const { api } = open();
    api.sessions.outages.record.mutate.mockRejectedValue(error);
    const box = await form();
    fill(box, WHOLE);
    press(box);
    expect(await box.findByText(ar(words))).toBeTruthy();
    expect(screen.queryByText(ar('admin.outages.recorded', { count: 0 }))).toBeNull();
  });

  it('says the end refused beside the end field, and clears it once the end changes', async () => {
    const { api } = open();
    api.sessions.outages.record.mutate.mockRejectedValue(
      refusal('VALIDATION_FAILED', [{ path: 'end', code: 'not_after_start' }]),
    );
    const box = await form();
    fill(box, WHOLE);
    press(box);
    const words = await box.findByText(ar('admin.outages.dialog.refused.endNotAfterStart'));
    expect(words.closest('.field')).toBe(
      box.getByLabelText(ar('admin.outages.dialog.endTime')).closest('.field'),
    );
    fill(box, { endTime: '17:00' });
    expect(box.queryByText(ar('admin.outages.dialog.refused.endNotAfterStart'))).toBeNull();
  });
});
