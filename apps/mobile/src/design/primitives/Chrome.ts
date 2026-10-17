import type { Content, IconSpec, Press } from './types';

/**
 * AppHeader: the root of every tab. The title (or the brand) at the start, actions at the end; no
 * divider until the body scrolls. Design: `.app-header`.
 */
export interface AppHeaderProps {
  readonly title?: string;
  readonly subtitle?: string;
  readonly brand?: boolean;
  readonly actions?: Content;
}

/**
 * NavHeader: a pushed screen: back (or close), the title, one optional trailing action, optional
 * steps under the bar. Design: `.nav-header`, `.back-btn`.
 */
export interface NavHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly back: { readonly kind: 'back' | 'close'; readonly onPress: Press };
  readonly trailing?: Content;
  readonly steps?: { readonly steps: readonly string[]; readonly current: number };
}

/** PageIntro: the large title and lede of a flow step (auth, onboarding). Design: `.page-intro`. */
export interface PageIntroProps {
  readonly title: string;
  readonly lede?: string;
}

/** Brand: the wordmark and its mark. Design: `.brand`, `.brand-mark`, `.brand-mark--lg`. */
export interface BrandProps {
  readonly size?: 'md' | 'lg';
  readonly nameVisible?: boolean;
}

/**
 * ActionBar: actions pinned above a body that scrolls, ending above the home indicator. A screen
 * whose content fits ends its body with the actions instead. Design: `.action-bar`,
 * `.action-bar--row`, `.action-bar__note`.
 */
export interface ActionBarProps {
  readonly layout?: 'column' | 'row';
  readonly note?: string;
  readonly children: Content;
}

/**
 * TabBar: one per role, the same component. The student bar guides, the teacher bar navigates;
 * the active item is primary with a medium stroke. Design: `.tabbar`, `.tabbar__item--active`.
 */
export interface TabBarProps {
  readonly items: readonly {
    readonly route: string;
    readonly label: string;
    readonly icon: IconSpec;
  }[];
  readonly activeRoute: string;
}

/**
 * SearchRow: the search field with the filter trigger beside it; the trigger shows the count of
 * applied filters. Applied filters are removable chips under it (FilterChips). Design:
 * `.search-row`, `.filter-trigger`, `.filter-trigger--active`, `.filter-trigger__count`, `.filter-chips`.
 */
export interface SearchRowProps {
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder: string;
  readonly filters?: { readonly count: number; readonly onPress: Press };
}

export interface FilterChipsProps {
  readonly chips: readonly {
    readonly key: string;
    readonly content: Content;
    readonly onRemove: Press;
  }[];
  readonly onClearAll: Press;
}
