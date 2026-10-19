// T036: Dialog, on Radix's dialog, which is shadcn/ui's (ADR 0014 D1: shadcn/ui is the behaviour
// base: the focus trap, the inert background, the restored focus), drawn with the design's
// `.scrim` and `.dialog` (docs/design/components.md, "Primitives"). It opens inside the Console's
// frame, so the console's classes and its `dir` reach it. A decision that binds may not be
// dismissed by Escape or a click outside: only a dialog given `onDismiss` can be.
import clsx from 'clsx';
import { Dialog as DialogPrimitive } from 'radix-ui';

import { Button } from './Button';
import { useConsoleFrame } from './Console';
import type { Content, Press } from './types';

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly children?: Content;
  /** At the end, in order: the cancel first, the decision last. */
  readonly actions: readonly {
    readonly label: string;
    readonly variant?: 'primary' | 'secondary' | 'danger';
    readonly disabled?: boolean;
    readonly loading?: boolean;
    readonly onPress: Press;
  }[];
  /** Escape and a click on the scrim call it; without it they do nothing. */
  readonly onDismiss?: Press;
  /** Two panels wide (the credential review, the document viewer). */
  readonly wide?: boolean;
}

export function Dialog({ open, title, children, actions, onDismiss, wide = false }: DialogProps) {
  const frame = useConsoleFrame();
  const refuse = (event: Event) => {
    if (onDismiss === undefined) event.preventDefault();
  };
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss?.();
      }}
    >
      <DialogPrimitive.Portal container={frame ?? undefined}>
        <DialogPrimitive.Overlay className="scrim" />
        <DialogPrimitive.Content
          asChild
          aria-describedby={undefined}
          onEscapeKeyDown={refuse}
          onPointerDownOutside={refuse}
          onInteractOutside={refuse}
        >
          <section className={clsx('dialog', wide && 'dialog--wide')} aria-modal="true">
            <DialogPrimitive.Title asChild>
              <h2 className="dialog__title">{title}</h2>
            </DialogPrimitive.Title>
            {children}
            <div className="dialog__actions">
              {actions.map((action) => (
                <Button
                  key={action.label}
                  label={action.label}
                  variant={action.variant ?? 'primary'}
                  disabled={action.disabled}
                  loading={action.loading}
                  onPress={action.onPress}
                />
              ))}
            </div>
          </section>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
