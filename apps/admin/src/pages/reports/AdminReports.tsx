// 005:T023 (B49; FR-612; the note under T023, Q-R1 (a)): the reports queue. The page opens on the
// open reports, then the settled ones by their outcome, as `reports.list` reads one status at a
// time, in keyset pages in the order of reporting. Each row: the reported person and the reporter as
// links to their records (`/users?user=`; the reads carry ids only), the context, the date and the
// status. A row opens its report beside the table (`ReportPanel`); `?report=` opens one at once (a
// gender flag's «open the report»). The board's search and its counts are not drawn: no read serves
// them.
import type { ReportStatus } from '@ijazah/contracts/admin';
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
import { type MessageKey, useLocale, useT } from '../../i18n';
import { errorMessageKey } from '../../lib/error-message';
import { dayMonthYear } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { PersonLink } from '../gender/PersonLink';
import { useReportsPage } from './queries';
import { ReportPanel } from './ReportPanel';
import { REPORT_CONTEXT, REPORT_STATUS } from './words';

const TABS: readonly { readonly value: ReportStatus; readonly label: MessageKey }[] = [
  { value: 'open', label: 'admin.reports.tabs.open' },
  { value: 'actioned', label: 'admin.reports.tabs.actioned' },
  { value: 'dismissed', label: 'admin.reports.tabs.dismissed' },
];

export function AdminReports() {
  const t = useT();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<ReportStatus>('open');
  const [selected, setSelected] = useState<string | null>(params.get('report'));
  return (
    <Page title={t('admin.reports.title')} subtitle={t('admin.reports.explain')}>
      <Toolbar>
        <CategoryTabs
          accessibilityLabel={t('admin.common.a11y.filters')}
          value={tab}
          onChange={(value) => setTab(value as ReportStatus)}
          tabs={TABS.map(({ value, label }) => ({ value, label: t(label) }))}
        />
      </Toolbar>
      <Split
        detailLabel={t('admin.reports.detail.a11y')}
        list={<ReportsTable key={tab} tab={tab} selected={selected} onSelect={setSelected} />}
        {...(selected === null
          ? {}
          : { detail: <ReportPanel key={selected} reportId={selected} /> })}
      />
    </Page>
  );
}

function ReportsTable({
  tab,
  selected,
  onSelect,
}: {
  readonly tab: ReportStatus;
  readonly selected: string | null;
  readonly onSelect: (reportId: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  // The cursor of each page read so far: the first page has none.
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  const [page, setPage] = useState(1);
  const list = useReportsPage(tab, cursors[page - 1]);

  const listed = list.data;
  const next = listed?.nextCursor;
  const pageCount = page === cursors.length && next !== undefined ? page + 1 : cursors.length;
  const go = (target: number) => {
    if (target === cursors.length + 1 && next !== undefined) setCursors([...cursors, next]);
    setPage(target);
  };

  if (listed === undefined) {
    if (!list.isError) return <Skeleton shape="block" />;
    const failure = errorMessageKey(list.error, 'admin.common.loadError.text');
    return (
      <div className="stack gap-4">
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          <span className="stack gap-1">
            <strong>{t('admin.common.loadError.title', { page: t('admin.reports.title') })}</strong>
            <span>{t(failure.key, failure.values)}</span>
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
    );
  }
  if (listed.items.length === 0 && page === 1) {
    const empty = tab === 'open' ? 'empty' : 'emptyTab';
    return (
      <EmptyState
        icon={{ name: 'flag' }}
        title={t(`admin.reports.${empty}.title`)}
        text={t(`admin.reports.${empty}.text`)}
      />
    );
  }
  return (
    <DataTable
      columns={[
        { key: 'reported', header: t('admin.reports.columns.reported') },
        { key: 'reporter', header: t('admin.reports.columns.reporter') },
        { key: 'context', header: t('admin.reports.columns.context') },
        { key: 'date', header: t('admin.reports.columns.date') },
        { key: 'status', header: t('admin.reports.columns.status'), end: true },
      ]}
      rows={listed.items.map((row) => {
        const status = REPORT_STATUS[row.status];
        return {
          key: row.reportId,
          cells: {
            reported: <PersonLink userId={row.reportedUserId} />,
            reporter: <PersonLink userId={row.reporterUserId} />,
            context: t(REPORT_CONTEXT[row.context]),
            date: dayMonthYear(row.createdAt, locale, zone),
            status: <Badge label={t(status.label)} tone={status.tone} />,
          },
        };
      })}
      {...(selected === null ? {} : { selectedKey: selected })}
      onSelect={onSelect}
      footer={{
        summary: t('admin.reports.pagerPage', { page }),
        pager: { page, pageCount, onChange: go },
      }}
    />
  );
}
