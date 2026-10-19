// T036: Icon, Button, IconButton, TextLink (docs/design/components.md, "Primitives").
import { fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { inBothDirections } from './__tests__/harness';
import { Button, Icon, IconButton, TextLink } from './index';

describe('Icon', () => {
  it('draws a registry icon at a token size, hidden from the screen reader by default', () => {
    inBothDirections(
      () => <Icon name="shield-check" size="lg" />,
      ({ frame }) => {
        const svg = frame.querySelector('svg');
        expect(svg?.classList.contains('icon')).toBe(true);
        expect(svg?.classList.contains('icon--lg')).toBe(true);
        expect(svg?.getAttribute('aria-hidden')).toBe('true');
      },
    );
  });

  it('is announced when it carries a label', () => {
    inBothDirections(
      () => <Icon name="info" accessibilityLabel="label" />,
      ({ view }) => expect(view.getByRole('img', { name: 'label' })).toBeTruthy(),
    );
  });

  it('marks a directional icon to mirror, and only a directional one', () => {
    inBothDirections(
      () => (
        <>
          <Icon name="chevron-left" />
          <Icon name="check" />
        </>
      ),
      ({ frame }) => {
        const [chevron, check] = frame.querySelectorAll('svg');
        expect(chevron?.classList.contains('icon--flip')).toBe(true);
        expect(check?.classList.contains('icon--flip')).toBe(false);
      },
    );
  });

  it('draws the stroke weight, the fill and the tone as classes', () => {
    inBothDirections(
      () => <Icon name="star" stroke="medium" fill="filled" tone="danger" />,
      ({ frame }) => {
        const classes = frame.querySelector('svg')?.classList;
        expect(classes?.contains('icon--medium')).toBe(true);
        expect(classes?.contains('icon--filled')).toBe(true);
        expect(classes?.contains('tone-danger')).toBe(true);
      },
    );
  });
});

describe('Button', () => {
  it('is a button of its variant and size, with its label and icon', () => {
    const onPress = vi.fn();
    inBothDirections(
      () => (
        <Button
          label="label"
          variant="secondary"
          size="lg"
          layout="block"
          icon={{ name: 'plus' }}
          onPress={onPress}
        />
      ),
      ({ view }) => {
        const button = view.getByRole('button', { name: 'label' });
        expect(button.getAttribute('type')).toBe('button');
        expect([...button.classList]).toEqual(['btn', 'btn--secondary', 'btn--block']);
        expect(button.querySelector('svg.icon')).not.toBeNull();
        fireEvent.click(button);
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('is primary and compact by default, as the panel draws it', () => {
    inBothDirections(
      () => <Button label="label" onPress={() => undefined} />,
      ({ view }) =>
        expect([...view.getByRole('button').classList]).toEqual(['btn', 'btn--primary', 'btn--md']),
    );
  });

  it('does nothing while disabled or loading, and says it is busy', () => {
    const onPress = vi.fn();
    inBothDirections(
      () => (
        <>
          <Button label="off" disabled onPress={onPress} />
          <Button label="busy" loading onPress={onPress} />
        </>
      ),
      ({ view }) => {
        const off = view.getByRole('button', { name: 'off' });
        const busy = view.getByRole('button', { name: 'busy' });
        expect(off.hasAttribute('disabled')).toBe(true);
        expect(busy.hasAttribute('disabled')).toBe(true);
        expect(busy.getAttribute('aria-busy')).toBe('true');
        expect(busy.querySelector('.spinner.spinner--sm')).not.toBeNull();
        fireEvent.click(off);
        fireEvent.click(busy);
      },
    );
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('IconButton', () => {
  it('is a labelled square button of its variant, with the dot when asked', () => {
    const onPress = vi.fn();
    inBothDirections(
      () => (
        <IconButton
          icon={{ name: 'bell' }}
          variant="surface"
          dot
          accessibilityLabel="label"
          onPress={onPress}
        />
      ),
      ({ view }) => {
        const button = view.getByRole('button', { name: 'label' });
        expect([...button.classList]).toEqual(['icon-btn', 'icon-btn--surface']);
        expect(button.querySelector('.icon-btn__dot')).not.toBeNull();
        fireEvent.click(button);
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});

describe('TextLink', () => {
  it('is a link when it goes somewhere, a button otherwise, in its variant', () => {
    const onPress = vi.fn();
    inBothDirections(
      () => (
        <>
          <TextLink label="go" href="/audit" variant="strong" onPress={onPress} />
          <TextLink label="act" variant="muted" onPress={onPress} />
        </>
      ),
      ({ view, frame }) => {
        const link = within(frame).getByRole('link', { name: 'go' });
        expect(link.getAttribute('href')).toBe('/audit');
        expect([...link.classList]).toEqual(['link', 'link--strong']);
        expect([...view.getByRole('button', { name: 'act' }).classList]).toEqual([
          'link',
          'link--muted',
        ]);
        fireEvent.click(link);
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('leaves a modified click to the browser (a new tab), and takes a plain one', () => {
    const onPress = vi.fn();
    inBothDirections(
      () => <TextLink label="go" href="/audit" onPress={onPress} />,
      ({ view }) => {
        const link = view.getByRole('link', { name: 'go' });
        fireEvent.click(link, { ctrlKey: true });
        fireEvent.click(link, { metaKey: true });
        expect(onPress).not.toHaveBeenCalled();
        const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
        link.dispatchEvent(plain);
        expect(plain.defaultPrevented).toBe(true);
        expect(onPress).toHaveBeenCalledTimes(1);
        onPress.mockClear();
      },
    );
  });
});
