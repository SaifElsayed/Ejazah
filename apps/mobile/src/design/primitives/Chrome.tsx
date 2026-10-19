import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { useT } from '../../i18n';
import { useFormatters } from '../../lib/formatters';
import { useTheme } from '../theme';
import { PressableIcon } from './Button';
import { InputGroup } from './Forms';
import { Glyph } from './Icon';
import { Steps } from './Progress';
import { border, layout, media, pressed, radius, size, space } from './style';
import { Words } from './Text';
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

// ---------------------------------------------------------------------------------------------
// T032: the implementations. FilterChips is a contract of the discovery screens (Phase 2) and is
// implemented with them. The top and bottom insets of the device are the screen's (a safe area
// view at the route), so the headers start at the bar and the bottom bars reserve the home
// indicator's token.

export function AppHeader({ title, subtitle, brand = false, actions }: AppHeaderProps) {
  return (
    <View
      style={{
        flexShrink: 0,
        height: layout.header,
        paddingHorizontal: layout.gutter,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space['3'],
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        {brand ? <Brand /> : null}
        {title === undefined ? null : (
          <View accessible accessibilityRole="header" accessibilityLabel={title}>
            <Words variant="title-1" color="text" numberOfLines={1}>
              {title}
            </Words>
          </View>
        )}
        {subtitle === undefined ? null : (
          <Words variant="caption" color="text-muted" numberOfLines={1}>
            {subtitle}
          </Words>
        )}
      </View>
      {actions === undefined ? null : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
          {actions}
        </View>
      )}
    </View>
  );
}

export function NavHeader({ title, subtitle, back, trailing, steps }: NavHeaderProps) {
  const t = useT();
  return (
    <View
      style={{
        flexShrink: 0,
        paddingHorizontal: layout.gutter,
        paddingBottom: space['2'],
        gap: space['3'],
      }}
    >
      <View
        style={{
          height: layout.header,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space['1'],
        }}
      >
        <PressableIcon
          icon={
            back.kind === 'back' ? { name: 'chevron-left', size: 'lg' } : { name: 'x', size: 'lg' }
          }
          accessibilityLabel={t(back.kind === 'back' ? 'common.a11y.back' : 'common.a11y.close')}
          onPress={back.onPress}
          // `.back-btn`: the icon sits on the gutter, the touch target reaches past it.
          style={{ marginStart: -space['3'] }}
        />
        <View accessible accessibilityRole="header" style={{ flex: 1, minWidth: 0 }}>
          <Words variant="title-3" color="text" numberOfLines={1}>
            {title}
          </Words>
          {subtitle === undefined ? null : (
            <Words variant="caption" color="text-muted" numberOfLines={1}>
              {subtitle}
            </Words>
          )}
        </View>
        {trailing === undefined ? null : (
          <View
            style={{
              marginStart: 'auto',
              flexDirection: 'row',
              alignItems: 'center',
              gap: space['2'],
            }}
          >
            {trailing}
          </View>
        )}
      </View>
      {steps === undefined ? null : <Steps steps={steps.steps} current={steps.current} />}
    </View>
  );
}

export function PageIntro({ title, lede }: PageIntroProps) {
  return (
    <View style={{ gap: space['2'] }}>
      <View accessible accessibilityRole="header">
        <Words variant="title-1" color="text">
          {title}
        </Words>
      </View>
      {lede === undefined ? null : <Words color="text-muted">{lede}</Words>}
    </View>
  );
}

export function Brand({ size: scale = 'md', nameVisible = true }: BrandProps) {
  const { color } = useTheme();
  const t = useT();
  const large = scale === 'lg';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: large ? media['2xl'] : media.sm,
          height: large ? media['2xl'] : media.sm,
          flexShrink: 0,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: large ? radius.xl : radius.sm,
          backgroundColor: color.primary,
        }}
      >
        <Words variant={large ? 'display' : 'headline'} weight="bold" color="on-primary">
          {t('common.brand.mark')}
        </Words>
      </View>
      {nameVisible ? (
        <Words variant="title-3" color="text">
          {t('common.brand.name')}
        </Words>
      ) : null}
    </View>
  );
}

export function ActionBar({ layout: arrangement = 'column', note, children }: ActionBarProps) {
  const { color } = useTheme();
  return (
    <View
      style={{
        flexShrink: 0,
        flexDirection: arrangement === 'row' ? 'row' : 'column',
        alignItems: arrangement === 'row' ? 'center' : 'stretch',
        gap: space['2'],
        paddingTop: space['3'],
        paddingHorizontal: layout.gutter,
        paddingBottom: layout['inset-bottom'],
        borderTopWidth: border.hairline,
        borderTopColor: color.border,
        backgroundColor: color.bg,
      }}
    >
      {children}
      {note === undefined ? null : (
        <Words variant="caption" color="text-muted" align="center">
          {note}
        </Words>
      )}
    </View>
  );
}

/** The tab bar: one item per route, the active one primary; a press navigates to its route. */
export function TabBar({ items, activeRoute }: TabBarProps) {
  const { color } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexShrink: 0,
        flexDirection: 'row',
        height: layout.tabbar + layout['inset-bottom'],
        paddingTop: space['2'],
        paddingHorizontal: space['2'],
        paddingBottom: layout['inset-bottom'],
        borderTopWidth: border.hairline,
        borderTopColor: color.border,
        backgroundColor: color.bg,
      }}
    >
      {items.map((item) => {
        const active = item.route === activeRoute;
        const tint = active ? 'primary' : 'text-muted';
        return (
          <Pressable
            key={item.route}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (!active) router.navigate(item.route as never);
            }}
            style={({ pressed: down }) => [
              { flex: 1, minHeight: size.touch, alignItems: 'center', gap: space['1'] },
              down ? pressed : null,
            ]}
          >
            <Glyph {...item.icon} stroke={active ? 'medium' : 'regular'} color={tint} />
            <Words
              variant="micro"
              weight={active ? 'bold' : 'medium'}
              color={tint}
              numberOfLines={1}
            >
              {item.label}
            </Words>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SearchRow({ value, onChangeText, placeholder, filters }: SearchRowProps) {
  const { color } = useTheme();
  const t = useT();
  const format = useFormatters();
  const applied = filters !== undefined && filters.count > 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <InputGroup
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          leadingIcon={{ name: 'search' }}
          size="md"
          surface
        />
      </View>
      {filters === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            applied
              ? t('common.a11y.filtersActive', { count: filters.count })
              : t('common.a11y.filters')
          }
          onPress={filters.onPress}
          style={({ pressed: down }) => [
            {
              width: size['control-md'],
              height: size['control-md'],
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: border.hairline,
              borderRadius: radius.md,
              borderColor: applied ? color['primary-border'] : color.border,
              backgroundColor: applied ? color['primary-subtle'] : color.surface,
            },
            down ? pressed : null,
          ]}
        >
          <Glyph name="sliders-horizontal" color={applied ? 'primary-strong' : 'text'} />
          {applied ? (
            <View
              style={{
                position: 'absolute',
                top: -space['1'],
                end: -space['1'],
                minWidth: space['5'],
                height: space['5'],
                paddingHorizontal: space['1'],
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.full,
                backgroundColor: color.primary,
              }}
            >
              <Words variant="micro" weight="bold" color="on-primary">
                {format.number(filters.count)}
              </Words>
            </View>
          ) : null}
        </Pressable>
      )}
    </View>
  );
}
