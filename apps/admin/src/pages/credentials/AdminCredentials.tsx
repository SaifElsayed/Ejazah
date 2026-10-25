// T072 (FR-163, FR-164): the credentials queue (`AdminCredentials`, `AdminCredentialCorrect`,
// screens.md). Four tabs: in review (counted by `home.summary`'s `open`), another file needed,
// verified (where a chain is corrected) and rejected; the search is the teacher's name, sent once
// the typing stops, and a settled search goes back to the first page. The selected credential's
// panel leads; beside it the tab's table, with the pager the page size answers, and the selected
// credential's file one page at a time, opened full in `AdminDocumentViewer` (the `credential`
// context) over the same link. `?credential=` opens one at once (the application's «مراجعة
// الإجازة»). An empty tab, an empty search and a list that could not be read each say so; the
// filter the board draws beside the search has no content drawn, so it is not built.
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
  IconButton,
  Page,
  Skeleton,
  Split,
  Toolbar,
} from '../../design/components';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { dayMonth, dayMonthYear } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { useSettled } from '../applications/queries';
import { initialsOf } from '../applications/initials';
import { AdminDocumentViewer } from '../documents/AdminDocumentViewer';
import { DocumentPages, usePdf } from '../documents/DocumentPages';
import { useDocumentLink } from '../documents/queries';
import { CredentialPanel } from './CredentialPanel';
import {
  type CredentialDetail,
  type CredentialsTab,
  useCredential,
  useCredentialCount,
  useCredentialsPage,
} from './queries';

const TABS: readonly { readonly value: CredentialsTab; readonly label: MessageKey }[] = [
  { value: 'pending', label: 'admin.credentials.tabs.inReview' },
  { value: 'needs_document', label: 'admin.credentials.tabs.anotherFileNeeded' },
  { value: 'approved', label: 'admin.credentials.tabs.verified' },
  { value: 'rejected', label: 'admin.credentials.tabs.rejected' },
];

const EMPTY: Readonly<Record<CredentialsTab | 'search', readonly [MessageKey, MessageKey]>> = {
  pending: ['admin.credentials.empty.title', 'admin.credentials.empty.text'],
  needs_document: ['admin.credentials.empty.waiting.title', 'admin.credentials.empty.waiting.text'],
  approved: ['admin.credentials.empty.verified.title', 'admin.credentials.empty.verified.text'],
  rejected: ['admin.credentials.empty.rejected.title', 'admin.credentials.empty.rejected.text'],
  search: ['admin.credentials.empty.search.title', 'admin.credentials.empty.search.text'],
};

export function AdminCredentials() {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<CredentialsTab>('pending');
  const [typed, setTyped] = useState('');
  const search = useSettled(typed);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(params.get('credential'));
  const list = useCredentialsPage(tab, search, page);
  const count = useCredentialCount().data;

  // A new search starts at the first page, once it settles: a keystroke reads nothing.
  const [searched, setSearched] = useState(search);
  if (searched !== search) {
    setSearched(search);
    setPage(1);
  }

  const choose = (next: CredentialsTab) => {
    setTab(next);
    setPage(1);
    setSelected(null);
  };
  const verifiedTab = tab === 'approved';
  const listed = list.data;
  const [emptyTitle, emptyText] = EMPTY[search === '' ? tab : 'search'];

  const table =
    listed === undefined ? (
      list.isError ? (
        <div className="stack gap-4">
          <Banner icon={{ name: 'alert-circle' }} tone="danger">
            <span className="stack gap-1">
              <strong>
                {t('admin.common.loadError.title', { page: t('admin.credentials.title') })}
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
        icon={{ name: 'award' }}
        title={t(emptyTitle)}
        text={t(emptyText)}
        {...(tab === 'pending' && search === ''
          ? {
              action: {
                label: t('admin.credentials.empty.showDecided'),
                onPress: () => choose('approved'),
              },
            }
          : {})}
      />
    ) : (
      <DataTable
        columns={[
          { key: 'teacher', header: t('admin.credentials.columns.teacherSubject') },
          ...(verifiedTab
            ? [{ key: 'verified', header: t('admin.credentials.columns.verifiedOn') }]
            : [
                { key: 'source', header: t('admin.credentials.columns.source') },
                { key: 'submitted', header: t('admin.credentials.columns.submitted') },
              ]),
        ]}
        rows={listed.rows.map((row) => ({
          key: row.credentialId,
          cells: {
            teacher: (
              <span className="row gap-3">
                <Avatar initials={initialsOf(row.teacher.displayName)} size="sm" />
                <span className="stack">
                  <bdi className="text-medium">{row.teacher.displayName}</bdi>
                  <span className="text-caption tone-muted">
                    {locale === 'ar' ? row.subject.nameAr : row.subject.nameEn}
                  </span>
                </span>
              </span>
            ),
            source: (
              <Badge
                label={t(
                  row.origin === 'added'
                    ? 'admin.credentials.source.addedSubject'
                    : 'admin.credentials.source.atApplication',
                )}
                tone="neutral"
              />
            ),
            submitted: dayMonth(row.submittedAt, locale, zone),
            verified: row.reviewedAt === undefined ? '' : dayMonth(row.reviewedAt, locale, zone),
          },
        }))}
        {...(selected === null ? {} : { selectedKey: selected })}
        onSelect={setSelected}
        footer={{
          summary: t('admin.credentials.pagerSummary', {
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
    );

  return (
    <Page
      title={t('admin.credentials.title')}
      subtitle={
        verifiedTab
          ? t('admin.credentials.correctLede')
          : count === undefined
            ? undefined
            : count === 0
              ? t('admin.credentials.ledeEmpty')
              : t('admin.credentials.lede', { count })
      }
    >
      <Toolbar
        search={{
          value: typed,
          onChangeText: setTyped,
          placeholder: t('admin.credentials.search.placeholder'),
        }}
      >
        <CategoryTabs
          accessibilityLabel={t('admin.common.a11y.status')}
          value={tab}
          onChange={(value) => choose(value as CredentialsTab)}
          tabs={TABS.map(({ value, label }) => ({
            value,
            label: t(label),
            ...(value === 'pending' && count !== undefined ? { count } : {}),
          }))}
        />
      </Toolbar>
      <Split
        detailLabel={t(
          verifiedTab
            ? 'admin.credentials.a11y.verifiedAndDocument'
            : 'admin.credentials.a11y.queueAndDocument',
        )}
        list={
          selected === null ? (
            <section className="panel">
              <div className="panel__body">
                <p className="text-callout tone-muted">{t('admin.common.panel.nothingSelected')}</p>
              </div>
            </section>
          ) : (
            <CredentialPanel credentialId={selected} />
          )
        }
        detail={
          <div className="stack gap-4">
            {table}
            {selected === null ? null : <SelectedDocument credentialId={selected} />}
          </div>
        }
      />
    </Page>
  );
}

/** The selected credential's file beside the panel, once its credential is read. */
function SelectedDocument({ credentialId }: { readonly credentialId: string }) {
  const detail = useCredential(credentialId).data;
  return detail === undefined ? null : (
    <CredentialDocument key={detail.documentId} detail={detail} />
  );
}

/** The file one page at a time, opened full in the viewer over the same link (one view). */
function CredentialDocument({ detail }: { readonly detail: CredentialDetail }) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const link = useDocumentLink(detail.documentId);
  const pdf = usePdf(link.data?.url);
  const [full, setFull] = useState(false);
  const title = t('admin.credentials.panel.title', {
    subject: locale === 'ar' ? detail.subject.nameAr : detail.subject.nameEn,
    teacher: detail.teacher.displayName,
  });
  if (link.isError || pdf.failed) {
    return (
      <div className="stack gap-3">
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t('admin.dialogs.documentViewer.loadError')}
        </Banner>
        <div className="self-start">
          <Button
            label={t('admin.common.action.retry')}
            variant="secondary"
            onPress={() => void link.refetch()}
          />
        </div>
      </div>
    );
  }
  if (pdf.file === undefined) return <Skeleton shape="block" />;
  return (
    <>
      <DocumentPages
        key={link.data?.url}
        file={pdf.file}
        name={title}
        inline
        accessory={
          <IconButton
            icon={{ name: 'external-link' }}
            variant="muted"
            accessibilityLabel={t('admin.credentials.a11y.openFull')}
            onPress={() => setFull(true)}
          />
        }
      />
      {full ? (
        <AdminDocumentViewer
          context="credential"
          documentId={detail.documentId}
          title={title}
          subtitle={t('admin.dialogs.documentViewer.subtitleCredential', {
            teacher: detail.teacher.displayName,
          })}
          facts={[
            {
              label: t('admin.dialogs.documentViewer.uploaded'),
              value: dayMonthYear(detail.submittedAt, locale, zone),
            },
          ]}
          onClose={() => setFull(false)}
        />
      ) : null}
    </>
  );
}
