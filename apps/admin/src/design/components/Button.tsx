// T036: Button, IconButton, TextLink (docs/design/components.md, "Primitives"; design `.btn`,
// `.icon-btn`, `.link`). The panel is drawn at the compact density, so a Button is `md` unless a
// screen asks for the large one.
import clsx from 'clsx';
import type { MouseEvent } from 'react';

import { Icon } from './Icon';
import type { Accessible, IconSpec, Press } from './types';

export interface ButtonProps extends Accessible {
  readonly label: string;
  readonly variant?:
    'primary' | 'secondary' | 'ghost' | 'danger' | 'add' | 'inverse' | 'apple' | 'google';
  readonly size?: 'md' | 'lg';
  readonly layout?: 'inline' | 'block' | 'grow';
  readonly icon?: IconSpec;
  /** Busy: disabled, announced as busy, a small spinner beside the label. */
  readonly loading?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /** Submits its form instead of pressing (`type="submit"`); `onPress` still runs. */
  readonly submit?: boolean;
  readonly onPress: Press;
}

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  layout = 'inline',
  icon,
  loading = false,
  disabled = false,
  submit = false,
  onPress,
  accessibilityLabel,
}: ButtonProps) {
  return (
    <button
      type={submit ? 'submit' : 'button'}
      className={clsx(
        'btn',
        `btn--${variant}`,
        size === 'md' && 'btn--md',
        layout !== 'inline' && `btn--${layout}`,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={accessibilityLabel}
      onClick={onPress}
    >
      {loading ? <span className="spinner spinner--sm" aria-hidden="true" /> : null}
      {icon === undefined ? null : <Icon {...icon} size={icon.size ?? 'sm'} />}
      {label}
    </button>
  );
}

export interface IconButtonProps extends Required<Accessible> {
  readonly icon: IconSpec;
  readonly variant?: 'plain' | 'surface' | 'primary' | 'muted';
  /** The unread dot. */
  readonly dot?: boolean;
  readonly disabled?: boolean;
  readonly onPress: Press;
}

export function IconButton({
  icon,
  variant = 'plain',
  dot = false,
  disabled = false,
  accessibilityLabel,
  onPress,
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={clsx('icon-btn', variant !== 'plain' && `icon-btn--${variant}`)}
      disabled={disabled}
      aria-label={accessibilityLabel}
      onClick={onPress}
    >
      <Icon {...icon} />
      {dot ? <span className="icon-btn__dot" aria-hidden="true" /> : null}
    </button>
  );
}

export interface TextLinkProps extends Accessible {
  readonly label: string;
  readonly variant?: 'default' | 'muted' | 'strong';
  readonly icon?: IconSpec;
  /** Where it goes: drawn as a link, so it opens in a new tab like any link. */
  readonly href?: string;
  readonly onPress: Press;
}

/** True for a click the browser should keep: a new tab or window, or not the main button. */
export function isModifiedClick(event: MouseEvent): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

export function TextLink({
  label,
  variant = 'default',
  icon,
  href,
  onPress,
  accessibilityLabel,
}: TextLinkProps) {
  const className = clsx('link', variant !== 'default' && `link--${variant}`);
  const content = (
    <>
      {label}
      {icon === undefined ? null : <Icon {...icon} size={icon.size ?? 'sm'} />}
    </>
  );
  if (href === undefined) {
    return (
      <button type="button" className={className} aria-label={accessibilityLabel} onClick={onPress}>
        {content}
      </button>
    );
  }
  return (
    <a
      href={href}
      className={className}
      aria-label={accessibilityLabel}
      onClick={(event) => {
        if (isModifiedClick(event)) return;
        event.preventDefault();
        onPress();
      }}
    >
      {content}
    </a>
  );
}
