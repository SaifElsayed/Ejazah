// T049 (FR-475, FR-476, FR-451; research R-308; contracts/admin-surface.md, "`disputes`"): the
// disputes queue. The table, as the server answers it (the open disputes first, oldest first, then
// the closed ones): who raised each dispute and when, the outcome under dispute (or that the session
// is not evaluated yet), and the session's enrollment's Teacher-No-Show count and its mark (lane
// S's `NoShowMark`; nothing follows from the mark, SRS FR-NOSHOW-3). Pages are keyset pages: the
// pager offers the pages already read and the next one while the server writes a cursor. A row
// opens its dispute beside the table (`DisputePanel`); `?dispute=` opens one at once (Q4).
//
// Left out (the note under T049, Q2): the board's chat page with a reason for viewing, its status
// tabs and search (`disputes.list` takes neither), and «{count} of {threshold} before termination».
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import {
  Banner,
  Button,
  DataTable,
  EmptyState,
  Page,
  Skeleton,
  Split,
} from '../../design/components';
import { useLocale, useT } from '../../i18n';
import { errorMessageKey } from '../../lib/error-message';
import { dayMonth } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { NoShowMark } from '../_shared';
import { DisputePanel } from './DisputePanel';
import { RAISED_BY, SESSION_STATUS } from './labels';
import { useDisputesPage } from './queries';

export function AdminDisputes() {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(params.get('dispute'));
  // The cursor of each page read so far: the first page has none.
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  const [page, setPage] = useState(1);
  const list = useDisputesPage(cursors[page - 1]);

  const listed = list.data;
  const loadFailure = errorMessageKey(list.error, 'admin.common.loadError.text');
  const next = listed?.nextCursor;
  const pageCount = page === cursors.length && next !== undefined ? page + 1 : cursors.length;
  const go = (target: number) => {
    if (target === cursors.length + 1 && next !== undefined) setCursors([...cursors, next]);
    setPage(target);
  };

  const table =
    listed === undefined ? (
      list.isError ? (
        <div className="stack gap-4">
          <Banner icon={{ name: 'alert-circle' }} tone="danger">
            <span className="stack gap-1">
              <strong>
                {t('admin.common.loadError.title', { page: t('admin.disputes.title') })}
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
    ) : listed.items.length === 0 && page === 1 ? (
      <EmptyState
        icon={{ name: 'flag' }}
        title={t('admin.disputes.queue.empty.title')}
        text={t('admin.disputes.queue.empty.text')}
      />
    ) : (
      <DataTable
        columns={[
          { key: 'dispute', header: t('admin.disputes.queue.columns.dispute') },
          { key: 'outcome', header: t('admin.disputes.queue.columns.outcome') },
          { key: 'noShows', header: t('admin.disputes.detail.noShowCount'), end: true },
        ]}
        rows={listed.items.map((row) => ({
          key: row.disputeId,
          cells: {
            dispute: t(RAISED_BY[row.raisedBy], { date: dayMonth(row.raisedAt, locale, zone) }),
            outcome:
              row.outcomeUnderDispute === undefined ? (
                <span className="tone-muted">{t('admin.disputes.queue.notEvaluated')}</span>
              ) : (
                t(SESSION_STATUS[row.outcomeUnderDispute])
              ),
            noShows: (
              <NoShowMark
                teacherNoShows={row.teacherNoShows}
                repeatedAbsence={row.repeatedAbsence}
              />
            ),
          },
        }))}
        {...(selected === null ? {} : { selectedKey: selected })}
        onSelect={setSelected}
        footer={{
          summary: t('admin.disputes.queue.pagerPage', { page }),
          pager: { page, pageCount, onChange: go },
        }}
      />
    );

  return (
    <Page title={t('admin.disputes.title')} subtitle={t('admin.disputes.queueLede')}>
      <Split
        detailLabel={t('admin.disputes.detail.a11y')}
        list={table}
        {...(selected === null
          ? {}
          : { detail: <DisputePanel key={selected} disputeId={selected} /> })}
      />
    </Page>
  );
}
