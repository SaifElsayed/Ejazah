// 006:T021 (B-P4's conflict check, Q-7, the owner's design, 2026-11-25: «لكل الزراير»): the «i»
// button, a piece of the panel's design system. A small muted icon button (IconButton's `muted`),
// named for what it explains, its hover hint the browser's own tooltip on its frame («اضغط للشرح»);
// a press opens a Dialog titled by what it explains, the explanation one paragraph per line, and one
// action that closes it, Escape too. It changes nothing: it only explains. The words come from the
// page that draws it; the piece holds none.
import { useState } from 'react';

import { IconButton } from './Button';
import { IconTile } from './Containers';
import { Dialog } from './Dialog';

export interface InfoButtonProps {
  /** The hover hint («اضغط للشرح»). */
  readonly hint: string;
  /** The button's accessible name, naming what it explains. */
  readonly accessibilityLabel: string;
  /** The dialog's title: what is explained. */
  readonly title: string;
  /** The explanation; each line is a paragraph. */
  readonly text: string;
  /** The dialog's one action. */
  readonly closeLabel: string;
}

export function InfoButton({ hint, accessibilityLabel, title, text, closeLabel }: InfoButtonProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <span title={hint}>
        <IconButton
          icon={{ name: 'info', size: 'sm' }}
          variant="muted"
          accessibilityLabel={accessibilityLabel}
          onPress={() => setOpen(true)}
        />
      </span>
      {open ? (
        <Dialog
          open
          title={title}
          leading={<IconTile icon={{ name: 'info' }} tone="primary" />}
          onDismiss={close}
          actions={[{ label: closeLabel, variant: 'secondary', onPress: close }]}
        >
          <div className="stack gap-2">
            {text.split('\n').map((paragraph) => (
              <p key={paragraph} className="text-callout">
                {paragraph}
              </p>
            ))}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
