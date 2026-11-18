// 003:T105 (SRS DEC-89; ADR 0025 D2; the note under T105 and the owner's «Approve» of 2026-11-17):
// «تحويلات المعلمين», beside the payments monitor. The page explains itself in one line; the totals
// for all teachers (held, due now, paid all time and this month, taken off as refunds to students);
// one row per teacher with the same figures and the oldest due release's time, in the server's order
// (the teachers with something due first, the oldest due first); the «due now only» filter as a tab;
// keyset pages by `nextCursor`. A row opens the teacher's detail beside the table (`PayoutsPanel`);
// `?teacher=` opens one at once (the link on a teacher's record in `/users`). Every read is audited
// on the server (`payouts.listed`, `payouts.viewed`). The figures are computed on the server; the page
// only formats piasters.
import { type Piasters, piasters } from '@ijazah/money';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import {
  Banner,
  Button,
  CategoryTabs,
  DataTable,
  EmptyState,
  KeyValue,
  Page,
  Skeleton,
  Split,
  Toolbar,
} from '../../design/components';
import { useLocale, useT } from '../../i18n';
import { errorMessageKey } from '../../lib/error-message';
import { dayMonth, formatPounds, timeOfDay } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { PayoutsPanel } from './PayoutsPanel';
import { type PayoutsFilter, usePayoutsPage } from './queries';

/** The tab with no filter, and the one with `dueOnly`. */
const ALL = 'all';
const DUE_ONLY = 'dueOnly';

export function AdminPayouts() {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const [params] = useSearchParams();
  const [dueOnly, setDueOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(params.get('teacher'));
  // The cursor of each page read so far: the first page has none.
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  const [page, setPage] = useState(1);
  const filter: PayoutsFilter = dueOnly ? { dueOnly: true } : {};
  const list = usePayoutsPage(filter, cursors[page - 1]);

  // A new filter starts at the first page.
  const filters = JSON.stringify(filter);
  const [shownFor, setShownFor] = useState(filters);
  if (shownFor !== filters) {
    setShownFor(filters);
    setCursors([undefined]);
    setPage(1);
  }

  const listed = list.data;
  const loadFailure = errorMessageKey(list.error, 'admin.common.loadError.text');
  const next = listed?.nextCursor;
  const pageCount = page === cursors.length && next !== undefined ? page + 1 : cursors.length;
  const go = (target: number) => {
    if (target === cursors.length + 1 && next !== undefined) setCursors([...cursors, next]);
    setPage(target);
  };
  const pounds = (amount_piasters: Piasters) => formatPounds(amount_piasters, locale);

  const sums =
    listed === undefined ? null : (
      <section className="section" aria-label={t('admin.money.payouts.totals.title')}>
        <h2 className="group-label">{t('admin.money.payouts.totals.title')}</h2>
        <KeyValue
          columns={3}
          items={[
            {
              label: t('admin.money.payouts.totals.held'),
              value: pounds(piasters(listed.totals.held_piasters)),
            },
            {
              label: t('admin.money.payouts.totals.dueNow'),
              value: pounds(piasters(listed.totals.dueNow_piasters)),
            },
            {
              label: t('admin.money.payouts.totals.paid'),
              value: pounds(piasters(listed.totals.paid_piasters)),
            },
            {
              label: t('admin.money.payouts.totals.paidThisMonth'),
              value: pounds(piasters(listed.totals.paidThisMonth_piasters)),
            },
            {
              label: t('admin.money.payouts.totals.takenOff'),
              value: pounds(piasters(listed.totals.takenOff_piasters)),
            },
          ]}
        />
      </section>
    );

  const table =
    listed === undefined ? (
      list.isError ? (
        <div className="stack gap-4">
          <Banner icon={{ name: 'alert-circle' }} tone="danger">
            <span className="stack gap-1">
              <strong>
                {t('admin.common.loadError.title', { page: t('admin.money.payouts.title') })}
              </strong>
              <span>{t(loadFailure.key, loadFailure.values)}</span>
            </span>
          </Banner>
          <div className="row">
            <Button
              label={t('admin.common.action.retry')}
              variant="secondary"
              onPress={() => void list.refetch()}
            />
          </div>
        </div>
      ) : (
        <Skeleton shape="block" />
      )
    ) : listed.items.length === 0 ? (
      !dueOnly && page === 1 ? (
        <EmptyState
          icon={{ name: 'credit-card' }}
          title={t('admin.money.payouts.emptyAll.title')}
          text={t('admin.money.payouts.emptyAll.text')}
        />
      ) : (
        <EmptyState
          icon={{ name: 'search' }}
          title={t('admin.money.payouts.empty.title')}
          text={t('admin.money.payouts.empty.text')}
        />
      )
    ) : (
      <DataTable
        columns={[
          { key: 'teacher', header: t('admin.money.payouts.columns.teacher') },
          { key: 'held', header: t('admin.money.payouts.columns.held'), numeric: true },
          { key: 'dueNow', header: t('admin.money.payouts.columns.dueNow'), numeric: true },
          { key: 'paid', header: t('admin.money.payouts.columns.paid'), numeric: true },
          {
            key: 'paidThisMonth',
            header: t('admin.money.payouts.columns.paidThisMonth'),
            numeric: true,
          },
          { key: 'takenOff', header: t('admin.money.payouts.columns.takenOff'), numeric: true },
          { key: 'oldestDue', header: t('admin.money.payouts.columns.oldestDue'), end: true },
        ]}
        rows={listed.items.map((row) => ({
          key: row.teacher.userId,
          cells: {
            teacher: <bdi>{row.teacher.displayName}</bdi>,
            held: pounds(piasters(row.held_piasters)),
            dueNow: pounds(piasters(row.dueNow_piasters)),
            paid: pounds(piasters(row.paid_piasters)),
            paidThisMonth: pounds(piasters(row.paidThisMonth_piasters)),
            takenOff: pounds(piasters(row.takenOff_piasters)),
            oldestDue:
              row.oldestDueAt === undefined
                ? t('admin.payments.dash')
                : t('admin.common.dateTime', {
                    date: dayMonth(row.oldestDueAt, locale, zone),
                    time: timeOfDay(row.oldestDueAt, locale, zone),
                  }),
          },
        }))}
        {...(selected === null ? {} : { selectedKey: selected })}
        onSelect={setSelected}
        footer={{
          summary: t('admin.money.payouts.pagerPage', { page }),
          pager: { page, pageCount, onChange: go },
        }}
      />
    );

  return (
    <Page title={t('admin.money.payouts.title')} subtitle={t('admin.money.payouts.lede')}>
      {sums}
      <Toolbar>
        <CategoryTabs
          accessibilityLabel={t('admin.common.a11y.filters')}
          value={dueOnly ? DUE_ONLY : ALL}
          onChange={(value) => setDueOnly(value === DUE_ONLY)}
          tabs={[
            { value: ALL, label: t('admin.common.action.all') },
            { value: DUE_ONLY, label: t('admin.money.payouts.filter.dueOnly') },
          ]}
        />
      </Toolbar>
      <Split
        detailLabel={t('admin.money.payouts.detail.a11y')}
        list={table}
        {...(selected === null
          ? {}
          : { detail: <PayoutsPanel key={selected} teacherUserId={selected} /> })}
      />
    </Page>
  );
}
