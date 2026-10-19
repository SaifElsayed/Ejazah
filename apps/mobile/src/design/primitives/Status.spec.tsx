// T032: the status primitives (R-MOBILE-4/5): Badge, Banner, Toast, EmptyState, Skeleton and
// Spinner, in both directions.
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';

import { tokens } from '../tokens';
import { colour, inBothDirections, nodesOf, styleOf } from './__tests__/harness';
import { Badge, Banner, EmptyState, Skeleton, Spinner, Toast } from './index';

describe('Badge', () => {
  it('draws each tone from its subtle surface and its text colour', async () => {
    const cases = [
      ['neutral', 'surface', 'text-muted'],
      ['success', 'primary-subtle', 'primary-strong'],
      ['warning', 'warning-subtle', 'warning-text'],
      ['danger', 'danger-subtle', 'danger'],
      ['accent', 'accent-soft', 'accent-text'],
      ['on-primary', 'on-primary-overlay', 'on-primary'],
    ] as const;
    for (const [tone, surface, text] of cases) {
      await inBothDirections(
        () => <Badge label={tone} tone={tone} icon={{ name: 'check' }} />,
        (rendered) => {
          const label = screen.getByText(tone);
          expect(styleOf(label)['color']).toBe(colour('light', text));
          expect(styleOf(label)['fontSize']).toBe(tokens.text.micro.size);
          const pill = nodesOf(rendered).find(
            (node) => styleOf(node)['backgroundColor'] === colour('light', surface),
          );
          expect(styleOf(pill ?? { props: {} })['borderRadius']).toBe(tokens.radius.full);
        },
      );
    }
  });
});

describe('Banner', () => {
  it('carries its icon and its text on the tone surface', async () => {
    await inBothDirections(
      () => (
        <Banner icon={{ name: 'triangle-alert' }} tone="danger">
          تعذّر تحميل البيانات.
        </Banner>
      ),
      (rendered) => {
        expect(screen.getByText('تعذّر تحميل البيانات.')).toBeTruthy();
        const surface = nodesOf(rendered).find(
          (node) => styleOf(node)['backgroundColor'] === colour('light', 'danger-subtle'),
        );
        expect(styleOf(surface ?? { props: {} })['flexDirection']).toBe('row');
        const svg = nodesOf(rendered).find((node) => node.type === 'RNSVGSvgView');
        expect(svg?.props['stroke']).toBe(colour('light', 'danger'));
      },
    );
  });

  it('has no surface when plain', async () => {
    await inBothDirections(
      () => (
        <Banner icon={{ name: 'info' }} tone="plain">
          ملاحظة
        </Banner>
      ),
      (rendered) => {
        expect(
          nodesOf(rendered).some(
            (node) => styleOf(node)['backgroundColor'] === colour('light', 'surface'),
          ),
        ).toBe(false);
      },
    );
  });
});

describe('Toast', () => {
  it('is the inverted confirmation, announced politely', async () => {
    await inBothDirections(
      () => <Toast message="أُرسل البلاغ" icon={{ name: 'circle-check' }} />,
      (rendered) => {
        const text = screen.getByText('أُرسل البلاغ');
        expect(styleOf(text)['color']).toBe(colour('light', 'bg'));
        const surface = nodesOf(rendered).find(
          (node) => styleOf(node)['backgroundColor'] === colour('light', 'text'),
        );
        expect(surface?.props['accessibilityLiveRegion']).toBe('polite');
      },
    );
  });
});

describe('EmptyState', () => {
  it('says what is missing, why, and the one next step', async () => {
    const onPress = jest.fn();
    await inBothDirections(
      () => (
        <EmptyState
          icon={{ name: 'circle-check' }}
          title="لا اشتراكات بعد"
          text="ستظهر هنا جلساتك بعد أول حجز."
          action={{ label: 'استكشف المعلمين', onPress }}
        />
      ),
      async () => {
        const title = styleOf(screen.getByText('لا اشتراكات بعد'));
        expect(title['fontSize']).toBe(tokens.text['title-3'].size);
        expect(screen.getByText('ستظهر هنا جلساتك بعد أول حجز.')).toBeTruthy();
        await fireEvent.press(screen.getByRole('button', { name: 'استكشف المعلمين' }));
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});

describe('Skeleton', () => {
  it('takes the shape and the width of what is loading, hidden from the screen reader', async () => {
    await inBothDirections(
      () => (
        <>
          <Skeleton shape="title" width="2/3" />
          <Skeleton shape="avatar" />
          <Skeleton shape="block" />
        </>
      ),
      (rendered) => {
        const shapes = nodesOf(rendered).filter(
          (node) => styleOf(node)['backgroundColor'] === colour('light', 'skeleton'),
        );
        expect(shapes).toHaveLength(3);
        expect(styleOf(shapes[0] ?? { props: {} })).toMatchObject({
          height: tokens.space['5'],
          width: '66%',
        });
        expect(styleOf(shapes[1] ?? { props: {} })).toMatchObject({
          width: tokens.media.sm,
          borderRadius: tokens.radius.full,
        });
        expect(styleOf(shapes[2] ?? { props: {} })['height']).toBe(tokens.size['control-lg']);
        for (const shape of shapes)
          expect(shape.props['importantForAccessibility']).toBe('no-hide-descendants');
      },
    );
  });
});

describe('Spinner', () => {
  it('is the confirming state at 72, or 24 when small', async () => {
    await inBothDirections(
      () => (
        <>
          <Spinner />
          <Spinner size="sm" />
        </>
      ),
      (rendered) => {
        const rings = nodesOf(rendered).filter(
          (node) => styleOf(node)['borderColor'] === colour('light', 'primary-subtle'),
        );
        expect(rings.map((ring) => styleOf(ring)['width'])).toEqual([
          tokens.media['2xl'],
          tokens.media.xs,
        ]);
        expect(screen.getAllByRole('progressbar')).toHaveLength(2);
      },
    );
  });
});
