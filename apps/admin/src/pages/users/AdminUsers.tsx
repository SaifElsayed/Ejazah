// B42, T058 (FR-481, FR-426; SRS FR-ADMIN-4; contracts/admin-surface.md "`users`"): `/users`, the
// user directory. Every user, deleted ones included, newest first as the server answers it, in keyset
// pages; the search is the start of a display name, sent once the typing stops (`users.list` folds
// it, R-203). Each row: the name, or FR-426's stand-in for a deleted user (by its role, the account's
// when it has none), the role and the account status. A row opens the user's record beside the list
// at `?user=` (`UserPanel`), the link the other pages use. None of the board's filters, email search
// or order by activity is built (the note under T058, Q2). A failed read says the page's generic
// words, or when to try again when the server refused it `RATE_LIMITED` (`errorMessageKey`).
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
  Toolbar,
} from '../../design/components';
import { useT } from '../../i18n';
import { errorMessageKey } from '../../lib/error-message';
import { useSettled } from '../applications/queries';
import { type UsersFilter, useUsersPage } from './queries';
import { UserName } from './UserName';
import { UserPanel } from './UserPanel';
import { ACCOUNT_STATUS, roleLabel } from './words';

export function AdminUsers() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const selected = params.get('user');
  const [typed, setTyped] = useState('');
  const name = useSettled(typed);
  // The cursor of each page read so far: the first page has none.
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  const [page, setPage] = useState(1);
  const filter: UsersFilter = name === '' ? {} : { name };
  const list = useUsersPage(filter, cursors[page - 1]);

  // A new search starts at the first page, once it settles: a keystroke reads nothing.
  const filters = JSON.stringify(filter);
  const [shownFor, setShownFor] = useState(filters);
  if (shownFor !== filters) {
    setShownFor(filters);
    setCursors([undefined]);
    setPage(1);
  }

  const listed = list.data;
  const next = listed?.nextCursor;
  const pageCount = page === cursors.length && next !== undefined ? page + 1 : cursors.length;
  const go = (target: number) => {
    if (target === cursors.length + 1 && next !== undefined) setCursors([...cursors, next]);
    setPage(target);
  };
  const failure = errorMessageKey(list.error, 'admin.common.loadError.text');

  const table =
    listed === undefined ? (
      list.isError ? (
        <div className="stack gap-4">
          <Banner icon={{ name: 'alert-circle' }} tone="danger">
            <span className="stack gap-1">
              <strong>{t('admin.common.loadError.title', { page: t('admin.users.title') })}</strong>
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
      ) : (
        <Skeleton shape="block" />
      )
    ) : listed.items.length === 0 ? (
      name === '' && page === 1 ? (
        <EmptyState
          icon={{ name: 'users' }}
          title={t('admin.users.directory.emptyAll.title')}
          text={t('admin.users.directory.emptyAll.text')}
        />
      ) : (
        <EmptyState
          icon={{ name: 'search' }}
          title={t('admin.users.searchEmpty.title')}
          text={t('admin.users.directory.searchEmptyText')}
        />
      )
    ) : (
      <DataTable
        columns={[
          { key: 'user', header: t('admin.users.columns.user') },
          { key: 'role', header: t('admin.users.columns.role') },
          { key: 'status', header: t('admin.users.columns.status'), end: true },
        ]}
        rows={listed.items.map((row) => ({
          key: row.userId,
          cells: {
            user: <UserName user={row} role={row.role} />,
            role: t(roleLabel(row.role)),
            status: (
              <Badge
                label={t(ACCOUNT_STATUS[row.accountStatus].label)}
                tone={ACCOUNT_STATUS[row.accountStatus].tone}
              />
            ),
          },
        }))}
        {...(selected === null ? {} : { selectedKey: selected })}
        onSelect={(userId) => setParams({ user: userId })}
        footer={{
          summary: t('admin.users.directory.pagerPage', { page }),
          pager: { page, pageCount, onChange: go },
        }}
      />
    );

  return (
    <Page title={t('admin.users.title')} subtitle={t('admin.users.directory.lede')}>
      <Toolbar
        search={{
          value: typed,
          onChangeText: setTyped,
          placeholder: t('admin.users.directory.searchPlaceholder'),
        }}
      />
      <Split
        detailLabel={t('admin.users.detail.a11y')}
        list={table}
        {...(selected === null
          ? {}
          : { detail: <UserPanel key={selected} targetUserId={selected} /> })}
      />
    </Page>
  );
}
