// 006:T021 (FR-706a, FR-706b, FR-709, FR-727; SRS DEC-112, DEC-113; admin-surface.md
// `programmes.queue`): the ijazah programmes' queue, `/programmes`. Five tabs, the contract's filters
// but `refusal` (no item uses it since SRS DEC-112; the value stays in the contract, R-API-9): the
// programmes paused for non-payment, the teachers' stop requests, and the sweep's `no_offer`,
// `pay_blocked` and `charge_unknown` items. Under the tabs, what the tab holds in plain words. The
// rows as the server answers them, oldest first (a paused programme by its pause, an item by its
// opening): the two parties, the item's own words (the teacher's reason on a stop; on a `no_offer`
// item the reason recorded at the decision, or that none is yet, and «the assessment was not held»;
// on a `pay_blocked` item whether the payout account is verified now), since when and how late in
// whole days, and the programme's state. Pages by the server's cursor; a new tab starts at the
// first page. A row opens its programme beside the table and `?programme=` opens one at once:
// `ProgrammePanel`, handed the row so a `pay_blocked` item says whether the account is verified now.
import { secondsUntil } from '@ijazah/time/calendar';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import {
  Badge,
  Banner,
  Button,
  CategoryTabs,
  DataTable,
  EmptyState,
  Page,
  Skeleton,
  Split,
  Toolbar,
} from '../../design/components';
import { useLocale, useT } from '../../i18n';
import { errorMessageKey } from '../../lib/error-message';
import { dayMonth } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { ProgrammePanel } from './ProgrammePanel';
import { type ProgrammeQueueRow, useProgrammesPage } from './queries';
import { PROGRAMME_STATE, QUEUE_TABS, REQUEST_KIND } from './words';

const SECONDS_PER_DAY = 86_400;

type Filter = (typeof QUEUE_TABS)[number]['filter'];

/**
 * Whole days from `since` to now: how late the row is. The elapsed seconds are the package's
 * (R-TIME-1): the seconds from `since` until now's instant, never below zero.
 */
function daysSince(since: string): number {
  return Math.floor(secondsUntil(new Date().toISOString(), new Date(since)) / SECONDS_PER_DAY);
}

export function AdminProgrammes() {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const [params, setParams] = useSearchParams();
  const selected = params.get('programme');
  const [filter, setFilter] = useState<Filter>('paused');
  // The cursor of each page read so far: the first page has none.
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  const [page, setPage] = useState(1);
  const list = useProgrammesPage(filter, cursors[page - 1]);

  // A new tab starts at the first page.
  const [shownFor, setShownFor] = useState(filter);
  if (shownFor !== filter) {
    setShownFor(filter);
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
  const tab = QUEUE_TABS.find((one) => one.filter === filter) ?? QUEUE_TABS[0];

  /** The row's instant: a paused programme's pause, otherwise its item's opening. */
  const sinceOf = (row: ProgrammeQueueRow) => row.request?.createdAt ?? row.pausedSince;

  const itemCell = (row: ProgrammeQueueRow) => {
    const { request } = row;
    // A paused programme has no item: its state and its pause say it.
    if (request === null) return t('admin.payments.dash');
    return (
      <span className="stack">
        <strong className="text-medium">{t(REQUEST_KIND[request.kind])}</strong>
        {request.kind === 'stop' && request.reason !== undefined ? (
          <span className="text-caption">
            {t('admin.programme.row.stopReason', { reason: request.reason })}
          </span>
        ) : null}
        {request.kind === 'no_offer' ? (
          <span className="text-caption">
            {request.reason === undefined
              ? t('admin.programme.row.noReasonYet')
              : t('admin.programme.row.recordedReason', { reason: request.reason })}
          </span>
        ) : null}
        {request.kind === 'no_offer' && request.assessmentHeld === false ? (
          <span className="self-start">
            <Badge label={t('admin.programme.row.assessmentNotHeld')} tone="warning" />
          </span>
        ) : null}
        {row.payeeVerifiedNow === null ? null : (
          <span className="self-start">
            <Badge
              label={t(
                row.payeeVerifiedNow
                  ? 'admin.programme.row.payeeVerified'
                  : 'admin.programme.row.payeeUnverified',
              )}
              tone={row.payeeVerifiedNow ? 'success' : 'warning'}
            />
          </span>
        )}
      </span>
    );
  };

  const sinceCell = (row: ProgrammeQueueRow) => {
    const since = sinceOf(row);
    if (since === null) return t('admin.payments.dash');
    const date = dayMonth(since, locale, zone);
    return (
      <span className="stack">
        <strong className="text-medium">
          {t('admin.programme.row.late', { days: daysSince(since) })}
        </strong>
        <span className="text-caption tone-muted">
          {row.request === null
            ? t('admin.programme.row.pausedSince', { date })
            : t('admin.programme.row.openedAt', { date })}
        </span>
      </span>
    );
  };

  const table =
    listed === undefined ? (
      list.isError ? (
        <div className="stack gap-4">
          <Banner icon={{ name: 'alert-circle' }} tone="danger">
            <span className="stack gap-1">
              <strong>
                {t('admin.common.loadError.title', { page: t('admin.programme.title') })}
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
      <EmptyState
        icon={{ name: 'layers' }}
        title={t('admin.programme.empty.title')}
        text={t('admin.programme.empty.text')}
      />
    ) : (
      <DataTable
        columns={[
          { key: 'programme', header: t('admin.programme.columns.programme') },
          { key: 'item', header: t('admin.programme.columns.item'), wrap: true },
          { key: 'since', header: t('admin.programme.columns.since') },
          { key: 'state', header: t('admin.programme.columns.state'), end: true },
        ]}
        rows={listed.items.map((row) => ({
          key: row.enrollmentId,
          cells: {
            programme: (
              <span className="stack">
                <span>{t('admin.programme.row.student', { name: row.student.displayName })}</span>
                <span className="text-caption tone-muted">
                  {t('admin.programme.row.teacher', { name: row.teacher.displayName })}
                </span>
              </span>
            ),
            item: itemCell(row),
            since: sinceCell(row),
            state: (
              <Badge
                label={t(PROGRAMME_STATE[row.state].label)}
                tone={PROGRAMME_STATE[row.state].tone}
              />
            ),
          },
        }))}
        {...(selected === null ? {} : { selectedKey: selected })}
        onSelect={(enrollmentId) => setParams({ programme: enrollmentId })}
        footer={{
          summary: t('admin.programme.pagerPage', { page }),
          pager: { page, pageCount, onChange: go },
        }}
      />
    );

  const queued =
    selected === null ? undefined : listed?.items.find((row) => row.enrollmentId === selected);

  return (
    <Page title={t('admin.programme.title')} subtitle={t('admin.programme.lede')}>
      <Toolbar>
        <CategoryTabs
          accessibilityLabel={t('admin.common.a11y.filters')}
          value={filter}
          onChange={(value) => {
            const chosen = QUEUE_TABS.find((one) => one.filter === value);
            if (chosen !== undefined) setFilter(chosen.filter);
          }}
          tabs={QUEUE_TABS.map((one) => ({ value: one.filter, label: t(one.label) }))}
        />
      </Toolbar>
      {tab === undefined ? null : (
        <Banner icon={{ name: 'info' }} tone="info">
          {t(tab.explain)}
        </Banner>
      )}
      <Split
        detailLabel={t('admin.programme.detail.a11y')}
        list={table}
        {...(selected === null
          ? {}
          : {
              detail: (
                <ProgrammePanel
                  key={selected}
                  enrollmentId={selected}
                  {...(queued === undefined ? {} : { queued })}
                />
              ),
            })}
      />
    </Page>
  );
}
