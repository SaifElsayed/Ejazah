// 005:T023 (B49; FR-613, FR-615; the note under T023, Q-R1 (a)): the gender flags queue. The page
// opens on the open flags, then one tab per closing (corrected, banned for fraud, dismissed), as
// `genderFlags.list` reads one status at a time, in keyset pages in the order of raising. Each row:
// the flagged person and the raiser as links to their records (`/users?user=`; the reads carry ids
// only), or the administrator's words when one raised it, the date and the status. A row opens its
// flag beside the table (`GenderPanel`); `?flag=` opens one at once. An administrator raises a flag
// on a person by their account's id (`RaiseFlagDialog`).
import type { GenderFlagStatus } from '@ijazah/contracts/admin';
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
import { GenderPanel } from './GenderPanel';
import { PersonLink } from './PersonLink';
import { useGenderFlagsPage } from './queries';
import { RaiseFlagDialog } from './RaiseFlagDialog';
import { GENDER_FLAG_STATUS } from './words';

const TABS: readonly { readonly value: GenderFlagStatus; readonly label: MessageKey }[] = [
  { value: 'open', label: 'admin.gender.tabs.open' },
  { value: 'corrected', label: 'admin.gender.tabs.corrected' },
  { value: 'fraud_ban', label: 'admin.gender.tabs.fraudBan' },
  { value: 'dismissed', label: 'admin.gender.tabs.dismissed' },
];

export function AdminGender() {
  const t = useT();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<GenderFlagStatus>('open');
  const [selected, setSelected] = useState<string | null>(params.get('flag'));
  const [raising, setRaising] = useState(false);
  return (
    <Page
      title={t('admin.gender.title')}
      subtitle={t('admin.gender.explain')}
      actions={
        <Button
          label={t('admin.gender.raise')}
          variant="secondary"
          onPress={() => setRaising(true)}
        />
      }
    >
      <Toolbar>
        <CategoryTabs
          accessibilityLabel={t('admin.common.a11y.filters')}
          value={tab}
          onChange={(value) => setTab(value as GenderFlagStatus)}
          tabs={TABS.map(({ value, label }) => ({ value, label: t(label) }))}
        />
      </Toolbar>
      <Split
        detailLabel={t('admin.gender.detail.a11y')}
        list={<FlagsTable key={tab} tab={tab} selected={selected} onSelect={setSelected} />}
        {...(selected === null ? {} : { detail: <GenderPanel key={selected} flagId={selected} /> })}
      />
      {raising ? <RaiseFlagDialog onClose={() => setRaising(false)} /> : null}
    </Page>
  );
}

function FlagsTable({
  tab,
  selected,
  onSelect,
}: {
  readonly tab: GenderFlagStatus;
  readonly selected: string | null;
  readonly onSelect: (flagId: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  // The cursor of each page read so far: the first page has none.
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  const [page, setPage] = useState(1);
  const list = useGenderFlagsPage(tab, cursors[page - 1]);

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
            <strong>{t('admin.common.loadError.title', { page: t('admin.gender.title') })}</strong>
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
        icon={{ name: 'user-x' }}
        title={t(`admin.gender.${empty}.title`)}
        text={t(`admin.gender.${empty}.text`)}
      />
    );
  }
  return (
    <DataTable
      columns={[
        { key: 'user', header: t('admin.gender.columns.user') },
        { key: 'raisedBy', header: t('admin.gender.columns.raisedBy') },
        { key: 'date', header: t('admin.gender.columns.date') },
        { key: 'status', header: t('admin.gender.columns.status'), end: true },
      ]}
      rows={listed.items.map((row) => {
        const status = GENDER_FLAG_STATUS[row.status];
        return {
          key: row.flagId,
          cells: {
            user: <PersonLink userId={row.flaggedUserId} />,
            raisedBy:
              row.raisedByUserId === null ? (
                t('admin.gender.detail.raisedByAdmin')
              ) : (
                <PersonLink userId={row.raisedByUserId} />
              ),
            date: dayMonthYear(row.createdAt, locale, zone),
            status: <Badge label={t(status.label)} tone={status.tone} />,
          },
        };
      })}
      {...(selected === null ? {} : { selectedKey: selected })}
      onSelect={onSelect}
      footer={{
        summary: t('admin.gender.pagerPage', { page }),
        pager: { page, pageCount, onChange: go },
      }}
    />
  );
}
