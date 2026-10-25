// T073 (FR-175): the audit log (`AdminAudit`, screens.md). The last thirty days by default, as the
// board's date chip, in the panel's zone (`lib/zone.ts`; T067's note: the days are calendar days
// sent with their zone), removable, and «مسح الكل» clears it with the search. The search is in the
// stored label and the reason, sent once the typing stops. The table: the time, the administrator,
// the action as the panel names it, the target by its current name (a link where this phase has its
// page), the reason; the pager the page size answers. A row opens its entry beside the table. The
// board's filter panel (the range, the administrator, the action) is not drawn and is not built.
import { useState } from 'react';
import { useNavigate } from 'react-router';

import {
  Banner,
  Button,
  DataTable,
  EmptyState,
  FilterChips,
  Page,
  Skeleton,
  Split,
  TextLink,
  Toolbar,
} from '../../design/components';
import { useLocale, useT } from '../../i18n';
import { cityName, dayMonth, timeOfDay } from '../../lib/format';
import { daysBefore, panelTimeZone, todayIn } from '../../lib/zone';
import { useSettled } from '../applications/queries';
import { actionText, targetHref, targetText } from './actions';
import { AuditEntry } from './AuditEntry';
import { type AuditFilter, useAuditPage } from './queries';

/** The chip's period: the board's «آخر … يومًا», today included. */
export const DEFAULT_DAYS = 30;

export function AdminAudit() {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const zone = panelTimeZone();
  const [dated, setDated] = useState(true);
  const [typed, setTyped] = useState('');
  const search = useSettled(typed);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const today = todayIn(zone);
  const filter: AuditFilter = {
    ...(search === '' ? {} : { search }),
    ...(dated ? { from: daysBefore(today, DEFAULT_DAYS - 1), to: today, timeZone: zone } : {}),
  };
  const list = useAuditPage(filter, page);

  // A new search or period starts at the first page; a keystroke reads nothing.
  const filters = `${search}|${String(dated)}`;
  const [shownFor, setShownFor] = useState(filters);
  if (shownFor !== filters) {
    setShownFor(filters);
    setPage(1);
  }

  const listed = list.data;
  const city = cityName(zone, locale);
  const table =
    listed === undefined ? (
      list.isError ? (
        <div className="stack gap-4">
          <Banner icon={{ name: 'alert-circle' }} tone="danger">
            <span className="stack gap-1">
              <strong>{t('admin.common.loadError.title', { page: t('admin.audit.title') })}</strong>
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
    ) : listed.rows.length === 0 ? (
      dated || search !== '' ? (
        <EmptyState
          icon={{ name: 'list' }}
          title={t('admin.audit.empty.title')}
          text={t('admin.audit.empty.text')}
        />
      ) : (
        <EmptyState
          icon={{ name: 'list' }}
          title={t('admin.audit.emptyAll.title')}
          text={t('admin.audit.emptyAll.text')}
        />
      )
    ) : (
      <DataTable
        columns={[
          { key: 'time', header: t('admin.audit.columns.time') },
          { key: 'admin', header: t('admin.audit.columns.admin') },
          { key: 'action', header: t('admin.audit.columns.action') },
          { key: 'target', header: t('admin.audit.columns.target') },
          { key: 'reason', header: t('admin.audit.columns.reason') },
        ]}
        rows={listed.rows.map((row) => {
          const href = targetHref(row);
          const target = targetText(row, t);
          return {
            key: row.entryId,
            cells: {
              time: (
                <span className="stack">
                  <span>{dayMonth(row.occurredAt, locale, zone)}</span>
                  <span className="text-caption tone-muted">
                    {timeOfDay(row.occurredAt, locale, zone)}
                  </span>
                </span>
              ),
              admin: <bdi>{row.adminName}</bdi>,
              action: <span className="text-medium">{actionText(row.action, t)}</span>,
              target:
                href === undefined ? (
                  target
                ) : (
                  <TextLink label={target} href={href} onPress={() => void navigate(href)} />
                ),
              reason:
                row.reason === undefined ? null : <bdi className="tone-muted">{row.reason}</bdi>,
            },
          };
        })}
        {...(selected === null ? {} : { selectedKey: selected })}
        onSelect={setSelected}
        footer={{
          summary: dated
            ? t('admin.audit.pagerSummary', {
                shown: listed.rows.length,
                total: listed.total,
                days: DEFAULT_DAYS,
                city,
              })
            : t('admin.audit.pagerSummaryAll', {
                shown: listed.rows.length,
                total: listed.total,
                city,
              }),
          pager: {
            page,
            pageCount: Math.ceil(listed.total / listed.pageSize),
            onChange: setPage,
          },
        }}
      />
    );

  return (
    <Page title={t('admin.audit.title')} subtitle={t('admin.audit.lede')}>
      <Toolbar
        search={{
          value: typed,
          onChangeText: setTyped,
          placeholder: t('admin.audit.search.placeholder'),
        }}
      >
        {dated ? (
          <FilterChips
            chips={[
              {
                key: 'date',
                content: t('admin.audit.dateFilterChip', { days: DEFAULT_DAYS }),
                accessibilityLabel: t('admin.audit.a11y.removeDateFilter'),
                onRemove: () => setDated(false),
              },
            ]}
            onClearAll={() => {
              setDated(false);
              setTyped('');
            }}
          />
        ) : null}
      </Toolbar>
      <Split
        detailLabel={t('admin.audit.a11y.detail')}
        list={table}
        {...(selected === null ? {} : { detail: <AuditEntry key={selected} entryId={selected} /> })}
      />
    </Page>
  );
}
