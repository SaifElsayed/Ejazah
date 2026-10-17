import type { Accessible, Content, IconSpec, Press } from './types';

/**
 * Field: a label, a control, a hint and an error. `label` is required and doubles as the
 * accessibility label. `error` is already-localised copy; the component never maps an error code.
 * Design: `.field`, `.field__label`, `.field__hint`, `.field__error`.
 */
export interface FieldProps {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly children: Content;
}

/**
 * Input: a single-line or multi-line text control at the control height (`lg` 52 by default,
 * `md` 44). `ltr` keeps an email, a code or a number left-to-right inside Arabic. Design: `.input`,
 * `.input--md`, `.input--ltr`, `.input--error`, `textarea.input`.
 */
export interface InputProps extends Accessible {
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder?: string;
  readonly size?: 'md' | 'lg';
  readonly ltr?: boolean;
  readonly multiline?: boolean;
  readonly keyboard?: 'default' | 'email' | 'numeric' | 'phone';
  readonly secure?: boolean;
  readonly error?: boolean;
  readonly disabled?: boolean;
}

/**
 * InputGroup: an input with a leading icon or a trailing button inside one border (search, a
 * password with its eye). Design: `.input-group`, `.input-group--surface`, `.input-group__control`.
 */
export interface InputGroupProps extends InputProps {
  readonly leadingIcon?: IconSpec;
  readonly trailing?: {
    readonly icon: IconSpec;
    readonly accessibilityLabel: string;
    readonly onPress: Press;
  };
  readonly surface?: boolean;
}

/**
 * Otp: six cells, left-to-right, auto-advancing, one value. Design: `.otp`, `.otp__cell`,
 * `.otp__cell--filled|active|error`.
 */
export interface OtpProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly length?: 6;
  readonly error?: boolean;
}

/**
 * Upload: a dashed target for a document; `done` once a file is chosen. The tile form stands in a
 * grid. Opening the system picker is the app's job, not the component's. Design: `.upload`,
 * `.upload--tile`, `.upload--done`.
 */
export interface UploadProps extends Accessible {
  readonly label: string;
  readonly hint?: string;
  readonly icon?: IconSpec;
  readonly tile?: boolean;
  readonly done?: boolean;
  readonly onPress: Press;
}

/** FileRow: an uploaded document: its name, size or date, and a remove or view action. Design: `.file`. */
export interface FileRowProps {
  readonly name: string;
  readonly meta?: string;
  readonly action?: {
    readonly icon: IconSpec;
    readonly accessibilityLabel: string;
    readonly onPress: Press;
  };
}

/**
 * StarInput: the rating control: five stars drawn in the rating colour (never gold), chosen by
 * tapping, 1 to 5. Design: `.star-input`, `.star-input--on`.
 */
export interface StarInputProps extends Required<Accessible> {
  readonly value: 0 | 1 | 2 | 3 | 4 | 5;
  readonly onChange: (value: 1 | 2 | 3 | 4 | 5) => void;
}

/** Rating: stars with the average and the count, read-only. Design: `.rating`. */
export interface RatingProps {
  readonly average: number;
  readonly count: number;
  /** Stars only, no numbers (the review list). */
  readonly compact?: boolean;
}

/**
 * SignaturePad: the teacher's signature image, or the dashed target to add one. Design:
 * `.signature-pad`, `.signature-pad--done`.
 */
export interface SignaturePadProps extends Accessible {
  readonly imageUri?: string;
  readonly onPress: Press;
}
