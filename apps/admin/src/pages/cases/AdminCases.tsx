// T050 (FR-478, FR-422, FR-451, FR-452, FR-453, FR-493; R-MONEY-6; admin-surface.md, `cases`): the
// compensation-case queue and the complaints of a teacher's absence, `/cases`. The table lists the
// rows as `cases.list` orders them (the open `student_suspended` cases first, then the rest by their
// opening): each case by its reason in plain words, a complaint by its kind, the two manual reasons
// by their party; its opening and closing in the panel's zone; its enrollment's Teacher-No-Show
// count and mark (lane S's `NoShowMark`); its state. The status tabs filter, the pager follows the
// server's cursor, and «open a case» opens lane S's `ManualCaseDialog` with no enrollment (the
// administrator enters it). A row opens its case beside the table and `?case=` opens one at once
// (the links of other pages and of a decision's new case): `CasePanel`. No amount anywhere; the
// orders are the payments monitor's page.
//
// Left out, as the board draws them with no requirement behind them (the note under T050, Q2): the
// board's `/compensation` path, any amount, a «pending execution» tab, the board's list of reasons.
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
import { dayMonth, timeOfDay } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { ManualCaseDialog, NoShowMark } from '../_shared';
import { CasePanel } from './CasePanel';
import { type CasesFilter, useCasesPage, useCasesRefresh } from './queries';
import { CASE_STATUS, caseTitle } from './words';

type CaseStatus = NonNullable<CasesFilter['status']>;

/** The tab with no status filter. */
const ALL = 'all';
const STATUSES: readonly CaseStatus[] = ['open', 'resolved', 'dismissed'];

export function AdminCases() {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const refresh = useCasesRefresh();
  const [params, setParams] = useSearchParams();
  const selected = params.get('case');
  const [status, setStatus] = useState<CaseStatus | undefined>(undefined);
  const [opening, setOpening] = useState(false);
  // The cursor of each page read so far: the first page has none.
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  const [page, setPage] = useState(1);
  const filter: CasesFilter = status === undefined ? {} : { status };
  const list = useCasesPage(filter, cursors[page - 1]);

  // A new filter starts at the first page.
  const [shownFor, setShownFor] = useState(status);
  if (shownFor !== status) {
    setShownFor(status);
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
  const at = (instant: string) =>
    t('admin.common.dateTime', {
      date: dayMonth(instant, locale, zone),
      time: timeOfDay(instant, locale, zone),
    });

  const table =
    listed === undefined ? (
      list.isError ? (
        <div className="stack gap-4">
          <Banner icon={{ name: 'alert-circle' }} tone="danger">
            <span className="stack gap-1">
              <strong>{t('admin.common.loadError.title', { page: t('admin.cases.title') })}</strong>
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
      status === undefined && page === 1 ? (
        <EmptyState
          icon={{ name: 'scale' }}
          title={t('admin.cases.emptyAll.title')}
          text={t('admin.cases.emptyAll.text')}
        />
      ) : (
        <EmptyState
          icon={{ name: 'search' }}
          title={t('admin.cases.empty.title')}
          text={t('admin.cases.empty.text')}
        />
      )
    ) : (
      <DataTable
        columns={[
          { key: 'case', header: t('admin.cases.columns.case'), wrap: true },
          { key: 'enrollment', header: t('admin.cases.columns.enrollment') },
          { key: 'status', header: t('admin.cases.columns.status'), end: true },
        ]}
        rows={listed.items.map((row) => ({
          key: row.caseId,
          cells: {
            case: (
              <span className="stack">
                <strong className="text-medium">{t(caseTitle(row))}</strong>
                <span className="text-caption tone-muted">
                  {t('admin.cases.openedAt', { date: at(row.openedAt) })}
                </span>
                {row.closedAt === undefined ? null : (
                  <span className="text-caption tone-muted">
                    {t('admin.cases.closedAt', { date: at(row.closedAt) })}
                  </span>
                )}
              </span>
            ),
            enrollment: (
              <NoShowMark
                teacherNoShows={row.teacherNoShows}
                repeatedAbsence={row.repeatedAbsence}
              />
            ),
            status: (
              <Badge label={t(CASE_STATUS[row.status].label)} tone={CASE_STATUS[row.status].tone} />
            ),
          },
        }))}
        {...(selected === null ? {} : { selectedKey: selected })}
        onSelect={(caseId) => setParams({ case: caseId })}
        footer={{
          summary: t('admin.cases.pagerPage', { page }),
          pager: { page, pageCount, onChange: go },
        }}
      />
    );

  return (
    <Page
      title={t('admin.cases.title')}
      subtitle={t('admin.cases.lede')}
      actions={
        <Button
          label={t('admin.cases.openManual')}
          icon={{ name: 'plus' }}
          onPress={() => setOpening(true)}
        />
      }
    >
      <Toolbar>
        <CategoryTabs
          accessibilityLabel={t('admin.common.a11y.status')}
          value={status ?? ALL}
          onChange={(value) =>
            setStatus(value === ALL ? undefined : STATUSES.find((one) => one === value))
          }
          tabs={[
            { value: ALL, label: t('admin.common.action.all') },
            ...STATUSES.map((one) => ({ value: one, label: t(CASE_STATUS[one].label) })),
          ]}
        />
      </Toolbar>
      <Split
        detailLabel={t('admin.cases.detail.a11y')}
        list={table}
        {...(selected === null ? {} : { detail: <CasePanel key={selected} caseId={selected} /> })}
      />
      {opening ? <ManualCaseDialog onDone={refresh} onClose={() => setOpening(false)} /> : null}
    </Page>
  );
}
