// T032: Text and Icon render in both directions from tokens only (R-MOBILE-4/5, R-MOBILE-14).
import { describe, expect, it } from '@jest/globals';
import { screen } from '@testing-library/react-native';

import { tokens } from '../tokens';
import { colour, inBothDirections, nodesOf, styleOf } from './__tests__/harness';
import { Icon, Text } from './index';

describe('Text', () => {
  it('sets the ramp, the weight and the tone from tokens', async () => {
    await inBothDirections(
      () => (
        <Text variant="title-2" tone="muted">
          إجازة
        </Text>
      ),
      () => {
        const style = styleOf(screen.getByText('إجازة'));
        expect(style['fontSize']).toBe(tokens.text['title-2'].size);
        expect(style['lineHeight']).toBe(tokens.text['title-2'].lineHeight);
        // display to headline are bold by default
        expect(style['fontWeight']).toBe(tokens.font.weight.bold);
        expect(style['color']).toBe(colour('light', 'text-muted'));
      },
    );
  });

  it('is body, regular and default when nothing is said', async () => {
    await inBothDirections(
      () => <Text>نص</Text>,
      () => {
        const style = styleOf(screen.getByText('نص'));
        expect(style['fontSize']).toBe(tokens.text.body.size);
        expect(style['fontWeight']).toBe(tokens.font.weight.regular);
        expect(style['color']).toBe(colour('light', 'text'));
      },
    );
  });

  it('isolates an LTR run inside either direction', async () => {
    await inBothDirections(
      () => <Text ltr>name@example.com</Text>,
      () => {
        expect(screen.getByText('⁦name@example.com⁩')).toBeTruthy();
        expect(styleOf(screen.getByText(/name@example\.com/))['writingDirection']).toBe('ltr');
      },
    );
  });

  it('aligns to the start, the centre or the end without a physical side', async () => {
    await inBothDirections(
      () => (
        <>
          <Text align="start">a</Text>
          <Text align="center">b</Text>
          <Text align="end">c</Text>
        </>
      ),
      () => {
        expect(styleOf(screen.getByText('a'))['textAlign']).toBe('auto');
        expect(styleOf(screen.getByText('b'))['textAlign']).toBe('center');
        expect(styleOf(screen.getByText('c'))['alignSelf']).toBe('flex-end');
      },
    );
  });

  it('follows the dark scheme', async () => {
    await inBothDirections(
      () => <Text tone="primary">x</Text>,
      () => {
        expect(styleOf(screen.getByText('x'))['color']).toBe(colour('dark', 'primary'));
      },
      'dark',
    );
  });
});

describe('Icon', () => {
  it('draws at the token size and stroke, hidden from the screen reader when unlabelled', async () => {
    await inBothDirections(
      () => <Icon name="mail" size="lg" stroke="medium" tone="primary" />,
      (rendered) => {
        const svg = nodesOf(rendered).find((node) => node.type === 'RNSVGSvgView');
        expect(svg?.props['width']).toBe(tokens.icon.size.lg);
        expect(svg?.props['strokeWidth']).toBe(tokens.icon.stroke.medium);
        expect(svg?.props['stroke']).toBe(colour('light', 'primary'));
        expect(screen.queryByRole('image')).toBeNull();
      },
    );
  });

  it('is announced when labelled', async () => {
    await inBothDirections(
      () => <Icon name="bell" accessibilityLabel="الإشعارات" />,
      () => {
        expect(screen.getByLabelText('الإشعارات')).toBeTruthy();
      },
    );
  });

  it('mirrors a directional icon right-to-left only, through the direction', async () => {
    await inBothDirections(
      () => <Icon name="chevron-left" />,
      (rendered, direction) => {
        const mirrored = nodesOf(rendered).some((node) =>
          JSON.stringify(styleOf(node)['transform'] ?? []).includes('"scaleX":-1'),
        );
        expect(mirrored).toBe(direction === 'rtl');
      },
    );
  });

  it('never mirrors an icon that does not point along the reading direction', async () => {
    await inBothDirections(
      () => <Icon name="mail" />,
      (rendered) => {
        const mirrored = nodesOf(rendered).some((node) =>
          JSON.stringify(styleOf(node)['transform'] ?? []).includes('"scaleX":-1'),
        );
        expect(mirrored).toBe(false);
      },
    );
  });

  it('draws the two brand marks solid', async () => {
    await inBothDirections(
      () => (
        <>
          <Icon name="apple" fill="solid" accessibilityLabel="Apple" />
          <Icon name="google" fill="solid" accessibilityLabel="Google" />
        </>
      ),
      () => {
        expect(screen.getByLabelText('Apple')).toBeTruthy();
        expect(screen.getByLabelText('Google')).toBeTruthy();
      },
    );
  });
});
