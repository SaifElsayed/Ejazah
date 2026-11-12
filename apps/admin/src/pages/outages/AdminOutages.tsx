// T048 (FR-445; T016; R-TIME-6): `/outages`, the video outage windows administrators recorded
// (LiveKit Cloud sends no outage event, ADR 0003). The list, newest first as the server answers it
// (`sessions.outages.list`): each window's start and end in the panel's zone, its reason and who
// recorded it; keyset pages, the pager offering the pages read and the next one while the server
// writes a cursor. The header's button opens the record form (`RecordOutageDialog`), mounted only
// while open; once recorded, the answer's reclassified sessions are said in words and the list and
// the review queue are read again. A failed read is the generic `admin.common.loadError.*`.
import { useState } from 'react';

import { Banner, Button, DataTable, EmptyState, Page, Skeleton } from '../../design/components';
import { useLocale, useT } from '../../i18n';
import { UserText } from '../../i18n/UserText';
import { errorMessageKey } from '../../lib/error-message';
import { dayMonthYear, timeOfDay } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { useOutagesPage } from './queries';
import { RecordOutageDialog } from './RecordOutageDialog';

export function AdminOutages() {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState<number | undefined>(undefined);
  // The cursor of each page read so far: the first page has none.
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  const [page, setPage] = useState(1);
  const list = useOutagesPage(cursors[page - 1]);

  const listed = list.data;
  const loadFailure = errorMessageKey(list.error, 'admin.common.loadError.text');
  const next = listed?.nextCursor;
  const pageCount = page === cursors.length && next !== undefined ? page + 1 : cursors.length;
  const go = (target: number) => {
    if (target === cursors.length + 1 && next !== undefined) setCursors([...cursors, next]);
    setPage(target);
  };
  const at = (value: string) =>
    t('admin.common.dateTime', {
      date: dayMonthYear(value, locale, zone),
      time: timeOfDay(value, locale, zone),
    });

  const table =
    listed === undefined ? (
      list.isError ? (
        <div className="stack gap-4">
          <Banner icon={{ name: 'alert-circle' }} tone="danger">
            <span className="stack gap-1">
              <strong>
                {t('admin.common.loadError.title', { page: t('admin.outages.title') })}
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
        icon={{ name: 'list' }}
        title={t('admin.outages.empty.title')}
        text={t('admin.outages.empty.text')}
      />
    ) : (
      <DataTable
        columns={[
          { key: 'start', header: t('admin.outages.columns.start') },
          { key: 'end', header: t('admin.outages.columns.end') },
          { key: 'reason', header: t('admin.outages.columns.reason'), wrap: true },
          { key: 'recordedBy', header: t('admin.outages.columns.recordedBy'), end: true },
        ]}
        rows={listed.items.map((row) => ({
          key: row.outageId,
          cells: {
            start: at(row.startsAt),
            end: at(row.endsAt),
            reason: <UserText>{row.reason}</UserText>,
            recordedBy: <UserText>{row.recordedBy.displayName}</UserText>,
          },
        }))}
        footer={{
          summary: t('admin.outages.pagerPage', { page }),
          pager: { page, pageCount, onChange: go },
        }}
      />
    );

  return (
    <Page
      title={t('admin.outages.title')}
      subtitle={t('admin.outages.lede')}
      actions={
        <Button
          label={t('admin.outages.record')}
          onPress={() => {
            setRecorded(undefined);
            setRecording(true);
          }}
        />
      }
    >
      {recorded === undefined ? null : (
        <Banner icon={{ name: 'circle-check' }} tone="success">
          {t('admin.outages.recorded', { count: recorded })}
        </Banner>
      )}
      {table}
      {recording ? (
        <RecordOutageDialog
          onDone={(answer) => {
            setRecording(false);
            setRecorded(answer.reclassified);
            // A new window is the newest: the list starts again at its first page.
            setCursors([undefined]);
            setPage(1);
          }}
          onClose={() => setRecording(false)}
        />
      ) : null}
    </Page>
  );
}
