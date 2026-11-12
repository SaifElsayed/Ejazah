// T073 (FR-176): the admin home against its boards (`AdminHome`, `AdminHomeEn`), and the sidebar's
// name and counts. Today's date in the panel's zone; this phase's two queue cards with their counts
// and what they say of the oldest; the latest actions as the audit names them, the whole log one
// link away; an empty list said. The sidebar names the signed-in administrator (`auth.me`) and
// counts the two queues (`home.summary`), read once with the page's own summary.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { setLocale, translate, type MessageKey } from '../../i18n';
import { cityName, dayMonth, timeOfDay, weekdayDate } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { currentPath, inBothLocales, query, refusal, renderApp } from '../../test/app-harness';

afterEach(() => setLocale('ar'));

const USER = '0193a6f0-0000-7000-8000-00000000000a';

const latest = {
  entryId: '0193a6f0-0000-7000-8000-0000000000e1',
  occurredAt: '2026-10-15T08:20:00.000Z',
  adminName: 'سارة عادل',
  action: 'application.request_info',
  targetLabel: `طلب انضمام · ${USER}`,
  targetName: 'الشيخ إبراهيم صالح',
  targetType: 'teacher_application',
  targetId: USER,
} as const;

function fakeApi(summary?: object) {
  const api = { home: { summary: query() }, auth: { me: query() } };
  api.home.summary.query.mockResolvedValue(
    summary ?? {
      queues: {
        applications: { open: 3, oldestAgeHours: 72, waitingOnApplicant: 1 },
        credentials: { open: 2, oldestAgeHours: 50, addedSubjects: 1 },
      },
      latestActions: [latest],
    },
  );
  api.auth.me.query.mockResolvedValue({
    adminId: 'a',
    displayName: 'سارة عادل',
    email: 'sara@example.com',
  });
  return api;
}

const verified = { token: 't', step: 'verified' } as const;
const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);

function open(api = fakeApi(), { strict = false } = {}) {
  return { ...renderApp({ at: '/', session: verified, api, strict }), api };
}

describe('AdminHome (FR-176)', () => {
  it('draws today, the two queues and the latest actions, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        const zone = panelTimeZone();
        expect(screen.getByRole('heading', { level: 1, name: t('admin.home.title') })).toBeTruthy();
        expect(
          screen.getByText(
            t('admin.home.subtitle', {
              date: weekdayDate(new Date().toISOString(), locale, zone),
              city: cityName(zone, locale),
            }),
          ),
        ).toBeTruthy();
        // The card is titled as its page, as AdminHomeEn draws it; the sidebar keeps the short name
        // (T112).
        const applications = (
          await screen.findByText(t('admin.applications.title'), { selector: '.text-headline' })
        ).closest('a') as HTMLElement;
        if (locale === 'en') {
          expect(within(applications).getByText('Teacher applications')).toBeTruthy();
        }
        expect(within(applications).getByText('3')).toBeTruthy();
        expect(
          within(applications).getByText(
            `${t('admin.home.queue.oldest', { days: 3 })} · ${t('admin.home.queue.waiting', { waiting: 1 })}`,
          ),
        ).toBeTruthy();
        const credentials = screen
          .getByText(t('admin.nav.items.credentials'), { selector: '.text-headline' })
          .closest('a') as HTMLElement;
        // A part after the first starts in lower case in English, as the board writes it (B14d-1
        // review, nit).
        const oldest = t('admin.home.queue.oldest', { days: 2 });
        const after =
          locale === 'en' ? `${oldest.charAt(0).toLowerCase()}${oldest.slice(1)}` : oldest;
        expect(
          within(credentials).getByText(`${t('admin.home.queue.added', { added: 1 })} · ${after}`),
        ).toBeTruthy();
        expect(screen.getByText(t('admin.audit.actions.requestMoreInfo'))).toBeTruthy();
        expect(
          screen.getByText(dayMonth(latest.occurredAt, locale, zone), { exact: false }),
        ).toBeTruthy();
        expect(
          screen.getByText(timeOfDay(latest.occurredAt, locale, zone), { exact: false }),
        ).toBeTruthy();
        const target = screen.getByRole('link', {
          name: t('admin.audit.targetNamed', {
            type: t('admin.audit.targets.teacherApplication'),
            name: latest.targetName,
          }),
        });
        // T111: «الهدف» wraps rather than being cut at the table's edge.
        expect(target.closest('td')?.className).toBe('table__wrap');
      },
    );
  });

  it('opens a queue from its card and the whole log from its link', async () => {
    open();
    fireEvent.click(
      (
        await screen.findByText(ar('admin.nav.items.credentials'), { selector: '.text-headline' })
      ).closest('a') as HTMLElement,
    );
    await waitFor(() => expect(currentPath()).toBe('/credentials'));
  });

  it('says an oldest from today, and a home with no actions yet', async () => {
    open(
      fakeApi({
        queues: {
          applications: { open: 1, oldestAgeHours: 5, waitingOnApplicant: 0 },
          credentials: { open: 0, addedSubjects: 0 },
        },
        latestActions: [],
      }),
    );
    expect(await screen.findByText(ar('admin.home.queue.oldestToday'))).toBeTruthy();
    expect(screen.getByText(ar('admin.home.actionsEmpty.title'))).toBeTruthy();
  });

  // T112 (b): the English the board's other cards write («Oldest 3 days ago», «Arrived yesterday»).
  it('says in English an oldest that arrived today (T112)', async () => {
    setLocale('en');
    open(
      fakeApi({
        queues: {
          applications: { open: 1, oldestAgeHours: 5, waitingOnApplicant: 0 },
          credentials: { open: 0, addedSubjects: 0 },
        },
        latestActions: [],
      }),
    );
    expect(await screen.findByText('Oldest arrived today')).toBeTruthy();
  });

  it('names the administrator in the sidebar and counts the queues, one summary read in strict mode', async () => {
    const { api } = open(fakeApi(), { strict: true });
    const nav = within(
      await screen.findByRole('complementary', { name: ar('admin.nav.a11y.panel') }),
    );
    expect(await nav.findByText('سارة عادل')).toBeTruthy();
    const applications = nav.getByRole('link', {
      name: (name) => name.startsWith(ar('admin.nav.items.applications')),
    });
    expect(within(applications).getByText('3')).toBeTruthy();
    const credentials = nav.getByRole('link', {
      name: (name) => name.startsWith(ar('admin.nav.items.credentials')),
    });
    expect(within(credentials).getByText('2')).toBeTruthy();
    expect(api.home.summary.query).toHaveBeenCalledTimes(1);
    expect(api.auth.me.query).toHaveBeenCalledTimes(1);
  });

  it('counts no empty queue in the sidebar, as the board draws it (B14d-1 review)', async () => {
    open(
      fakeApi({
        queues: {
          applications: { open: 0, waitingOnApplicant: 0 },
          credentials: { open: 2, addedSubjects: 0 },
        },
        latestActions: [],
      }),
    );
    const nav = within(
      await screen.findByRole('complementary', { name: ar('admin.nav.a11y.panel') }),
    );
    await nav.findByText('2');
    const applications = nav.getByRole('link', {
      name: (name) => name.startsWith(ar('admin.nav.items.applications')),
    });
    expect(applications.querySelector('.nav-item__count')).toBeNull();
  });
});

describe('T058: RATE_LIMITED on the home', () => {
  it('says when to try again in place of the summary’s generic words', async () => {
    const api = fakeApi();
    api.home.summary.query.mockRejectedValue(
      refusal('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '61' }]),
    );
    open(api);
    expect(await screen.findByText(ar('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
    expect(screen.queryByText(ar('admin.common.loadError.text'))).toBeNull();
  });
});
