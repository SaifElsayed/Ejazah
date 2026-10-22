// T036: Dialog, on Radix's dialog as shadcn/ui's is (docs/design/components.md, "Primitives";
// "Dialogs that need a reason … the actions at the end"). T071: the header with an avatar or an icon
// tile and a subtitle, and the note under the actions (the decision and confirm boards).
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { inBothDirections } from './__tests__/harness';
import { Dialog } from './index';

describe('Dialog', () => {
  it('opens inside the panel frame, modal, named by its title, the actions at the end', () => {
    const cancel = vi.fn();
    const confirm = vi.fn();
    inBothDirections(
      () => (
        <Dialog
          open
          title="title"
          wide
          actions={[
            { label: 'cancel', variant: 'secondary', onPress: cancel },
            { label: 'confirm', variant: 'danger', onPress: confirm },
          ]}
        >
          <p>body</p>
        </Dialog>
      ),
      ({ frame }) => {
        const dialog = screen.getByRole('dialog', { name: 'title' });
        // Inside the frame, so the console's classes and its `dir` reach it.
        expect(frame.contains(dialog)).toBe(true);
        expect([...dialog.classList]).toEqual(['dialog', 'dialog--wide']);
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(frame.querySelector('.scrim')).not.toBeNull();
        const actions = dialog.querySelector('.dialog__actions');
        const buttons = [...(actions?.querySelectorAll('button') ?? [])];
        expect(buttons.map((button) => button.className)).toEqual([
          'btn btn--secondary btn--md',
          'btn btn--danger btn--md',
        ]);
        expect(dialog.contains(document.activeElement)).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'confirm' }));
      },
    );
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('draws a leading avatar or tile beside the title and its subtitle, and a note under the actions', () => {
    inBothDirections(
      () => (
        <Dialog
          open
          title="title"
          subtitle="subtitle"
          leading={<span className="avatar">A</span>}
          note="note"
          actions={[{ label: 'confirm', onPress: () => undefined }]}
        />
      ),
      () => {
        const dialog = screen.getByRole('dialog', { name: 'title' });
        const header = dialog.querySelector('.row.row--top.gap-3');
        expect(header?.querySelector('.avatar')?.textContent).toBe('A');
        expect(header?.querySelector('.text-caption.tone-muted')?.textContent).toBe('subtitle');
        expect(dialog.lastElementChild?.className).toBe('panel__note');
        expect(dialog.lastElementChild?.textContent).toBe('note');
      },
    );
  });

  it('is dismissed by Escape when it can be, and renders nothing closed', () => {
    const onDismiss = vi.fn();
    inBothDirections(
      () => (
        <>
          <Dialog open title="open" onDismiss={onDismiss} actions={[]} />
          <Dialog open={false} title="closed" actions={[]} />
        </>
      ),
      () => {
        expect(screen.queryByRole('dialog', { name: 'closed' })).toBeNull();
        fireEvent.keyDown(screen.getByRole('dialog', { name: 'open' }), { key: 'Escape' });
      },
    );
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('stays open on Escape when nothing may dismiss it (a binding decision)', () => {
    inBothDirections(
      () => <Dialog open title="binding" actions={[]} />,
      () => {
        const dialog = screen.getByRole('dialog', { name: 'binding' });
        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(screen.getByRole('dialog', { name: 'binding' })).toBeTruthy();
      },
    );
  });
});
