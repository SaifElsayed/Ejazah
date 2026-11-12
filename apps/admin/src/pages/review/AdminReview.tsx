// T048 (FR-477, FR-439; T033, T059; research R-323 GAP-2 and GAP-3): `/review`, the session review
// queue. The sessions `under_threshold` and `provider_outage`, oldest first as the server answers
// them (`sessions.review.list`), each with its time in the panel's zone, its two parties (a deleted
// one by its stand-in, FR-426), the simultaneous seconds the evaluation decided on, and its status;
// keyset pages, the pager offering the pages read and the next one while the server writes a
// cursor. A row opens its connection record beside the queue, and `?session=` opens one at once:
// `/sessions` links any session no longer scheduled there (GAP-2), in the queue or not. The record
// carries the resolution or the correction (`TelemetryPanel`). A failed read is the generic
// `admin.common.loadError.*`.
//
// Left out, as the board draws them with no requirement behind them (the note under T048, Q2): the
// board's search, its «decided» tab and a second confirmation step.
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import {
  Badge,
  Banner,
  Button,
  DataTable,
  EmptyState,
  Page,
  Skeleton,
  Split,
} from '../../design/components';
import { useLocale, useT } from '../../i18n';
import { dayMonth, timeOfDay } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { PartyName } from '../_shared';
import { useReviewPage } from './queries';
import { SESSION_STATUS, TelemetryPanel } from './TelemetryPanel';

export function AdminReview() {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const [params, setParams] = useSearchParams();
  const selected = params.get('session');
  // The cursor of each page read so far: the first page has none.
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  const [page, setPage] = useState(1);
  const list = useReviewPage(cursors[page - 1]);

  const listed = list.data;
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
                {t('admin.common.loadError.title', { page: t('admin.sessionReview.title') })}
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
    ) : listed.items.length === 0 && page === 1 ? (
      <EmptyState
        icon={{ name: 'circle-check' }}
        title={t('admin.sessionReview.empty.title')}
        text={t('admin.review.empty.text')}
      />
    ) : (
      <DataTable
        columns={[
          { key: 'session', header: t('admin.sessionReview.columns.session') },
          { key: 'student', header: t('admin.sessionReview.columns.student') },
          { key: 'teacher', header: t('admin.sessionReview.columns.teacher') },
          {
            key: 'simultaneous',
            header: t('admin.sessionReview.columns.simultaneous'),
            numeric: true,
          },
          { key: 'status', header: t('admin.sessionReview.columns.status'), end: true },
        ]}
        rows={listed.items.map((row) => ({
          key: row.sessionId,
          cells: {
            session: t('admin.common.dateTime', {
              date: dayMonth(row.startsAt, locale, zone),
              time: timeOfDay(row.startsAt, locale, zone),
            }),
            student: <PartyName party={row.parties.student} role="student" />,
            teacher: <PartyName party={row.parties.teacher} role="teacher" />,
            simultaneous: t('admin.review.seconds', { count: row.simultaneousSeconds }),
            status: (
              <Badge
                label={t(SESSION_STATUS[row.status].label)}
                tone={SESSION_STATUS[row.status].tone}
              />
            ),
          },
        }))}
        {...(selected === null ? {} : { selectedKey: selected })}
        onSelect={(sessionId) => setParams({ session: sessionId })}
        footer={{
          summary: t('admin.review.pagerPage', { page }),
          pager: { page, pageCount, onChange: go },
        }}
      />
    );

  return (
    <Page title={t('admin.sessionReview.title')} subtitle={t('admin.review.lede')}>
      <Split
        detailLabel={t('admin.sessionReview.detail.a11y')}
        list={table}
        {...(selected === null
          ? {}
          : { detail: <TelemetryPanel key={selected} sessionId={selected} /> })}
      />
    </Page>
  );
}
