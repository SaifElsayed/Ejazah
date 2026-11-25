// 006:T021 (B-P4's conflict check, Q-7, the owner's design, 2026-11-25: «لكل الزراير»): the «i»
// button. A small muted icon button, named for what it explains, whose hover hint says to press it
// («اضغط للشرح»); a press opens a dialog titled by what it explains, with the explanation, each line
// of it a paragraph, and one action that closes it (Escape too). Drawn in both directions under the
// design's rules.
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { inBothDirections } from './__tests__/harness';
import { InfoButton } from './index';

const props = {
  hint: 'hint',
  accessibilityLabel: 'explain setting',
  title: 'setting',
  text: 'first line\nsecond line',
  closeLabel: 'close',
} as const;

describe('InfoButton', () => {
  it('draws a muted «i» button named for what it explains, its hint on hover, and no dialog yet', () => {
    inBothDirections(
      () => <InfoButton {...props} />,
      ({ view }) => {
        const button = view.getByRole('button', { name: 'explain setting' });
        expect([...button.classList]).toEqual(['icon-btn', 'icon-btn--muted']);
        expect(button.querySelector('svg.lucide-info')).not.toBeNull();
        expect(button.closest('[title]')?.getAttribute('title')).toBe('hint');
        expect(screen.queryByRole('dialog')).toBeNull();
      },
    );
  });

  it('opens the explanation on a press, each line a paragraph, and closes it by its action', () => {
    inBothDirections(
      () => <InfoButton {...props} />,
      ({ view }) => {
        fireEvent.click(view.getByRole('button', { name: 'explain setting' }));
        const dialog = within(screen.getByRole('dialog', { name: 'setting' }));
        expect(
          dialog
            .getAllByText(/line$/)
            .map((paragraph) => [paragraph.tagName, paragraph.textContent]),
        ).toEqual([
          ['P', 'first line'],
          ['P', 'second line'],
        ]);
        fireEvent.click(dialog.getByRole('button', { name: 'close' }));
        expect(screen.queryByRole('dialog')).toBeNull();
      },
    );
  });

  it('closes on Escape', () => {
    inBothDirections(
      () => <InfoButton {...props} />,
      ({ view }) => {
        fireEvent.click(view.getByRole('button', { name: 'explain setting' }));
        fireEvent.keyDown(screen.getByRole('dialog', { name: 'setting' }), { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
      },
    );
  });
});
