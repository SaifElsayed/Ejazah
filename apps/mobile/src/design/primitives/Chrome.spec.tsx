// T032: the screen chrome (R-MOBILE-4/5/6): AppHeader, NavHeader, PageIntro, Brand, ActionBar,
// TabBar and SearchRow, in both directions. T014: FilterChips.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';

import { tokens } from '../tokens';
import { colour, inBothDirections, nodesOf, styleOf, unmarked } from './__tests__/harness';
import {
  ActionBar,
  AppHeader,
  Brand,
  Button,
  FilterChips,
  Icon,
  IconButton,
  NavHeader,
  PageIntro,
  SearchRow,
  TabBar,
} from './index';

const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({ router: { navigate: (route: string) => mockNavigate(route) } }));

beforeEach(() => {
  mockNavigate.mockReset();
});

describe('AppHeader', () => {
  it('puts the title at the start and the actions at the end', async () => {
    await inBothDirections(
      () => (
        <AppHeader
          title="اشتراكاتي"
          subtitle="2 جارية"
          actions={
            <IconButton
              icon={{ name: 'bell' }}
              accessibilityLabel="الإشعارات"
              onPress={() => undefined}
            />
          }
        />
      ),
      () => {
        expect(styleOf(screen.getByText('اشتراكاتي'))['fontSize']).toBe(
          tokens.text['title-1'].size,
        );
        expect(screen.getByRole('header', { name: 'اشتراكاتي' })).toBeTruthy();
        expect(styleOf(screen.getByText('2 جارية'))['color']).toBe(colour('light', 'text-muted'));
        expect(screen.getByRole('button', { name: 'الإشعارات' })).toBeTruthy();
      },
    );
  });

  it('shows the brand in place of a title', async () => {
    await inBothDirections(
      () => <AppHeader brand />,
      (_rendered, direction) => {
        expect(screen.getByText(direction === 'rtl' ? 'إجازة' : 'Ijazah')).toBeTruthy();
      },
    );
  });
});

describe('NavHeader', () => {
  it('goes back through a labelled, mirrored arrow; closes through an x', async () => {
    const back = jest.fn();
    await inBothDirections(
      () => (
        <NavHeader
          title="الوثائق"
          back={{ kind: 'back', onPress: back }}
          steps={{ steps: ['أ', 'ب'], current: 0 }}
        />
      ),
      async (rendered, direction) => {
        expect(styleOf(screen.getByText('الوثائق'))['fontSize']).toBe(tokens.text['title-3'].size);
        const button = screen.getByRole('button', { name: direction === 'rtl' ? 'رجوع' : 'Back' });
        expect(styleOf(button)['marginStart']).toBe(-tokens.space['3']);
        const mirrored = nodesOf(rendered).some((node) =>
          JSON.stringify(styleOf(node)['transform'] ?? []).includes('"scaleX":-1'),
        );
        expect(mirrored).toBe(direction === 'rtl');
        expect(
          nodesOf(rendered).filter((node) => styleOf(node)['height'] === tokens.size['steps-bar']),
        ).toHaveLength(2);
        await fireEvent.press(button);
      },
    );
    expect(back).toHaveBeenCalledTimes(2);
    await inBothDirections(
      () => <NavHeader title="t" back={{ kind: 'close', onPress: () => undefined }} />,
      (_rendered, direction) => {
        expect(
          screen.getByRole('button', { name: direction === 'rtl' ? 'إغلاق' : 'Close' }),
        ).toBeTruthy();
      },
    );
  });
});

describe('PageIntro', () => {
  it('is the large title and its lede', async () => {
    await inBothDirections(
      () => <PageIntro title="أنشئ حسابك" lede="بضع خطوات" />,
      () => {
        expect(styleOf(screen.getByText('أنشئ حسابك'))['fontSize']).toBe(
          tokens.text['title-1'].size,
        );
        expect(styleOf(screen.getByText('بضع خطوات'))['color']).toBe(colour('light', 'text-muted'));
      },
    );
  });
});

describe('Brand', () => {
  it('draws the mark at 32, or 72 when large, with the name when visible', async () => {
    await inBothDirections(
      () => (
        <>
          <Brand />
          <Brand size="lg" nameVisible={false} />
        </>
      ),
      (rendered, direction) => {
        const marks = nodesOf(rendered).filter(
          (node) => styleOf(node)['backgroundColor'] === colour('light', 'primary'),
        );
        expect(marks.map((mark) => styleOf(mark)['width'])).toEqual([
          tokens.media.sm,
          tokens.media['2xl'],
        ]);
        expect(screen.getAllByText(direction === 'rtl' ? 'إجازة' : 'Ijazah')).toHaveLength(1);
      },
    );
  });
});

describe('ActionBar', () => {
  it('pins its actions above the home indicator with a note', async () => {
    await inBothDirections(
      () => (
        <ActionBar layout="row" note="يمكنك التعديل لاحقًا">
          <Button label="حفظ" onPress={() => undefined} />
        </ActionBar>
      ),
      (rendered) => {
        const bar = nodesOf(rendered).find(
          (node) => styleOf(node)['paddingBottom'] === tokens.layout['inset-bottom'],
        );
        expect(styleOf(bar ?? { props: {} })).toMatchObject({
          borderTopWidth: tokens.borderWidth.hairline,
          borderTopColor: colour('light', 'border'),
        });
        expect(styleOf(screen.getByText('يمكنك التعديل لاحقًا'))['textAlign']).toBe('center');
      },
    );
  });
});

describe('TabBar', () => {
  const items = [
    { route: '/(student)/(tabs)', label: 'الرئيسية', icon: { name: 'house' as const } },
    { route: '/(student)/(tabs)/account', label: 'حسابي', icon: { name: 'user' as const } },
  ];

  it('marks the active item primary and navigates to another', async () => {
    await inBothDirections(
      () => <TabBar items={items} activeRoute="/(student)/(tabs)" />,
      async () => {
        const active = screen.getByRole('tab', { name: 'الرئيسية' });
        expect(active.props['accessibilityState']).toMatchObject({ selected: true });
        expect(styleOf(screen.getByText('الرئيسية'))['color']).toBe(colour('light', 'primary'));
        expect(styleOf(screen.getByText('حسابي'))['color']).toBe(colour('light', 'text-muted'));
        expect(styleOf(active)['minHeight']).toBe(tokens.size.touch);
        await fireEvent.press(screen.getByRole('tab', { name: 'حسابي' }));
      },
    );
    expect(mockNavigate).toHaveBeenCalledWith('/(student)/(tabs)/account');
    expect(mockNavigate).toHaveBeenCalledTimes(2);
  });
});

describe('SearchRow', () => {
  it('holds the search and the filter trigger with its count', async () => {
    const onPress = jest.fn();
    const onChangeText = jest.fn();
    await inBothDirections(
      () => (
        <SearchRow
          value=""
          onChangeText={onChangeText}
          placeholder="ابحث عن معلم"
          filters={{ count: 2, onPress }}
        />
      ),
      async (_rendered, direction) => {
        await fireEvent.changeText(screen.getByPlaceholderText('ابحث عن معلم'), 'أحمد');
        expect(screen.getByText('2')).toBeTruthy();
        const name = direction === 'rtl' ? 'الفلاتر · 2 مفعّلة' : 'Filters · 2 active';
        await fireEvent.press(screen.getByLabelText(name, { normalizer: unmarked }));
      },
    );
    expect(onChangeText).toHaveBeenCalledWith('أحمد');
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});

describe('FilterChips', () => {
  it('shows each applied filter as a removable chip, then clears them all', async () => {
    const onRemove = jest.fn();
    const onRating = jest.fn();
    const onClearAll = jest.fn();
    await inBothDirections(
      () => (
        <FilterChips
          chips={[
            { key: 'riwayah', content: 'حفص عن عاصم', onRemove },
            {
              key: 'rating',
              content: <Icon name="star" size="xs" fill="filled" tone="primary" />,
              onRemove: onRating,
            },
          ]}
          onClearAll={onClearAll}
        />
      ),
      async (rendered, direction) => {
        const chip = screen.getByRole('button', { name: 'حفص عن عاصم' });
        expect(chip.props['accessibilityState']).toMatchObject({ selected: true });
        expect(styleOf(chip)).toMatchObject({
          backgroundColor: colour('light', 'primary-subtle'),
          paddingEnd: tokens.space['2'],
        });
        expect(screen.getAllByRole('button')).toHaveLength(2);
        expect(
          nodesOf(rendered).some(
            (node) =>
              styleOf(node)['flexWrap'] === 'wrap' && styleOf(node)['gap'] === tokens.space['2'],
          ),
        ).toBe(true);
        await fireEvent.press(chip);
        await fireEvent.press(screen.getAllByRole('button')[1]!);
        const clear = direction === 'rtl' ? 'مسح الكل' : 'Clear all';
        await fireEvent.press(screen.getByRole('link', { name: clear }));
      },
    );
    expect(onRemove).toHaveBeenCalledTimes(2);
    expect(onRating).toHaveBeenCalledTimes(2);
    expect(onClearAll).toHaveBeenCalledTimes(2);
  });

  it('shows nothing when no filter is applied', async () => {
    await inBothDirections(
      () => <FilterChips chips={[]} onClearAll={() => undefined} />,
      () => {
        expect(screen.queryAllByRole('button')).toHaveLength(0);
        expect(screen.queryAllByRole('link')).toHaveLength(0);
      },
    );
  });
});
