// 005:T022 (B49; FR-609, FR-610, FR-629; the note under T022, Q-P2 (b), Q-X2 (a)): the ijazahs.
// The page opens on «waiting for sign-off» (`status: 'rendered'`), its own tab, since the server
// answers in the order of issue; the other tabs are the other statuses, every ijazah, and the barred
// list (`BarredList`). Each row: the number in groups of four, the student and the grantor, the
// subject and the date of issue, and the status (a revoked one is never shown as valid). Pages are
// keyset pages. A row opens its ijazah beside the table (`IjazahPanel`); `?ijazah=` opens one at
// once (the request's «open the ijazah»). The board's search and its counts are not drawn: no read
// serves them.
import type { AdminIjazahStatus } from '@ijazah/contracts/admin';
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
import { BarredList } from './BarredList';
import { IjazahPanel } from './IjazahPanel';
import { useIjazahsPage } from './queries';
import { groupedNumber, IJAZAH_STATUS } from './words';

type Tab = AdminIjazahStatus | 'all' | 'barred';

const TABS: readonly { readonly value: Tab; readonly label: MessageKey }[] = [
  { value: 'rendered', label: 'admin.ijazahs.tabs.waitingSignOff' },
  { value: 'preparing', label: 'admin.ijazahs.tabs.preparing' },
  { value: 'signed_off', label: 'admin.ijazahs.tabs.signedOff' },
  { value: 'revoked', label: 'admin.ijazahs.tabs.revoked' },
  { value: 'all', label: 'admin.ijazahs.tabs.all' },
  { value: 'barred', label: 'admin.ijazahs.tabs.barred' },
];

export function AdminIjazahs() {
  const t = useT();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>('rendered');
  const [selected, setSelected] = useState<string | null>(params.get('ijazah'));
  return (
    <Page title={t('admin.ijazahs.title')} subtitle={t('admin.ijazahs.explain')}>
      <Toolbar>
        <CategoryTabs
          accessibilityLabel={t('admin.common.a11y.filters')}
          value={tab}
          onChange={(value) => setTab(value as Tab)}
          tabs={TABS.map(({ value, label }) => ({ value, label: t(label) }))}
        />
      </Toolbar>
      {tab === 'barred' ? (
        <BarredList />
      ) : (
        <Split
          detailLabel={t('admin.ijazahs.detail.a11y')}
          list={<IjazahsTable key={tab} tab={tab} selected={selected} onSelect={setSelected} />}
          {...(selected === null
            ? {}
            : { detail: <IjazahPanel key={selected} ijazahId={selected} /> })}
        />
      )}
    </Page>
  );
}

function IjazahsTable({
  tab,
  selected,
  onSelect,
}: {
  readonly tab: Exclude<Tab, 'barred'>;
  readonly selected: string | null;
  readonly onSelect: (ijazahId: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  // The cursor of each page read so far: the first page has none.
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  const [page, setPage] = useState(1);
  const list = useIjazahsPage(tab === 'all' ? undefined : tab, cursors[page - 1]);

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
            <strong>{t('admin.common.loadError.title', { page: t('admin.ijazahs.title') })}</strong>
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
        title={t('admin.ijazahs.emptyTab.title')}
        text={t('admin.ijazahs.emptyTab.text')}
      />
    );
  }
  return (
    <DataTable
      columns={[
        { key: 'number', header: t('admin.ijazahs.columns.certificateNo') },
        { key: 'parties', header: t('admin.ijazahs.columns.parties') },
        { key: 'issued', header: t('admin.ijazahs.columns.issued') },
        { key: 'status', header: t('admin.ijazahs.columns.status'), end: true },
      ]}
      rows={listed.items.map((row) => {
        const status = IJAZAH_STATUS[row.status];
        return {
          key: row.ijazahId,
          cells: {
            number: <span className="ltr">{groupedNumber(row.certificateNumber)}</span>,
            parties: (
              <bdi>
                {t('admin.ijazahs.partiesCell', {
                  student: row.student.displayName ?? t('admin.users.directory.deletedAccount'),
                  teacher: row.teacher.displayName ?? t('admin.users.directory.deletedAccount'),
                })}
              </bdi>
            ),
            issued: t('admin.ijazahs.issuedCell', {
              subject: locale === 'ar' ? row.subject.nameAr : row.subject.nameEn,
              date: dayMonthYear(row.grantedAt, locale, zone),
            }),
            status: <Badge label={t(status.label)} tone={status.tone} />,
          },
        };
      })}
      {...(selected === null ? {} : { selectedKey: selected })}
      onSelect={onSelect}
      footer={{
        summary: t('admin.ijazahs.pagerPage', { page }),
        pager: { page, pageCount, onChange: go },
      }}
    />
  );
}
