// T073 (FR-173, FR-174): the administrators (`AdminAdmins`, screens.md). Two tabs, active and
// disabled; the search by name or email, sent once the typing stops; the table (the administrator
// with «أنت» on one's own row and the address, the second factor, the last sign-in, when added) with
// the pager the page size answers, by name as the server orders it (B14d: the board's «حسب آخر
// دخول» says what the server does not). A row opens its detail beside the table, read from the row
// (there is no `admins.get`): who added it and when, the second factor and the codes left, the last
// sign-in. Another's active account offers the second-factor reset and the disabling; one's own says
// another administrator does those and offers new recovery codes; a disabled account offers nothing.
// The board's audit count and support request have no data in this phase and are not drawn.
import { useState } from 'react';

import {
  Avatar,
  Badge,
  Banner,
  Button,
  CategoryTabs,
  DataTable,
  EmptyState,
  KeyValue,
  Page,
  Panel,
  Skeleton,
  Split,
  Toolbar,
} from '../../../design/components';
import { useLocale, useT } from '../../../i18n';
import { dayMonth, dayMonthYear, timeOfDay } from '../../../lib/format';
import { panelTimeZone } from '../../../lib/zone';
import { useSettled } from '../../applications/queries';
import { initialsOf } from '../../applications/initials';
import {
  AddAdminDialog,
  DisableAdminDialog,
  MfaResetDialog,
  RecoveryCodesDialog,
} from './AdminDialogs';
import { type AdminRow, type AdminsTab, useAdminsPage } from './queries';

type Open = 'add' | 'reset' | 'disable' | 'codes';

export function AdminAdmins() {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const [tab, setTab] = useState<AdminsTab>('active');
  const [typed, setTyped] = useState('');
  const search = useSettled(typed);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const list = useAdminsPage(tab, search, page);

  const [searched, setSearched] = useState(search);
  if (searched !== search) {
    setSearched(search);
    setPage(1);
  }
  const choose = (next: AdminsTab) => {
    setTab(next);
    setPage(1);
    setSelected(null);
  };

  const listed = list.data;
  const chosen = listed?.rows.find(({ adminId }) => adminId === selected);
  const moment = (value: string) =>
    `${dayMonth(value, locale, zone)} · ${timeOfDay(value, locale, zone)}`;

  const table =
    listed === undefined ? (
      list.isError ? (
        <div className="stack gap-4">
          <Banner icon={{ name: 'alert-circle' }} tone="danger">
            <span className="stack gap-1">
              <strong>
                {t('admin.common.loadError.title', { page: t('admin.admins.title') })}
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
        icon={{ name: 'users' }}
        title={t(
          tab === 'active'
            ? 'admin.admins.empty.active.title'
            : 'admin.admins.empty.disabled.title',
        )}
        text={t(
          tab === 'active' ? 'admin.admins.empty.active.text' : 'admin.admins.empty.disabled.text',
        )}
      />
    ) : (
      <DataTable
        columns={[
          { key: 'admin', header: t('admin.admins.columns.admin') },
          { key: 'mfa', header: t('admin.admins.columns.mfa') },
          { key: 'lastSignIn', header: t('admin.admins.columns.lastSignIn') },
          { key: 'added', header: t('admin.admins.columns.added') },
        ]}
        rows={listed.rows.map((row) => ({
          key: row.adminId,
          cells: {
            admin: (
              <span className="stack">
                <span className="text-medium">
                  <bdi>{row.displayName}</bdi>
                  {row.self ? (
                    <span className="tone-muted"> {`· ${t('admin.admins.you')}`}</span>
                  ) : null}
                </span>
                <span className="text-caption tone-muted ltr">{row.email}</span>
              </span>
            ),
            mfa: (
              <Badge
                label={t(
                  row.mfaEnrolled ? 'admin.admins.mfa.enabled' : 'admin.admins.mfa.notSetUp',
                )}
                tone={row.mfaEnrolled ? 'success' : 'warning'}
              />
            ),
            lastSignIn:
              row.lastSignInAt === undefined
                ? t('admin.admins.detail.neverSignedIn')
                : moment(row.lastSignInAt),
            added: row.invitedAt === undefined ? '' : dayMonthYear(row.invitedAt, locale, zone),
          },
        }))}
        {...(selected === null ? {} : { selectedKey: selected })}
        onSelect={setSelected}
        footer={{
          summary: t('admin.admins.pagerSummary', {
            shown: listed.rows.length,
            total: listed.total,
          }),
          pager: { page, pageCount: Math.ceil(listed.total / listed.pageSize), onChange: setPage },
        }}
      />
    );

  return (
    <Page
      title={t('admin.admins.title')}
      subtitle={t('admin.admins.lede')}
      actions={
        <Button
          label={t('admin.admins.add')}
          icon={{ name: 'plus' }}
          onPress={() => setOpen('add')}
        />
      }
    >
      <Toolbar
        search={{
          value: typed,
          onChangeText: setTyped,
          placeholder: t('admin.admins.search.placeholder'),
        }}
      >
        <CategoryTabs
          accessibilityLabel={t('admin.common.a11y.status')}
          value={tab}
          onChange={(value) => choose(value as AdminsTab)}
          tabs={[
            { value: 'active', label: t('admin.admins.tabs.active') },
            { value: 'disabled', label: t('admin.admins.tabs.disabled') },
          ]}
        />
      </Toolbar>
      <Split
        detailLabel={t('admin.admins.a11y.detail')}
        list={table}
        {...(chosen === undefined
          ? {}
          : { detail: <AdminDetail admin={chosen} onOpen={setOpen} /> })}
      />
      {open === 'add' ? <AddAdminDialog onClose={() => setOpen(null)} /> : null}
      {open === 'reset' && chosen !== undefined ? (
        <MfaResetDialog admin={chosen} onClose={() => setOpen(null)} />
      ) : null}
      {open === 'disable' && chosen !== undefined ? (
        <DisableAdminDialog admin={chosen} onClose={() => setOpen(null)} />
      ) : null}
      {open === 'codes' ? <RecoveryCodesDialog onClose={() => setOpen(null)} /> : null}
    </Page>
  );
}

function AdminDetail({
  admin,
  onOpen,
}: {
  readonly admin: AdminRow;
  readonly onOpen: (open: Open) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const disabled = admin.disabledAt !== undefined;
  const added =
    admin.invitedAt === undefined
      ? null
      : admin.invitedByName === undefined
        ? dayMonthYear(admin.invitedAt, locale, zone)
        : t('admin.admins.detail.added', {
            date: dayMonthYear(admin.invitedAt, locale, zone),
            admin: admin.invitedByName,
          });
  return (
    <Panel
      header={
        <>
          <Avatar initials={initialsOf(admin.displayName)} size="lg" />
          <span className="stack grow">
            <strong className="text-title-3">
              <bdi>{admin.displayName}</bdi>
            </strong>
            <span className="text-caption tone-muted ltr">{admin.email}</span>
          </span>
          <Badge
            label={t(disabled ? 'admin.status.account.disabled' : 'admin.status.account.active')}
            tone={disabled ? 'neutral' : 'success'}
          />
        </>
      }
      actions={
        disabled ? undefined : admin.self ? (
          admin.mfaEnrolled ? (
            <Button
              label={t('admin.admins.recovery.action')}
              variant="secondary"
              icon={{ name: 'key-round' }}
              onPress={() => onOpen('codes')}
            />
          ) : undefined
        ) : (
          <>
            <Button
              label={t('admin.admins.detail.resetMfa')}
              variant="secondary"
              icon={{ name: 'key-round' }}
              onPress={() => onOpen('reset')}
            />
            <Button
              label={t('admin.admins.detail.disable')}
              variant="danger"
              onPress={() => onOpen('disable')}
            />
          </>
        )
      }
      {...(disabled || admin.self ? {} : { note: t('admin.admins.detail.footer') })}
    >
      <KeyValue
        items={[
          ...(added === null ? [] : [{ label: t('admin.admins.columns.added'), value: added }]),
          {
            label: t('admin.admins.columns.mfa'),
            value: admin.mfaEnrolled
              ? t('admin.admins.detail.mfaEnabled', { count: admin.recoveryCodesLeft })
              : t('admin.admins.mfa.notSetUp'),
          },
          {
            label: t('admin.admins.columns.lastSignIn'),
            value:
              admin.lastSignInAt === undefined
                ? t('admin.admins.detail.neverSignedIn')
                : `${dayMonthYear(admin.lastSignInAt, locale, zone)} · ${timeOfDay(admin.lastSignInAt, locale, zone)}`,
          },
        ]}
      />
      {admin.self && !disabled ? (
        <Banner icon={{ name: 'info' }} tone="info">
          {t('admin.admins.detail.selfNote')}
        </Banner>
      ) : null}
    </Panel>
  );
}
