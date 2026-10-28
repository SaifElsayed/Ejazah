// T071 (FR-160 to FR-162): the applications queue (`AdminApplications`, screens.md §18). The lede and
// the tabs' counts come from `home.summary`, whose `open` counts the applications in review alone
// (`readApplicationQueue`): «قيد المراجعة» is `open`, «مطلوب من المتقدّم» `waitingOnApplicant`, the
// lede the two together (the board: 3 = 2 + 1), and «تم البتّ» has no count (B14b-1 review, round
// 1). The search is the name or the email, sent once the typing stops, and a settled search goes
// back to the first page. The table lists the tab's page, oldest first, with the pager the page size
// answers; a row opens its detail beside it, and `?teacher=` opens one at once (the credentials'
// «طلب الانضمام», T072). An empty tab, an empty search and a list that could not be read each say
// so. T111: «أُرسل» wraps rather than being cut at the table's edge.
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import {
  Avatar,
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
import { dayMonth } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { ApplicationPanel } from './ApplicationPanel';
import { initialsOf } from './initials';
import {
  type ApplicationRow,
  type ApplicationsTab,
  useApplicationsPage,
  useQueueCounts,
  useSettled,
} from './queries';

const TABS: readonly {
  readonly value: ApplicationsTab;
  readonly label: 'inReview' | 'waitingOnApplicant' | 'decided';
}[] = [
  { value: 'in_review', label: 'inReview' },
  { value: 'waiting', label: 'waitingOnApplicant' },
  { value: 'decided', label: 'decided' },
];

export function AdminApplications() {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const [tab, setTab] = useState<ApplicationsTab>('in_review');
  const [typed, setTyped] = useState('');
  const search = useSettled(typed);
  const [page, setPage] = useState(1);
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(params.get('teacher'));
  const list = useApplicationsPage(tab, search, page);
  const counts = useQueueCounts();

  const inReview = counts.data?.open;
  const waiting = counts.data?.waitingOnApplicant;
  const pending = inReview === undefined || waiting === undefined ? undefined : inReview + waiting;
  const countOf: Readonly<Record<ApplicationsTab, number | undefined>> = {
    in_review: inReview,
    waiting,
    decided: undefined,
  };

  // A new search starts at the first page, once it settles: a keystroke reads nothing.
  const [searched, setSearched] = useState(search);
  if (searched !== search) {
    setSearched(search);
    setPage(1);
  }

  const choose = (next: ApplicationsTab) => {
    setTab(next);
    setPage(1);
    setSelected(null);
  };

  // The board lists the subjects with the language's comma («حفظ القرآن، التجويد»).
  const subjectsOf = (row: ApplicationRow) =>
    row.subjects
      .map((subject) => (locale === 'ar' ? subject.nameAr : subject.nameEn))
      .join(locale === 'ar' ? '، ' : ', ');

  const listed = list.data;
  return (
    <Page
      title={t('admin.applications.title')}
      subtitle={
        pending === undefined
          ? undefined
          : pending === 0
            ? t('admin.applications.ledeEmpty')
            : t('admin.applications.lede', { count: pending })
      }
    >
      <Toolbar
        search={{
          value: typed,
          onChangeText: setTyped,
          placeholder: t('admin.applications.search.placeholder'),
        }}
      >
        <CategoryTabs
          accessibilityLabel={t('admin.common.a11y.status')}
          value={tab}
          onChange={(value) => choose(value as ApplicationsTab)}
          tabs={TABS.map(({ value, label }) => ({
            value,
            label: t(`admin.applications.tabs.${label}`),
            ...(countOf[value] === undefined ? {} : { count: countOf[value] }),
          }))}
        />
      </Toolbar>
      <Split
        detailLabel={t('admin.applications.detail.a11y')}
        list={
          listed === undefined ? (
            list.isError ? (
              <div className="stack gap-4">
                <Banner icon={{ name: 'alert-circle' }} tone="danger">
                  <span className="stack gap-1">
                    <strong>
                      {t('admin.common.loadError.title', { page: t('admin.applications.title') })}
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
          ) : listed.rows.length === 0 ? (
            <EmptyState
              icon={{ name: 'user-check' }}
              {...emptyOf(search === '' ? tab : 'search', t)}
            />
          ) : (
            <DataTable
              columns={[
                { key: 'applicant', header: t('admin.applications.columns.applicant') },
                { key: 'subjects', header: t('admin.applications.columns.subjects') },
                { key: 'call', header: t('admin.applications.columns.call') },
                {
                  key: 'submitted',
                  header: t('admin.applications.columns.submitted'),
                  wrap: true,
                },
              ]}
              rows={listed.rows.map((row) => ({
                key: row.teacherUserId,
                cells: {
                  applicant: (
                    <span className="row gap-3">
                      <Avatar initials={initialsOf(row.displayName)} size="sm" />
                      <span className="stack">
                        <bdi className="text-medium">{row.displayName}</bdi>
                        <span className="text-caption tone-muted ltr">{row.email}</span>
                      </span>
                    </span>
                  ),
                  subjects: subjectsOf(row),
                  call:
                    row.callRecordedOn === undefined ? (
                      <Badge label={t('admin.status.call.notRecorded')} tone="neutral" />
                    ) : (
                      <Badge
                        label={t('admin.status.call.recorded', {
                          date: dayMonth(row.callRecordedOn, locale, zone),
                        })}
                        tone="success"
                      />
                    ),
                  submitted: dayMonth(row.submittedAt, locale, zone),
                },
              }))}
              {...(selected === null ? {} : { selectedKey: selected })}
              onSelect={setSelected}
              footer={{
                summary: t('admin.applications.pagerSummary', {
                  shown: listed.rows.length,
                  total: listed.total,
                }),
                pager: {
                  page,
                  pageCount: Math.ceil(listed.total / listed.pageSize),
                  onChange: setPage,
                },
              }}
            />
          )
        }
        detail={
          selected === null ? (
            <section className="panel">
              <div className="panel__body">
                <p className="text-callout tone-muted">{t('admin.common.panel.nothingSelected')}</p>
              </div>
            </section>
          ) : (
            <ApplicationPanel teacherUserId={selected} />
          )
        }
      />
    </Page>
  );
}

/** The empty state of a tab, or of a search that matched nothing. */
function emptyOf(
  which: ApplicationsTab | 'search',
  t: ReturnType<typeof useT>,
): { readonly title: string; readonly text: string } {
  switch (which) {
    case 'in_review':
      return {
        title: t('admin.applications.empty.title'),
        text: t('admin.applications.empty.text'),
      };
    case 'waiting':
      return {
        title: t('admin.applications.empty.waiting.title'),
        text: t('admin.applications.empty.waiting.text'),
      };
    case 'decided':
      return {
        title: t('admin.applications.empty.decided.title'),
        text: t('admin.applications.empty.decided.text'),
      };
    case 'search':
      return {
        title: t('admin.applications.empty.search.title'),
        text: t('admin.applications.empty.search.text'),
      };
  }
}
