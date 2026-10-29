// T036: the pieces only a desktop needs (docs/design/components.md, "The admin panel"; design
// `.console`, `.sidebar`, `.nav-item`, `.page`, `.toolbar`, `.search-row`, `.split`, `.panel`, `.kv`,
// `.doc-thumb`, `.queue-card`, `.pager`, `.auth-card`). Console is the frame: its `dir` and `lang`
// follow the language (T035), its density is the compact one, its scheme the system's; a dialog
// opens inside it so the console's classes and direction reach the dialog too. T111: it is the live
// console (`.console--live`), which fills the window and scrolls; the boards' `.console` stays the
// fixed frame.
import clsx from 'clsx';
import {
  createContext,
  Fragment,
  type MouseEvent,
  useContext,
  useState,
  useSyncExternalStore,
} from 'react';

import { directionOf, type Locale, setLocale, useLocale, useT } from '../../i18n';
import { UserText } from '../../i18n/UserText';
import type { IconName } from '../icons';
import { IconButton, isModifiedClick } from './Button';
import { Avatar, IconTile } from './Containers';
import { Icon } from './Icon';
import { Segmented } from './Selection';
import { Badge, type BadgeProps } from './Status';
import type { Content, Press } from './types';

/** The frame a dialog opens in; null outside a Console (the dialog then opens in the body). */
export const ConsoleFrameContext = createContext<HTMLElement | null>(null);

/** The frame of the nearest Console. */
export function useConsoleFrame(): HTMLElement | null {
  return useContext(ConsoleFrameContext);
}

const DARK = '(prefers-color-scheme: dark)';

function subscribeToScheme(listener: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(DARK);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

function systemScheme(): 'light' | 'dark' {
  if (typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia(DARK).matches ? 'dark' : 'light';
}

/** The system's colour scheme, re-rendering when it changes. */
function useColorScheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribeToScheme, systemScheme, () => 'light');
}

export interface ConsoleProps {
  readonly children: Content;
}

export function Console({ children }: ConsoleProps) {
  const locale = useLocale();
  const scheme = useColorScheme();
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  return (
    <div
      ref={setFrame}
      className="console console--live"
      dir={directionOf(locale)}
      lang={locale}
      data-density="compact"
      data-theme={scheme}
    >
      <ConsoleFrameContext.Provider value={frame}>{children}</ConsoleFrameContext.Provider>
    </div>
  );
}

/** The brand mark and name (the sign-in card, and the setup page's header, T070). */
export function Brand() {
  const t = useT();
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        {t('admin.nav.brandMark')}
      </span>
      <span className="brand__name">{t('admin.nav.brand')}</span>
    </span>
  );
}

/** A link the router takes on a plain click and the browser on a modified one (a new tab). */
function routerClick(href: string, onNavigate: ((href: string) => void) | undefined) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (onNavigate === undefined || isModifiedClick(event)) return;
    event.preventDefault();
    onNavigate(href);
  };
}

export interface NavItemProps {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
  /** The open count of a queue. */
  readonly count?: number;
  readonly active?: boolean;
  readonly onNavigate?: ((href: string) => void) | undefined;
}

export function NavItem({ href, label, icon, count, active = false, onNavigate }: NavItemProps) {
  return (
    <a
      href={href}
      className={clsx('nav-item', active && 'nav-item--active')}
      aria-current={active ? 'page' : undefined}
      onClick={routerClick(href, onNavigate)}
    >
      <Icon name={icon} />
      <span>{label}</span>
      {count === undefined ? null : (
        <span
          className={clsx('badge', active ? 'badge--success' : 'badge--neutral', 'nav-item__count')}
        >
          {count}
        </span>
      )}
    </a>
  );
}

export interface SidebarProps {
  readonly groups: readonly {
    readonly label?: string;
    readonly items: readonly Omit<NavItemProps, 'onNavigate'>[];
  }[];
  /** The signed-in administrator; their name is shown as they typed it. */
  readonly admin?: { readonly name: string; readonly caption?: string };
  readonly onSignOut: Press;
  readonly onNavigate?: (href: string) => void;
}

export function Sidebar({ groups, admin, onSignOut, onNavigate }: SidebarProps) {
  const t = useT();
  const locale = useLocale();
  return (
    <aside className="sidebar" aria-label={t('admin.nav.a11y.panel')}>
      <Brand />
      <nav className="sidebar__nav">
        {groups.map((group, index) => (
          <Fragment key={group.label ?? index}>
            {group.label === undefined ? null : (
              <span className="sidebar__group">{group.label}</span>
            )}
            {group.items.map((item) => (
              <NavItem key={item.href} {...item} onNavigate={onNavigate} />
            ))}
          </Fragment>
        ))}
      </nav>
      <div className="sidebar__footer">
        <div className="row gap-3">
          {admin === undefined ? null : (
            <>
              <Avatar initials={[...admin.name.trim()][0] ?? ''} size="sm" />
              <span className="stack grow">
                <span className="text-callout text-medium">
                  <UserText>{admin.name}</UserText>
                </span>
                {admin.caption === undefined ? null : (
                  <span className="text-caption tone-muted">{admin.caption}</span>
                )}
              </span>
            </>
          )}
          <IconButton
            icon={{ name: 'log-out' }}
            variant="muted"
            accessibilityLabel={t('admin.nav.a11y.signOut')}
            onPress={onSignOut}
          />
        </div>
        <LanguageSwitch locale={locale} />
      </div>
    </aside>
  );
}

/** The language, switched in place: no reload, no sign-out (FR-175). */
export function LanguageSwitch({
  locale,
  inline = false,
}: {
  readonly locale: Locale;
  readonly inline?: boolean;
}) {
  const t = useT();
  return (
    <Segmented
      accessibilityLabel={t('admin.nav.a11y.language')}
      inline={inline}
      value={locale}
      options={[
        { value: 'ar', label: t('admin.common.language.ar') },
        { value: 'en', label: t('admin.common.language.en') },
      ]}
      onChange={(value) => setLocale(value === 'en' ? 'en' : 'ar')}
    />
  );
}

export interface PageHeaderProps {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly actions?: Content;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="stack">
        <h1 className="page-header__title">{title}</h1>
        {subtitle === undefined ? null : <p className="page-header__subtitle">{subtitle}</p>}
      </div>
      {actions === undefined ? null : <div className="row gap-2">{actions}</div>}
    </header>
  );
}

export interface PageProps extends PageHeaderProps {
  readonly children: Content;
}

/** The main column: the header, then the body. */
export function Page({ title, subtitle, actions, children }: PageProps) {
  return (
    <main className="page">
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      <div className="page-body">{children}</div>
    </main>
  );
}

export interface SearchRowProps {
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder: string;
  readonly filters?: { readonly count: number; readonly onPress: Press };
}

function SearchField({
  value,
  onChangeText,
  placeholder,
  filters,
  wide,
}: SearchRowProps & { readonly wide: boolean }) {
  const t = useT();
  const active = filters !== undefined && filters.count > 0;
  return (
    <div className="search-row">
      <label className={clsx('input-group', 'input-group--surface', wide && 'toolbar__search')}>
        <Icon name="search" size="sm" />
        <span className="visually-hidden">{t('admin.common.action.search')}</span>
        <input
          className="input-group__control"
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChangeText(event.target.value)}
        />
      </label>
      {filters === undefined ? null : (
        <button
          type="button"
          className={clsx(
            'icon-btn',
            'icon-btn--surface',
            'filter-trigger',
            active && 'filter-trigger--active',
          )}
          aria-label={
            active
              ? t('admin.common.a11y.filtersActive', { count: filters.count })
              : t('admin.common.a11y.filters')
          }
          onClick={filters.onPress}
        >
          <Icon name="filter" />
          {active ? <span className="filter-trigger__count">{filters.count}</span> : null}
        </button>
      )}
    </div>
  );
}

/** A search field with the filter trigger and its active count. */
export function SearchRow(props: SearchRowProps) {
  return <SearchField {...props} wide={false} />;
}

export interface ToolbarProps {
  /** The page's search, `layout.panel` wide. */
  readonly search?: SearchRowProps;
  /** The filters: tabs, chips. */
  readonly children?: Content;
}

export function Toolbar({ search, children }: ToolbarProps) {
  return (
    <div className="toolbar">
      {children}
      {search === undefined ? null : <SearchField {...search} wide />}
    </div>
  );
}

export interface SplitProps {
  readonly list: Content;
  /** The selected record's panel; nothing when no record is selected. */
  readonly detail?: Content;
  readonly detailLabel: string;
}

/** A list and the selected item's detail, the detail sliding in from the start. */
export function Split({ list, detail, detailLabel }: SplitProps) {
  return (
    <div className="split">
      <div className="split__list">{list}</div>
      {detail === undefined ? null : (
        <aside className="split__detail" aria-label={detailLabel}>
          {detail}
        </aside>
      )}
    </div>
  );
}

export interface PanelProps {
  readonly header: Content;
  readonly children: Content;
  /** The actions of the footer. */
  readonly actions?: Content;
  /** What the actions do, under them. */
  readonly note?: string;
}

/** The detail of one record: header, body, the actions at the bottom. */
export function Panel({ header, children, actions, note }: PanelProps) {
  return (
    <section className="panel">
      <header className="panel__header">{header}</header>
      <div className="panel__body">{children}</div>
      {actions === undefined && note === undefined ? null : (
        <footer className="panel__footer">
          {actions}
          {note === undefined ? null : <p className="panel__note">{note}</p>}
        </footer>
      )}
    </section>
  );
}

export interface KeyValueProps {
  readonly items: readonly { readonly label: string; readonly value: Content }[];
  readonly columns?: 2 | 3;
}

/** Label over value, in a grid. */
export function KeyValue({ items, columns = 2 }: KeyValueProps) {
  return (
    <dl className={clsx('kv', columns === 3 && 'kv--3')}>
      {items.map((item) => (
        <div key={item.label} className="kv__item">
          <dt className="kv__label">{item.label}</dt>
          <dd className="kv__value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface DocThumbProps {
  readonly label: string;
  readonly badge?: BadgeProps;
  /** The page's drawing: a file by default, a person for an identity document (T071). */
  readonly icon?: IconName;
  /** Opens the document viewer: view only. Without it the thumbnail is shown and opens nothing. */
  readonly onPress?: Press;
}

export function DocThumb({ label, badge, icon = 'file-text', onPress }: DocThumbProps) {
  const content = (
    <>
      <span className="doc-thumb__page">
        <Icon name={icon} size="lg" />
      </span>
      <span>{label}</span>
      {badge === undefined ? null : <Badge {...badge} />}
    </>
  );
  return onPress === undefined ? (
    <span className="doc-thumb">{content}</span>
  ) : (
    <button type="button" className="doc-thumb" onClick={onPress}>
      {content}
    </button>
  );
}

export interface QueueCardProps {
  readonly href: string;
  readonly icon: IconName;
  readonly title: string;
  /** How many items wait, in the display size and the Latin face. */
  readonly count: number;
  readonly hint?: string;
  readonly onNavigate?: (href: string) => void;
}

export function QueueCard({ href, icon, title, count, hint, onNavigate }: QueueCardProps) {
  return (
    <a href={href} className="queue-card" onClick={routerClick(href, onNavigate)}>
      <span className="row gap-3">
        <IconTile icon={{ name: icon }} />
        <span className="text-headline grow">{title}</span>
        <span className="queue-card__count">{count}</span>
      </span>
      {hint === undefined ? null : <span className="text-caption tone-muted">{hint}</span>}
    </a>
  );
}

export interface PagerProps {
  /** The current page, from 1. */
  readonly page: number;
  readonly pageCount: number;
  readonly onChange: (page: number) => void;
  /** What the pages are of: a document's pages (B14b-2); a list's when absent. */
  readonly accessibilityLabel?: string;
}

/** The pages shown: the first, the last and the ones beside the current, `null` for a gap. */
function visiblePages(page: number, pageCount: number): (number | null)[] {
  const shown = [...new Set([1, page - 1, page, page + 1, pageCount])]
    .filter((candidate) => candidate >= 1 && candidate <= pageCount)
    .sort((a, b) => a - b);
  return shown.flatMap((candidate, index) => {
    const before = shown[index - 1];
    return before !== undefined && candidate - before > 1 ? [null, candidate] : [candidate];
  });
}

/** Pages with previous and next; nothing for a single page. */
export function Pager({ page, pageCount, onChange, accessibilityLabel }: PagerProps) {
  const t = useT();
  if (pageCount <= 1) return null;
  const go = (target: number) => {
    if (target !== page && target >= 1 && target <= pageCount) onChange(target);
  };
  return (
    <nav className="pager" aria-label={accessibilityLabel ?? t('admin.common.a11y.pages')}>
      <button
        type="button"
        className="pager__page"
        aria-label={t('admin.common.a11y.previousPage')}
        disabled={page <= 1}
        onClick={() => go(page - 1)}
      >
        <Icon name="chevron-left" size="sm" />
      </button>
      {visiblePages(page, pageCount).map((candidate, index) =>
        candidate === null ? (
          <span key={`gap-${index}`} className="pager__page" aria-hidden="true">
            {t('admin.common.pager.ellipsis')}
          </span>
        ) : (
          <button
            key={candidate}
            type="button"
            className={clsx('pager__page', candidate === page && 'pager__page--current')}
            aria-current={candidate === page ? 'page' : undefined}
            onClick={() => go(candidate)}
          >
            {candidate}
          </button>
        ),
      )}
      <button
        type="button"
        className="pager__page"
        aria-label={t('admin.common.a11y.nextPage')}
        disabled={page >= pageCount}
        onClick={() => go(page + 1)}
      >
        <Icon name="chevron-right" size="sm" />
      </button>
    </nav>
  );
}

export interface AuthCardProps {
  readonly title: string;
  readonly lede?: string;
  readonly children: Content;
}

/** The sign-in and second-factor card, `layout.dialog` wide, centred. */
export function AuthCard({ title, lede, children }: AuthCardProps) {
  const id = `auth-card-title`;
  return (
    <section className="auth-card" aria-labelledby={id}>
      <Brand />
      <div className="page-intro">
        <h1 id={id} className="page-intro__title">
          {title}
        </h1>
        {lede === undefined ? null : <p className="page-intro__lede">{lede}</p>}
      </div>
      {children}
    </section>
  );
}
