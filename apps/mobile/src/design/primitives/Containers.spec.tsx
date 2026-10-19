// T032: the containers (R-MOBILE-4/5/6): Card, Section, List and ListRow, Summary, Avatar and
// IconTile, in both directions.
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';

import { tokens } from '../tokens';
import { colour, inBothDirections, nodesOf, styleOf } from './__tests__/harness';
import { Avatar, Card, IconTile, List, ListRow, Section, Summary, Text } from './index';

describe('Card', () => {
  it('is a bordered container with no margin of its own; each variant from its tokens', async () => {
    const cases = [
      ['default', 'surface-raised', tokens.space['4']],
      ['compact', 'surface-raised', tokens.space['3']],
      ['surface', 'surface', tokens.space['4']],
      ['hero', 'surface-raised', tokens.space['5']],
      ['accent', 'accent-subtle', tokens.space['4']],
      ['warning', 'warning-subtle', tokens.space['4']],
      ['primary', 'primary', tokens.space['4']],
      ['selected', 'primary-subtle', tokens.space['4']],
    ] as const;
    for (const [variant, background, padding] of cases) {
      await inBothDirections(
        () => (
          <Card variant={variant}>
            <Text>{variant}</Text>
          </Card>
        ),
        (rendered) => {
          const card = nodesOf(rendered).find(
            (node) => styleOf(node)['backgroundColor'] === colour('light', background),
          );
          const style = styleOf(card ?? { props: {} });
          expect(style['padding']).toBe(padding);
          expect(style['margin']).toBeUndefined();
        },
      );
    }
  });

  it('lays a row card out along the reading direction, and is pressable with onPress', async () => {
    const onPress = jest.fn();
    await inBothDirections(
      () => (
        <Card variant="row" onPress={onPress}>
          <Text>بطاقة</Text>
        </Card>
      ),
      async () => {
        const card = screen.getByRole('button');
        expect(styleOf(card)['flexDirection']).toBe('row');
        await fireEvent.press(card);
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});

describe('Section', () => {
  it('titles its group, with one trailing action', async () => {
    const onPress = jest.fn();
    await inBothDirections(
      () => (
        <Section title="الجلسات القادمة" action={{ label: 'عرض الكل', onPress }}>
          <Text>محتوى</Text>
        </Section>
      ),
      async () => {
        expect(styleOf(screen.getByText('الجلسات القادمة'))['fontSize']).toBe(
          tokens.text.headline.size,
        );
        expect(screen.getByRole('header', { name: 'الجلسات القادمة' })).toBeTruthy();
        await fireEvent.press(screen.getByRole('link', { name: 'عرض الكل' }));
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});

describe('List', () => {
  it('groups rows under a header, the value at the end, a danger row in red', async () => {
    const onPress = jest.fn();
    await inBothDirections(
      () => (
        <List header="الحساب">
          <ListRow label="اللغة" value="العربية" onPress={onPress} />
          <ListRow label="حذف الحساب" tone="danger" onPress={onPress} />
        </List>
      ),
      async () => {
        expect(styleOf(screen.getByText('الحساب'))['color']).toBe(colour('light', 'text-muted'));
        const row = screen.getByRole('button', { name: /اللغة/ });
        expect(styleOf(row)['minHeight']).toBe(tokens.size['list-row']);
        expect(styleOf(row)['flexDirection']).toBe('row');
        expect(styleOf(screen.getByText('العربية'))['color']).toBe(colour('light', 'text-muted'));
        expect(styleOf(screen.getByText('حذف الحساب'))['color']).toBe(colour('light', 'danger'));
        await fireEvent.press(row);
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('draws a divider between rows, never before the first', async () => {
    await inBothDirections(
      () => (
        <List>
          <ListRow label="أ" />
          <ListRow label="ب" />
        </List>
      ),
      (rendered) => {
        const dividers = nodesOf(rendered).filter(
          (node) => styleOf(node)['borderTopWidth'] === tokens.borderWidth.hairline,
        );
        expect(dividers).toHaveLength(1);
      },
    );
  });
});

describe('Summary', () => {
  it('lists label and value rows; the total is bold, the emphasis highlighted', async () => {
    await inBothDirections(
      () => (
        <Summary
          rows={[
            { label: 'السعر', value: '400' },
            { label: 'الإجمالي', value: '400', kind: 'total' },
            { label: 'يصلك', value: '360', kind: 'emphasis' },
          ]}
        />
      ),
      (rendered) => {
        expect(styleOf(screen.getByText('السعر'))['color']).toBe(colour('light', 'text-muted'));
        expect(styleOf(screen.getByText('الإجمالي'))['fontWeight']).toBe(tokens.font.weight.bold);
        expect(
          nodesOf(rendered).some(
            (node) => styleOf(node)['backgroundColor'] === colour('light', 'surface-strong'),
          ),
        ).toBe(true);
      },
    );
  });
});

describe('Avatar', () => {
  it('is round at its media size, with the initials', async () => {
    await inBothDirections(
      () => <Avatar initials="أم" size="lg" tone="primary" />,
      (rendered) => {
        expect(screen.getByText('أم')).toBeTruthy();
        const circle = nodesOf(rendered).find((node) => styleOf(node)['width'] === tokens.media.lg);
        expect(styleOf(circle ?? { props: {} })).toMatchObject({
          height: tokens.media.lg,
          borderRadius: tokens.radius.full,
          backgroundColor: colour('light', 'primary'),
        });
      },
    );
  });

  it('shows the photo when there is one', async () => {
    await inBothDirections(
      () => <Avatar initials="أم" imageUri="https://example.test/a.jpg" />,
      (rendered) => {
        expect(nodesOf(rendered).some((node) => node.type === 'Image')).toBe(true);
      },
    );
  });
});

describe('IconTile', () => {
  it('tints a square by its tone; round when asked', async () => {
    await inBothDirections(
      () => (
        <>
          <IconTile icon={{ name: 'award' }} tone="accent" size="xl" />
          <IconTile icon={{ name: 'check' }} tone="primary" round />
        </>
      ),
      (rendered) => {
        const accent = nodesOf(rendered).find(
          (node) => styleOf(node)['backgroundColor'] === colour('light', 'accent-subtle'),
        );
        expect(styleOf(accent ?? { props: {} })).toMatchObject({
          width: tokens.media.xl,
          borderRadius: tokens.radius.lg,
        });
        const primary = nodesOf(rendered).find(
          (node) => styleOf(node)['backgroundColor'] === colour('light', 'primary'),
        );
        expect(styleOf(primary ?? { props: {} })['borderRadius']).toBe(tokens.radius.full);
      },
    );
  });
});
