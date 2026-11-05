// T053 (FR-400 to FR-402, FR-PAYG-11, FR-ADMIN-18; `AdminPayments`, screens.md): the read-only
// monitor of every gateway order. The banner says nothing here moves money. The toolbar's status
// tabs and search (an order reference or a student's name, sent once the typing stops) narrow the
// list, each active filter shown as a removable chip with «مسح الكل». The table, newest first as the
// server answers it: the order's reference and its day and time in the panel's zone, the student,
// gross, fee and net as the gateway reported them (a dash where it reported none, whatever the
// status: a gateway may report neither on a paid order), the status, and a paid order of a cancelled
// enrollment marked. Pages are keyset pages: the pager offers the pages already read and the next
// one while the server writes a cursor. A row opens its order beside the table (`PaymentPanel`);
// `?payment=` opens one at once (the audit log's link). No control writes (FR-401); the page is a
// console page behind the second factor (FR-402).
//
// Left out, as the board draws them with no requirement behind them this phase: the filter panel
// behind the filter icon, the student's link to `AdminUsers` and the cancelled enrollment's link to
// `AdminEnrollments` (later phases' pages; spec.md, "the monitor's link to a cancelled enrollment
// appears with that page").
import { piasters } from '@ijazah/money';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import {
  Badge,
  Banner,
  Button,
  CategoryTabs,
  DataTable,
  EmptyState,
  FilterChips,
  Page,
  Skeleton,
  Split,
  Toolbar,
} from '../../design/components';
import { useLocale, useT } from '../../i18n';
import { dayMonth, formatPounds, timeOfDay } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { useSettled } from '../applications/queries';
import { amountOrDash } from './history';
import { PAYMENT_STATUS, PaymentPanel } from './PaymentPanel';
import { type PaymentsFilter, type PaymentStatus, usePaymentsPage } from './queries';

/** The tab with no status filter. */
const ALL = 'all';
const STATUSES: readonly PaymentStatus[] = ['created', 'paid', 'failed', 'expired', 'refunded'];

export function AdminPayments() {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const [params] = useSearchParams();
  const [status, setStatus] = useState<PaymentStatus | undefined>(undefined);
  const [typed, setTyped] = useState('');
  const search = useSettled(typed);
  const [selected, setSelected] = useState<string | null>(params.get('payment'));
  // The cursor of each page read so far: the first page has none.
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  const [page, setPage] = useState(1);
  const filter: PaymentsFilter = {
    ...(status === undefined ? {} : { status }),
    ...(search === '' ? {} : { search }),
  };
  const list = usePaymentsPage(filter, cursors[page - 1]);

  // A new filter starts at the first page, once the search settles: a keystroke reads nothing.
  const filters = JSON.stringify(filter);
  const [shownFor, setShownFor] = useState(filters);
  if (shownFor !== filters) {
    setShownFor(filters);
    setCursors([undefined]);
    setPage(1);
  }

  const listed = list.data;
  const next = listed?.nextCursor;
  const pageCount = page === cursors.length && next !== undefined ? page + 1 : cursors.length;
  const go = (target: number) => {
    if (target === cursors.length + 1 && next !== undefined) setCursors([...cursors, next]);
    setPage(target);
  };
  const clearAll = () => {
    setStatus(undefined);
    setTyped('');
  };

  const table =
    listed === undefined ? (
      list.isError ? (
        <div className="stack gap-4">
          <Banner icon={{ name: 'alert-circle' }} tone="danger">
            <span className="stack gap-1">
              <strong>
                {t('admin.common.loadError.title', { page: t('admin.payments.title') })}
              </strong>
              <span>{t('admin.common.loadError.text')}</span>
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
      status === undefined && search === '' && page === 1 ? (
        <EmptyState
          icon={{ name: 'credit-card' }}
          title={t('admin.payments.emptyAll.title')}
          text={t('admin.payments.emptyAll.text')}
        />
      ) : (
        <EmptyState
          icon={{ name: 'search' }}
          title={t('admin.payments.empty.title')}
          text={t('admin.payments.empty.text')}
        />
      )
    ) : (
      <DataTable
        columns={[
          { key: 'order', header: t('admin.payments.columns.order') },
          { key: 'student', header: t('admin.payments.columns.student') },
          { key: 'gross', header: t('admin.payments.columns.gross'), numeric: true },
          { key: 'fee', header: t('admin.payments.columns.fee'), numeric: true },
          { key: 'net', header: t('admin.payments.columns.net'), numeric: true },
          { key: 'status', header: t('admin.payments.columns.status'), end: true },
        ]}
        rows={listed.items.map((row) => ({
          key: row.paymentId,
          cells: {
            order: (
              <span className="stack">
                <bdi className="text-medium">{row.gatewayOrderId}</bdi>
                <span className="text-caption tone-muted">
                  {t('admin.common.dateTime', {
                    date: dayMonth(row.createdAt, locale, zone),
                    time: timeOfDay(row.createdAt, locale, zone),
                  })}
                </span>
              </span>
            ),
            student: <bdi>{row.student.displayName}</bdi>,
            gross: formatPounds(piasters(row.gross_piasters), locale),
            fee: amountOrDash(
              row.gatewayFee_piasters === undefined ? undefined : piasters(row.gatewayFee_piasters),
              locale,
              t,
            ),
            net: amountOrDash(
              row.net_piasters === undefined ? undefined : piasters(row.net_piasters),
              locale,
              t,
            ),
            status: (
              <span className="row wrap gap-2">
                <Badge
                  label={t(PAYMENT_STATUS[row.status].label)}
                  tone={PAYMENT_STATUS[row.status].tone}
                />
                {row.enrollmentCancelled ? (
                  <Badge label={t('admin.payments.enrollmentCancelled')} tone="danger" />
                ) : null}
              </span>
            ),
          },
        }))}
        {...(selected === null ? {} : { selectedKey: selected })}
        onSelect={setSelected}
        footer={{
          summary: t('admin.payments.pagerPage', { page }),
          pager: { page, pageCount, onChange: go },
        }}
      />
    );

  const chips = [
    ...(status === undefined
      ? []
      : [
          {
            key: 'status',
            content: t(PAYMENT_STATUS[status].label),
            onRemove: () => setStatus(undefined),
          },
        ]),
    ...(search === ''
      ? []
      : [{ key: 'search', content: <bdi>{search}</bdi>, onRemove: () => setTyped('') }]),
  ];

  return (
    <Page title={t('admin.payments.title')} subtitle={t('admin.payments.lede')}>
      <Banner icon={{ name: 'info' }} tone="info">
        {t('admin.payments.banner')}
      </Banner>
      <Toolbar
        search={{
          value: typed,
          onChangeText: setTyped,
          placeholder: t('admin.payments.search.placeholder'),
        }}
      >
        <CategoryTabs
          accessibilityLabel={t('admin.common.a11y.status')}
          value={status ?? ALL}
          onChange={(value) =>
            setStatus(value === ALL ? undefined : STATUSES.find((one) => one === value))
          }
          tabs={[
            { value: ALL, label: t('admin.common.action.all') },
            ...STATUSES.map((one) => ({ value: one, label: t(PAYMENT_STATUS[one].label) })),
          ]}
        />
      </Toolbar>
      {chips.length === 0 ? null : <FilterChips chips={chips} onClearAll={clearAll} />}
      <Split
        detailLabel={t('admin.payments.detail.a11y')}
        list={table}
        {...(selected === null
          ? {}
          : { detail: <PaymentPanel key={selected} paymentId={selected} /> })}
      />
    </Page>
  );
}
