// 005:T022 (B49; FR-604, FR-628; the note under T022, Q-P1 (a), Q-X2 (a)): the ijazah requests.
// The queue opens on the requests in review (`status: 'pending'`), «All» reads every request; each
// row names the teacher and the student, the subject, the day it was sent, its status and the
// teacher's standing now (FR-628). Pages are keyset pages. A row opens its request beside the table
// (`IjazahRequestPanel`); `?request=` opens one at once (the ijazah's «open the request»). The
// board's search, its counts and its «decided» tab are not drawn: no read serves them.
import type { IjazahRequestStatus } from '@ijazah/contracts';
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
import { dayMonthYear } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { useStudentName } from '../ijazahs/StudentBar';
import { IjazahRequestPanel } from './IjazahRequestPanel';
import { useRequestsPage } from './queries';
import { REQUEST_STATUS, STANDING } from './words';

const IN_REVIEW = 'pending';
const ALL = 'all';

export function AdminIjazahRequests() {
  const t = useT();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<typeof IN_REVIEW | typeof ALL>(IN_REVIEW);
  const [selected, setSelected] = useState<string | null>(params.get('request'));
  return (
    <Page title={t('admin.ijazahRequests.title')} subtitle={t('admin.ijazahRequests.explain')}>
      <Toolbar>
        <CategoryTabs
          accessibilityLabel={t('admin.common.a11y.filters')}
          value={tab}
          onChange={(value) => setTab(value === ALL ? ALL : IN_REVIEW)}
          tabs={[
            { value: IN_REVIEW, label: t('admin.ijazahRequests.tabs.inReview') },
            { value: ALL, label: t('admin.ijazahRequests.tabs.all') },
          ]}
        />
      </Toolbar>
      <Split
        detailLabel={t('admin.ijazahRequests.detail.a11y')}
        list={
          <RequestsTable
            key={tab}
            status={tab === ALL ? undefined : IN_REVIEW}
            selected={selected}
            onSelect={setSelected}
          />
        }
        {...(selected === null
          ? {}
          : { detail: <IjazahRequestPanel key={selected} requestId={selected} /> })}
      />
    </Page>
  );
}

function RequestsTable({
  status,
  selected,
  onSelect,
}: {
  readonly status: IjazahRequestStatus | undefined;
  readonly selected: string | null;
  readonly onSelect: (requestId: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const nameOf = useStudentName();
  // The cursor of each page read so far: the first page has none.
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  const [page, setPage] = useState(1);
  const list = useRequestsPage(status, cursors[page - 1]);

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
            <strong>
              {t('admin.common.loadError.title', { page: t('admin.ijazahRequests.title') })}
            </strong>
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
    return (
      <EmptyState
        icon={{ name: 'award' }}
        title={t('admin.ijazahRequests.empty.title')}
        text={t('admin.ijazahRequests.empty.text')}
      />
    );
  }
  return (
    <DataTable
      columns={[
        { key: 'pair', header: t('admin.ijazahRequests.columns.teacherStudent') },
        { key: 'subject', header: t('admin.ijazahRequests.detail.subject') },
        { key: 'submitted', header: t('admin.ijazahRequests.columns.submitted') },
        { key: 'standing', header: t('admin.ijazahRequests.columns.standing') },
        { key: 'status', header: t('admin.ijazahRequests.columns.status'), end: true },
      ]}
      rows={listed.items.map((row) => {
        const state = REQUEST_STATUS[row.status];
        const standing = STANDING[row.teacherStanding.status];
        return {
          key: row.requestId,
          cells: {
            pair: (
              <bdi>
                {t('admin.ijazahRequests.pair', {
                  teacher: nameOf(row.teacher),
                  student: nameOf(row.student),
                })}
              </bdi>
            ),
            subject: locale === 'ar' ? row.subject.nameAr : row.subject.nameEn,
            submitted: dayMonthYear(row.sentAt, locale, zone),
            standing: <Badge label={t(standing.label)} tone={standing.tone} />,
            status: <Badge label={t(state.label)} tone={state.tone} />,
          },
        };
      })}
      {...(selected === null ? {} : { selectedKey: selected })}
      onSelect={onSelect}
      footer={{
        summary: t('admin.ijazahRequests.pagerPage', { page }),
        pager: { page, pageCount, onChange: go },
      }}
    />
  );
}
