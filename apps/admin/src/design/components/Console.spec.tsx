// T036: the console pieces only a desktop needs (docs/design/components.md, "The admin panel"):
// Console, Sidebar and NavItem, Page with PageHeader and Toolbar, SearchRow, Split, Panel, KeyValue,
// DocThumb, QueueCard, Pager and AuthCard. T071: a DocThumb with its icon, shown before it opens.
import { act, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getLocale, setLocale, translate } from '../../i18n';
import { clickTaken, inBothDirections } from './__tests__/harness';
import {
  AuthCard,
  Console,
  DocThumb,
  KeyValue,
  NavItem,
  Page,
  Pager,
  Panel,
  QueueCard,
  SearchRow,
  Sidebar,
  Split,
  Toolbar,
} from './index';

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale('ar');
});

describe('Console', () => {
  it('is the frame in the language’s direction, at the compact density', () => {
    inBothDirections(
      () => <p>page</p>,
      ({ frame, locale, dir }) => {
        expect(frame.getAttribute('dir')).toBe(dir);
        expect(frame.getAttribute('lang')).toBe(locale);
        expect(frame.dataset['density']).toBe('compact');
        expect(frame.dataset['theme']).toBe('light');
      },
    );
  });

  it('follows the system’s dark scheme', () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query === '(prefers-color-scheme: dark)',
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    const view = render(<Console>page</Console>);
    expect(view.container.querySelector('.console')?.getAttribute('data-theme')).toBe('dark');
  });

  it('turns with the language, with no reload', () => {
    const view = render(<Console>page</Console>);
    const frame = view.container.querySelector('.console');
    expect(frame?.getAttribute('dir')).toBe('rtl');
    act(() => setLocale('en'));
    expect(frame?.getAttribute('dir')).toBe('ltr');
  });
});

describe('NavItem', () => {
  it('is a link to its page, marked current when active, with its open count', () => {
    inBothDirections(
      () => (
        <nav>
          <NavItem href="/applications" label="apps" icon="user-check" count={3} active />
          <NavItem href="/audit" label="audit" icon="list" count={0} />
        </nav>
      ),
      ({ view }) => {
        const active = view.getByRole('link', { name: /apps/ });
        expect([...active.classList]).toEqual(['nav-item', 'nav-item--active']);
        expect(active.getAttribute('aria-current')).toBe('page');
        expect(active.querySelector('.badge.badge--success.nav-item__count')?.textContent).toBe(
          '3',
        );
        const other = view.getByRole('link', { name: /audit/ });
        expect(other.getAttribute('aria-current')).toBeNull();
        expect(other.querySelector('.badge.badge--neutral.nav-item__count')?.textContent).toBe('0');
      },
    );
  });

  it('hands a plain click to the router, and leaves a modified one to the browser', () => {
    const onNavigate = vi.fn();
    inBothDirections(
      () => <NavItem href="/audit" label="audit" icon="list" onNavigate={onNavigate} />,
      ({ view }) => {
        const link = view.getByRole('link', { name: 'audit' });
        expect(clickTaken(link, { ctrlKey: true })).toBe(false);
        expect(onNavigate).not.toHaveBeenCalled();
        expect(clickTaken(link)).toBe(true);
        expect(onNavigate).toHaveBeenCalledWith('/audit');
        onNavigate.mockClear();
      },
    );
  });
});

describe('Sidebar', () => {
  it('carries the brand, the groups of entries, the signed-in admin, sign-out and the language', () => {
    const onSignOut = vi.fn();
    inBothDirections(
      () => (
        <Sidebar
          groups={[
            {
              label: 'queues',
              items: [{ href: '/', label: 'home', icon: 'house', active: true }],
            },
          ]}
          admin={{ name: 'Sara Adel' }}
          onSignOut={onSignOut}
        />
      ),
      ({ view, locale }) => {
        const aside = view.getByRole('complementary', {
          name: translate(locale, 'admin.nav.a11y.panel'),
        });
        expect(aside.classList.contains('sidebar')).toBe(true);
        expect(within(aside).getByText(translate(locale, 'admin.nav.brand'))).toBeTruthy();
        expect(within(aside).getByText('queues').classList.contains('sidebar__group')).toBe(true);
        expect(within(aside).getByRole('link', { name: 'home' })).toBeTruthy();
        // The admin's name is what a person typed: isolated for direction.
        expect(within(aside).getByText('Sara Adel').tagName).toBe('BDI');
        fireEvent.click(
          within(aside).getByRole('button', { name: translate(locale, 'admin.nav.a11y.signOut') }),
        );
        const language = within(aside).getByRole('group', {
          name: translate(locale, 'admin.nav.a11y.language'),
        });
        expect(
          within(language)
            .getByRole('button', { name: translate(locale, `admin.common.language.${locale}`) })
            .getAttribute('aria-pressed'),
        ).toBe('true');
      },
    );
    expect(onSignOut).toHaveBeenCalledTimes(2);
  });

  it('switches the language from its segmented control, without signing out', () => {
    const onSignOut = vi.fn();
    const view = render(
      <Console>
        <Sidebar groups={[]} onSignOut={onSignOut} />
      </Console>,
    );
    fireEvent.click(view.getByRole('button', { name: 'English' }));
    expect(getLocale()).toBe('en');
    expect(view.container.querySelector('.console')?.getAttribute('dir')).toBe('ltr');
    expect(onSignOut).not.toHaveBeenCalled();
  });
});

describe('Page, PageHeader and Toolbar', () => {
  it('is the main column: the header with its title, subtitle and actions, then the body', () => {
    inBothDirections(
      () => (
        <Page title="title" subtitle="subtitle" actions={<button type="button">act</button>}>
          <Toolbar search={{ value: '', onChangeText: () => undefined, placeholder: 'find' }}>
            <span>filters</span>
          </Toolbar>
        </Page>
      ),
      ({ view, frame }) => {
        const main = view.getByRole('main');
        expect(main.classList.contains('page')).toBe(true);
        const heading = view.getByRole('heading', { level: 1, name: 'title' });
        expect(heading.classList.contains('page-header__title')).toBe(true);
        expect(view.getByText('subtitle').classList.contains('page-header__subtitle')).toBe(true);
        expect(
          within(frame.querySelector('.page-header') as HTMLElement).getByRole('button', {
            name: 'act',
          }),
        ).toBeTruthy();
        const toolbar = frame.querySelector('.page-body > .toolbar');
        expect(toolbar?.querySelector('.input-group.toolbar__search')).not.toBeNull();
        expect(toolbar?.textContent).toContain('filters');
      },
    );
  });
});

describe('SearchRow', () => {
  it('is a labelled search field, with the filter trigger and its active count', () => {
    const onChangeText = vi.fn();
    const onPress = vi.fn();
    inBothDirections(
      () => (
        <SearchRow
          value=""
          onChangeText={onChangeText}
          placeholder="find"
          filters={{ count: 2, onPress }}
        />
      ),
      ({ view, locale }) => {
        const field = view.getByLabelText(translate(locale, 'admin.common.action.search'));
        expect(field.getAttribute('placeholder')).toBe('find');
        fireEvent.change(field, { target: { value: 'sara' } });
        const trigger = view.getByRole('button', {
          name: translate(locale, 'admin.common.a11y.filtersActive', { count: 2 }),
        });
        expect([...trigger.classList]).toEqual([
          'icon-btn',
          'icon-btn--surface',
          'filter-trigger',
          'filter-trigger--active',
        ]);
        expect(trigger.querySelector('.filter-trigger__count')?.textContent).toBe('2');
        fireEvent.click(trigger);
      },
    );
    expect(onChangeText.mock.calls).toEqual([['sara'], ['sara']]);
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('names the trigger plainly when no filter is active', () => {
    inBothDirections(
      () => (
        <SearchRow
          value=""
          onChangeText={() => undefined}
          placeholder="find"
          filters={{ count: 0, onPress: () => undefined }}
        />
      ),
      ({ view, locale }) => {
        const trigger = view.getByRole('button', {
          name: translate(locale, 'admin.common.a11y.filters'),
        });
        expect(trigger.classList.contains('filter-trigger--active')).toBe(false);
        expect(trigger.querySelector('.filter-trigger__count')).toBeNull();
      },
    );
  });
});

describe('Split, Panel and KeyValue', () => {
  it('is a list and the selected record’s panel: header, body, actions with a note', () => {
    inBothDirections(
      () => (
        <Split
          list={<p>rows</p>}
          detailLabel="detail"
          detail={
            <Panel
              header={<strong>name</strong>}
              actions={<button type="button">act</button>}
              note="note"
            >
              <KeyValue
                columns={3}
                items={[
                  { label: 'k1', value: 'v1' },
                  { label: 'k2', value: 'v2' },
                ]}
              />
            </Panel>
          }
        />
      ),
      ({ view, frame }) => {
        expect(frame.querySelector('.split > .split__list')?.textContent).toBe('rows');
        const detail = view.getByRole('complementary', { name: 'detail' });
        expect(detail.classList.contains('split__detail')).toBe(true);
        const panel = detail.querySelector('.panel');
        expect(panel?.querySelector('.panel__header')?.textContent).toBe('name');
        expect(panel?.querySelector('.panel__footer button')?.textContent).toBe('act');
        expect(panel?.querySelector('.panel__footer .panel__note')?.textContent).toBe('note');
        const kv = panel?.querySelector('.panel__body dl.kv.kv--3');
        expect(
          [...(kv?.querySelectorAll('.kv__item') ?? [])].map((item) => item.textContent),
        ).toEqual(['k1v1', 'k2v2']);
        expect(kv?.querySelector('dt.kv__label')?.textContent).toBe('k1');
        expect(kv?.querySelector('dd.kv__value')?.textContent).toBe('v1');
      },
    );
  });

  it('draws no detail when nothing is selected, and no footer without actions', () => {
    inBothDirections(
      () => (
        <>
          <Split list={<p>rows</p>} detailLabel="detail" />
          <Panel header="h">body</Panel>
        </>
      ),
      ({ frame }) => {
        expect(frame.querySelector('.split__detail')).toBeNull();
        expect(frame.querySelector('.panel__footer')).toBeNull();
      },
    );
  });
});

describe('DocThumb and QueueCard', () => {
  it('opens a document from its thumbnail, with its state', () => {
    const onPress = vi.fn();
    inBothDirections(
      () => (
        <DocThumb label="id card" badge={{ label: 'pending', tone: 'warning' }} onPress={onPress} />
      ),
      ({ view }) => {
        const thumb = view.getByRole('button', { name: /id card/ });
        expect(thumb.classList.contains('doc-thumb')).toBe(true);
        expect(thumb.querySelector('.doc-thumb__page svg.icon')).not.toBeNull();
        expect(thumb.querySelector('.badge.badge--warning')?.textContent).toBe('pending');
        fireEvent.click(thumb);
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('shows a document it cannot open yet as no button, with the icon asked (T071)', () => {
    inBothDirections(
      () => <DocThumb label="id card" icon="user" />,
      ({ view }) => {
        expect(view.queryByRole('button')).toBeNull();
        const thumb = view.getByText('id card').parentElement;
        expect(thumb?.classList.contains('doc-thumb')).toBe(true);
        expect(thumb?.querySelector('.lucide-user')).not.toBeNull();
      },
    );
  });

  it('links a queue to its page with how many items wait, in the Latin face', () => {
    const onNavigate = vi.fn();
    inBothDirections(
      () => (
        <QueueCard
          href="/applications"
          icon="user-check"
          title="applications"
          count={3}
          hint="hint"
          onNavigate={onNavigate}
        />
      ),
      ({ view }) => {
        const card = view.getByRole('link', { name: /applications/ });
        expect(card.classList.contains('queue-card')).toBe(true);
        expect(card.getAttribute('href')).toBe('/applications');
        expect(card.querySelector('.queue-card__count')?.textContent).toBe('3');
        expect(card.textContent).toContain('hint');
        fireEvent.click(card);
      },
    );
    expect(onNavigate.mock.calls).toEqual([['/applications'], ['/applications']]);
  });
});

describe('Pager', () => {
  it('moves a page back and forth, the current one marked, the ends disabled', () => {
    const onChange = vi.fn();
    inBothDirections(
      () => <Pager page={1} pageCount={3} onChange={onChange} />,
      ({ view, locale }) => {
        const nav = view.getByRole('navigation', {
          name: translate(locale, 'admin.common.a11y.pages'),
        });
        expect(nav.classList.contains('pager')).toBe(true);
        const previous = within(nav).getByRole('button', {
          name: translate(locale, 'admin.common.a11y.previousPage'),
        });
        expect(previous.hasAttribute('disabled')).toBe(true);
        const current = within(nav).getByRole('button', { name: '1' });
        expect(current.getAttribute('aria-current')).toBe('page');
        expect(current.classList.contains('pager__page--current')).toBe(true);
        fireEvent.click(within(nav).getByRole('button', { name: '3' }));
        fireEvent.click(
          within(nav).getByRole('button', {
            name: translate(locale, 'admin.common.a11y.nextPage'),
          }),
        );
      },
    );
    expect(onChange.mock.calls).toEqual([[3], [2], [3], [2]]);
  });

  it('shows the first, the last and the pages around the current one, eliding the rest', () => {
    inBothDirections(
      () => <Pager page={6} pageCount={12} onChange={() => undefined} />,
      ({ view, locale }) => {
        const nav = view.getByRole('navigation', {
          name: translate(locale, 'admin.common.a11y.pages'),
        });
        const labels = [...nav.querySelectorAll('.pager__page')].map(
          (node) => node.textContent || node.getAttribute('aria-label'),
        );
        const ellipsis = translate(locale, 'admin.common.pager.ellipsis');
        expect(labels.slice(1, -1)).toEqual(['1', ellipsis, '5', '6', '7', ellipsis, '12']);
      },
    );
  });

  it('draws nothing for a single page', () => {
    inBothDirections(
      () => <Pager page={1} pageCount={1} onChange={() => undefined} />,
      ({ frame }) => expect(frame.querySelector('.pager')).toBeNull(),
    );
  });
});

describe('AuthCard', () => {
  it('is the centred sign-in card with the brand, named by its title', () => {
    inBothDirections(
      () => (
        <AuthCard title="sign in" lede="lede">
          <p>form</p>
        </AuthCard>
      ),
      ({ view, locale }) => {
        const card = view.getByRole('region', { name: 'sign in' });
        expect(card.classList.contains('auth-card')).toBe(true);
        expect(within(card).getByText(translate(locale, 'admin.nav.brand'))).toBeTruthy();
        expect(within(card).getByRole('heading', { level: 1, name: 'sign in' }).className).toBe(
          'page-intro__title',
        );
        expect(within(card).getByText('lede').className).toBe('page-intro__lede');
        expect(within(card).getByText('form')).toBeTruthy();
      },
    );
  });
});
