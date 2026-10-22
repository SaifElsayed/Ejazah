// T036: Field, Input, InputGroup, Otp, Upload (docs/design/components.md, "Primitives"; design
// `.field`, `.input`, `.input-group`, `.otp`, `.upload`). A Field names the control inside it by its
// label and ties its hint and its error to it (`aria-describedby`), so a screen never wires ids.
import clsx from 'clsx';
import {
  type ChangeEvent,
  type ClipboardEvent,
  createContext,
  type KeyboardEvent,
  useContext,
  useId,
  useRef,
} from 'react';

import { type MessageKey, useT } from '../../i18n';
import { Icon } from './Icon';
import type { Accessible, Content, IconSpec, Press } from './types';

interface FieldWiring {
  readonly id: string;
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
}

const FieldContext = createContext<FieldWiring | null>(null);

export interface FieldProps {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly children: Content;
}

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint === undefined ? null : hintId, error === undefined ? null : errorId]
      .filter((part) => part !== null)
      .join(' ') || undefined;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <FieldContext.Provider value={{ id, describedBy, invalid: error !== undefined }}>
        {children}
      </FieldContext.Provider>
      {hint === undefined ? null : (
        <span id={hintId} className="field__hint">
          {hint}
        </span>
      )}
      {error === undefined ? null : (
        <span id={errorId} className="field__error">
          {error}
        </span>
      )}
    </div>
  );
}

export interface InputProps extends Accessible {
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder?: string;
  /** Compact (`md`) by default, as the panel draws its forms. */
  readonly size?: 'md' | 'lg';
  /** A left-to-right value (an email, a code, a reference), isolated inside Arabic. */
  readonly ltr?: boolean;
  readonly multiline?: boolean;
  /** `date` is the browser's date field, its value `YYYY-MM-DD` (T071, the call's day). */
  readonly keyboard?: 'default' | 'email' | 'numeric' | 'phone' | 'date';
  /** The latest value a date field takes (`YYYY-MM-DD`). */
  readonly max?: string;
  readonly secure?: boolean;
  readonly error?: boolean;
  readonly disabled?: boolean;
}

const INPUT_TYPE = {
  default: 'text',
  email: 'email',
  numeric: 'text',
  phone: 'tel',
  date: 'date',
} as const;
const INPUT_MODE = {
  default: 'text',
  email: 'email',
  numeric: 'numeric',
  phone: 'tel',
  date: undefined,
} as const;

/** The attributes a control shares with the Field around it. */
function useControlWiring(error: boolean) {
  const field = useContext(FieldContext);
  const invalid = error || field?.invalid === true;
  return {
    id: field?.id,
    'aria-describedby': field?.describedBy,
    'aria-invalid': invalid || undefined,
    invalid,
  };
}

export function Input({
  value,
  onChangeText,
  placeholder,
  size = 'md',
  ltr = false,
  multiline = false,
  keyboard = 'default',
  secure = false,
  error = false,
  disabled = false,
  max,
  accessibilityLabel,
}: InputProps) {
  const { invalid, ...wiring } = useControlWiring(error);
  const className = clsx(
    'input',
    size === 'md' && 'input--md',
    ltr && 'input--ltr',
    invalid && 'input--error',
  );
  const shared = {
    ...wiring,
    className,
    value,
    placeholder,
    disabled,
    'aria-label': accessibilityLabel,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChangeText(event.target.value),
  };
  if (multiline) return <textarea {...shared} rows={3} />;
  return (
    <input
      {...shared}
      type={secure ? 'password' : INPUT_TYPE[keyboard]}
      inputMode={INPUT_MODE[keyboard]}
      max={max}
    />
  );
}

export interface InputGroupProps extends InputProps {
  readonly leadingIcon?: IconSpec;
  readonly trailing?: {
    readonly icon: IconSpec;
    readonly accessibilityLabel: string;
    readonly onPress: Press;
  };
  /** The surface fill the search fields use. */
  readonly surface?: boolean;
}

/** An input with a leading icon or a trailing button inside one border. */
export function InputGroup({
  leadingIcon,
  trailing,
  surface = false,
  value,
  onChangeText,
  placeholder,
  ltr = false,
  keyboard = 'default',
  secure = false,
  error = false,
  disabled = false,
  accessibilityLabel,
}: InputGroupProps) {
  const { invalid, ...wiring } = useControlWiring(error);
  return (
    <div className={clsx('input-group', surface && 'input-group--surface')}>
      {leadingIcon === undefined ? null : <Icon {...leadingIcon} size="sm" />}
      <input
        {...wiring}
        className={clsx('input-group__control', ltr && 'input--ltr')}
        type={secure ? 'password' : INPUT_TYPE[keyboard]}
        inputMode={INPUT_MODE[keyboard]}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={accessibilityLabel}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChangeText(event.target.value)}
      />
      {trailing === undefined ? null : (
        <button
          type="button"
          className="icon-btn icon-btn--muted"
          aria-label={trailing.accessibilityLabel}
          onClick={trailing.onPress}
        >
          <Icon {...trailing.icon} />
        </button>
      )}
    </div>
  );
}

export interface OtpProps {
  /** The digits entered so far, from the first cell. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly length?: 6;
  readonly error?: boolean;
}

const DIGIT_LABELS = [
  'admin.common.a11y.digit1',
  'admin.common.a11y.digit2',
  'admin.common.a11y.digit3',
  'admin.common.a11y.digit4',
  'admin.common.a11y.digit5',
  'admin.common.a11y.digit6',
] as const satisfies readonly MessageKey[];

const digitsOf = (text: string) => text.replace(/\D/g, '');

/**
 * Six cells, left to right in both languages (`.otp`), each one digit. A digit moves to the next
 * cell; anything else is ignored; Backspace in an empty cell clears the one before; a pasted or
 * autofilled whole code replaces the code, and a part of one fills on from where it lands.
 */
export function Otp({ value, onChange, length = 6, error = false }: OtpProps) {
  const t = useT();
  const cells = useRef<(HTMLInputElement | null)[]>([]);
  const focus = (index: number) => cells.current[Math.min(index, length - 1)]?.focus();

  const fill = (from: number, digits: string) => {
    // A whole code replaces what was there, wherever it lands; a part continues from its cell.
    const next = (digits.length >= length ? digits : value.slice(0, from) + digits).slice(
      0,
      length,
    );
    onChange(next);
    focus(next.length);
  };

  const onCellChange = (index: number, event: ChangeEvent<HTMLInputElement>) => {
    const previous = value[index];
    let digits = digitsOf(event.target.value);
    if (event.target.value !== '' && digits === '') return;
    if (digits === '') {
      onChange(value.slice(0, index));
      return;
    }
    // A digit typed into a filled cell arrives beside the old one: keep the new one.
    if (previous !== undefined && digits.length === 2)
      digits = digits.replace(previous, '') || previous;
    if (digits.length > 1) {
      fill(index, digits);
      return;
    }
    const start = Math.min(index, value.length);
    const next = (value.slice(0, start) + digits + value.slice(start + 1)).slice(0, length);
    onChange(next);
    focus(start + 1);
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Backspace' || value[index] !== undefined || index === 0) return;
    event.preventDefault();
    onChange(value.slice(0, index - 1));
    focus(index - 1);
  };

  const onPaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const digits = digitsOf(event.clipboardData.getData('text'));
    if (digits !== '') fill(Math.min(index, value.length), digits);
  };

  return (
    <div className="otp">
      {DIGIT_LABELS.slice(0, length).map((label, index) => {
        const digit = value[index] ?? '';
        return (
          <input
            key={label}
            ref={(cell) => {
              cells.current[index] = cell;
            }}
            className={clsx(
              'otp__cell',
              digit !== '' && 'otp__cell--filled',
              index === value.length && 'otp__cell--active',
              error && 'otp__cell--error',
            )}
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            value={digit}
            aria-label={t(label)}
            aria-invalid={error || undefined}
            onChange={(event) => onCellChange(index, event)}
            onKeyDown={(event) => onKeyDown(index, event)}
            onPaste={(event) => onPaste(index, event)}
          />
        );
      })}
    </div>
  );
}

export interface UploadProps extends Accessible {
  readonly label: string;
  readonly hint?: string;
  readonly icon?: IconSpec;
  /** The square tile of a document grid. */
  readonly tile?: boolean;
  readonly done?: boolean;
  readonly onPress: Press;
}

/** A dashed target for a document. */
export function Upload({
  label,
  hint,
  icon = { name: 'upload' },
  tile = false,
  done = false,
  onPress,
  accessibilityLabel,
}: UploadProps) {
  return (
    <button
      type="button"
      className={clsx('upload', tile && 'upload--tile', done && 'upload--done')}
      aria-label={accessibilityLabel}
      onClick={onPress}
    >
      <Icon {...icon} />
      <span>{label}</span>
      {hint === undefined ? null : <span className="field__hint">{hint}</span>}
    </button>
  );
}
