// T037: AdminNav, the sidebar of every console page (screens.md, `AdminNav`), with the entries of
// this phase only (FR-176): a navigation entry whose page lands in a later phase is not rendered
// until that phase adds it here. The groups and the order are the board's; the settings entry leads
// to `/settings/admins`, the one settings page this phase builds (FR-174).
//
// The signed-in administrator's name (`auth.me`) and the two queues' open counts (`home.summary`,
// the cache key the pages share) are read here (T073): the applications in review, the credentials
// waiting.
import { useLocation, useNavigate } from 'react-router';

import { Sidebar } from '../../design/components';
import type { IconName } from '../../design/icons';
import { type MessageKey, useT } from '../../i18n';
import { useAdmin } from '../../lib/admin-context';
import { useHomeSummary, useMe } from '../home/queries';

interface NavEntry {
  readonly path: string;
  readonly label: MessageKey;
  readonly icon: IconName;
  /** The queue whose open count the entry shows. */
  readonly queue?: 'applications' | 'credentials';
}

/** The entries of this phase, in the board's groups and order. */
export const NAV_GROUPS: readonly {
  readonly label: MessageKey;
  readonly entries: readonly NavEntry[];
}[] = [
  {
    label: 'admin.nav.groups.queues',
    entries: [
      { path: '/', label: 'admin.nav.items.home', icon: 'house' },
      {
        path: '/applications',
        label: 'admin.nav.items.applications',
        icon: 'user-check',
        queue: 'applications',
      },
      {
        path: '/credentials',
        label: 'admin.nav.items.credentials',
        icon: 'file-text',
        queue: 'credentials',
      },
      // B42 (the notes under T048, T049 and T050, Q4): Phase 3's three queues.
      { path: '/review', label: 'admin.nav.items.sessionReview', icon: 'activity' },
      { path: '/disputes', label: 'admin.nav.items.disputes', icon: 'flag' },
      { path: '/cases', label: 'admin.nav.items.cases', icon: 'scale' },
    ],
  },
  {
    label: 'admin.nav.groups.records',
    entries: [
      // B42 (the note under T047, Q4): the enrollment and session monitor.
      { path: '/sessions', label: 'admin.nav.items.enrollments', icon: 'calendar' },
      // T053: the payments monitor, before the settings as the board orders the group.
      { path: '/payments', label: 'admin.nav.items.payments', icon: 'credit-card' },
      // B42 (the note under T048, Q4): the video outages.
      { path: '/outages', label: 'admin.nav.items.outages', icon: 'video-off' },
      { path: '/settings/admins', label: 'admin.nav.items.settings', icon: 'sliders-horizontal' },
      { path: '/audit', label: 'admin.nav.items.audit', icon: 'list' },
    ],
  },
];

/** True when `pathname` is `path`'s page or one below it; home only on its own path. */
function isCurrent(path: string, pathname: string): boolean {
  if (path === '/') return pathname === '/';
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function AdminNav() {
  const t = useT();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { client } = useAdmin();
  const me = useMe().data;
  const queues = useHomeSummary().data?.queues;
  return (
    <Sidebar
      {...(me === undefined
        ? {}
        : { admin: { name: me.displayName, caption: t('admin.common.role.admin') } })}
      groups={NAV_GROUPS.map((group) => ({
        label: t(group.label),
        items: group.entries.map((entry) => ({
          href: entry.path,
          label: t(entry.label),
          icon: entry.icon,
          active: isCurrent(entry.path, pathname),
          // An empty queue shows no count, as the board draws it (B14d-1 review).
          ...(entry.queue === undefined || queues === undefined || queues[entry.queue].open === 0
            ? {}
            : { count: queues[entry.queue].open }),
        })),
      }))}
      onNavigate={(href) => {
        void navigate(href);
      }}
      onSignOut={() => {
        void client.signOut();
      }}
    />
  );
}
