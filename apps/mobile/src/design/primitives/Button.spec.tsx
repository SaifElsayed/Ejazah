// T032: Button, IconButton and TextLink (R-MOBILE-4/5/6): touch sizes, variants from tokens,
// accessible names and states, in both directions.
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';

import { tokens } from '../tokens';
import { colour, inBothDirections, nodesOf, styleOf } from './__tests__/harness';
import { Button, IconButton, TextLink } from './index';

describe('Button', () => {
  it('is a 52-high primary button by default, pressed once per press', async () => {
    const onPress = jest.fn();
    await inBothDirections(
      () => <Button label="متابعة" onPress={onPress} />,
      async () => {
        const button = screen.getByRole('button', { name: 'متابعة' });
        const style = styleOf(button);
        expect(style['height']).toBe(tokens.size['control-lg']);
        expect(style['backgroundColor']).toBe(colour('light', 'primary'));
        expect(style['borderRadius']).toBe(tokens.radius.md);
        await fireEvent.press(button);
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('draws each variant from its tokens', async () => {
    const cases = [
      ['secondary', 'bg', 'border-strong'],
      ['danger', 'bg', 'border-strong'],
      ['inverse', 'on-primary-overlay', undefined],
      ['apple', 'brand-apple', undefined],
      ['google', 'bg', 'border-strong'],
    ] as const;
    for (const [variant, background, border] of cases) {
      await inBothDirections(
        () => <Button label={variant} variant={variant} onPress={() => undefined} />,
        () => {
          const style = styleOf(screen.getByRole('button', { name: variant }));
          expect(style['backgroundColor']).toBe(colour('light', background));
          if (border !== undefined) expect(style['borderColor']).toBe(colour('light', border));
        },
      );
    }
  });

  it('is 44 high at md, full width as a block, sharing the row as grow', async () => {
    await inBothDirections(
      () => (
        <>
          <Button label="md" size="md" onPress={() => undefined} />
          <Button label="block" layout="block" onPress={() => undefined} />
          <Button label="grow" layout="grow" onPress={() => undefined} />
        </>
      ),
      () => {
        expect(styleOf(screen.getByRole('button', { name: 'md' }))['height']).toBe(
          tokens.size['control-md'],
        );
        expect(styleOf(screen.getByRole('button', { name: 'block' }))['alignSelf']).toBe('stretch');
        expect(styleOf(screen.getByRole('button', { name: 'grow' }))['flex']).toBe(1);
      },
    );
  });

  it('dims and refuses presses when disabled; keeps the label while loading', async () => {
    const onPress = jest.fn();
    await inBothDirections(
      () => (
        <>
          <Button label="off" disabled onPress={onPress} />
          <Button label="busy" loading onPress={onPress} />
        </>
      ),
      async () => {
        const off = screen.getByRole('button', { name: 'off' });
        expect(styleOf(off)['opacity']).toBe(tokens.opacity.disabled);
        expect(off.props['accessibilityState']).toMatchObject({ disabled: true });
        await fireEvent.press(off);
        const busy = screen.getByRole('button', { name: 'busy' });
        expect(busy.props['accessibilityState']).toMatchObject({ busy: true });
        await fireEvent.press(busy);
        // The label stays in place, transparent, so the width does not jump.
        expect(styleOf(screen.getByText('busy'))['opacity']).toBe(0);
      },
    );
    expect(onPress).not.toHaveBeenCalled();
  });

  it('places its icon before the label, mirrored when it is directional', async () => {
    await inBothDirections(
      () => (
        <Button
          label="ابدأ"
          icon={{ name: 'arrow-left' }}
          variant="ghost"
          onPress={() => undefined}
        />
      ),
      (rendered, direction) => {
        const button = screen.getByRole('button', { name: 'ابدأ' });
        expect(styleOf(button)['flexDirection']).toBe('row');
        const mirrored = nodesOf(rendered).some((node) =>
          JSON.stringify(styleOf(node)['transform'] ?? []).includes('"scaleX":-1'),
        );
        expect(mirrored).toBe(direction === 'rtl');
      },
    );
  });
});

describe('IconButton', () => {
  it('is a labelled square at the touch size, with its unread dot at the start', async () => {
    await inBothDirections(
      () => (
        <IconButton
          icon={{ name: 'bell' }}
          variant="surface"
          dot
          accessibilityLabel="الإشعارات"
          onPress={() => undefined}
        />
      ),
      (rendered) => {
        const button = screen.getByRole('button', { name: 'الإشعارات' });
        const style = styleOf(button);
        expect(style['width']).toBe(tokens.size.touch);
        expect(style['height']).toBe(tokens.size.touch);
        expect(style['backgroundColor']).toBe(colour('light', 'surface'));
        const dot = nodesOf(rendered).find((node) => styleOf(node)['width'] === tokens.size.dot);
        expect(styleOf(dot ?? { props: {} })['start']).toBe(tokens.space['2']);
      },
    );
  });

  it('refuses presses when disabled', async () => {
    const onPress = jest.fn();
    await inBothDirections(
      () => (
        <IconButton icon={{ name: 'x' }} disabled accessibilityLabel="إغلاق" onPress={onPress} />
      ),
      async () => {
        await fireEvent.press(screen.getByRole('button', { name: 'إغلاق' }));
      },
    );
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('TextLink', () => {
  it('is a full touch target in the link colour', async () => {
    const onPress = jest.fn();
    await inBothDirections(
      () => <TextLink label="نسيت كلمة المرور؟" onPress={onPress} />,
      async () => {
        const link = screen.getByRole('link', { name: 'نسيت كلمة المرور؟' });
        expect(styleOf(link)['minHeight']).toBe(tokens.size.touch);
        expect(styleOf(link)['minWidth']).toBe(tokens.size.touch);
        expect(styleOf(screen.getByText('نسيت كلمة المرور؟'))['color']).toBe(
          colour('light', 'primary'),
        );
        await fireEvent.press(link);
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('draws the muted variant regular and the strong variant bold', async () => {
    await inBothDirections(
      () => (
        <>
          <TextLink label="muted" variant="muted" onPress={() => undefined} />
          <TextLink label="strong" variant="strong" onPress={() => undefined} />
        </>
      ),
      () => {
        const muted = styleOf(screen.getByText('muted'));
        expect(muted['color']).toBe(colour('light', 'text-muted'));
        expect(muted['fontWeight']).toBe(tokens.font.weight.regular);
        expect(styleOf(screen.getByText('strong'))['fontWeight']).toBe(tokens.font.weight.bold);
      },
    );
  });
});
