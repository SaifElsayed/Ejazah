import { createContext, useContext, useState } from 'react';
import { Pressable, TextInput, View, type KeyboardTypeOptions, type TextStyle } from 'react-native';

import { useTheme } from '../theme';
import { PressableIcon } from './Button';
import { Glyph } from './Icon';
import { border, pressed, radius, size, space, type } from './style';
import { Words } from './Text';
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

// ---------------------------------------------------------------------------------------------
// T032: the implementations. StarInput, Rating and SignaturePad are contracts of later phases'
// screens and are implemented with them.

/** What a Field tells the control inside it: its label is the control's accessible name. */
const FieldContext = createContext<{ readonly label?: string; readonly error: boolean }>({
  error: false,
});

export function Field({ label, hint, error, children }: FieldProps) {
  return (
    <FieldContext.Provider value={{ label, error: error !== undefined }}>
      <View style={{ gap: space['2'] }}>
        <Words variant="callout" weight="medium" color="text">
          {label}
        </Words>
        {children}
        {hint === undefined ? null : (
          <Words variant="caption" color="text-muted">
            {hint}
          </Words>
        )}
        {error === undefined ? null : (
          <Words variant="caption" color="danger">
            {error}
          </Words>
        )}
      </View>
    </FieldContext.Provider>
  );
}

const keyboards: Readonly<Record<NonNullable<InputProps['keyboard']>, KeyboardTypeOptions>> = {
  default: 'default',
  email: 'email-address',
  numeric: 'number-pad',
  phone: 'phone-pad',
};

/** The control's own props, shared by Input and the control inside an InputGroup. */
function controlProps(props: InputProps, accessibilityLabel: string | undefined) {
  const {
    value,
    onChangeText,
    placeholder,
    ltr = false,
    multiline = false,
    keyboard = 'default',
    secure = false,
    disabled = false,
  } = props;
  const literal = ltr || keyboard === 'email' || secure;
  return {
    value,
    onChangeText,
    ...(placeholder === undefined ? {} : { placeholder }),
    ...(accessibilityLabel === undefined ? {} : { accessibilityLabel }),
    multiline,
    secureTextEntry: secure,
    keyboardType: keyboards[keyboard],
    // An address, a code or a password is typed as it is: no capital, no correction.
    ...(literal ? { autoCapitalize: 'none' as const, autoCorrect: false } : {}),
    editable: !disabled,
    accessibilityState: { disabled },
  };
}

export function Input(props: InputProps) {
  const { color } = useTheme();
  const field = useContext(FieldContext);
  const [focused, setFocused] = useState(false);
  const {
    size: height = 'lg',
    ltr = false,
    multiline = false,
    error = false,
    disabled = false,
  } = props;
  const invalid = error || field.error;
  const style: TextStyle = {
    alignSelf: 'stretch',
    paddingHorizontal: space['4'],
    borderWidth: focused || invalid ? border.selected : border.hairline,
    borderColor: invalid ? color.danger : focused ? color.primary : color['border-strong'],
    borderRadius: radius.md,
    backgroundColor: disabled ? color.surface : color.bg,
    color: disabled ? color['text-muted'] : color.text,
    ...(multiline
      ? { ...type('body'), paddingVertical: space['3'], textAlignVertical: 'top' }
      : {
          height: height === 'lg' ? size['control-lg'] : size['control-md'],
          fontSize: type(height === 'lg' ? 'body-lg' : 'body').fontSize,
        }),
    ...(ltr ? { writingDirection: 'ltr' } : {}),
  };
  return (
    <TextInput
      {...controlProps(props, props.accessibilityLabel ?? field.label)}
      placeholderTextColor={color['text-subtle']}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={style}
    />
  );
}

export function InputGroup(props: InputGroupProps) {
  const { color } = useTheme();
  const field = useContext(FieldContext);
  const [focused, setFocused] = useState(false);
  const { leadingIcon, trailing, surface = false, ltr = false, error = false } = props;
  const invalid = error || field.error;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'stretch',
        gap: space['2'],
        height: props.size === 'md' ? size['control-md'] : size['control-lg'],
        paddingStart: space['4'],
        paddingEnd: space['1'],
        borderWidth: focused || invalid ? border.selected : border.hairline,
        borderColor: invalid
          ? color.danger
          : focused
            ? color.primary
            : surface
              ? color.border
              : color['border-strong'],
        borderRadius: radius.md,
        backgroundColor: surface ? color.surface : color.bg,
      }}
    >
      {leadingIcon === undefined ? null : <Glyph {...leadingIcon} color="text-muted" />}
      <TextInput
        {...controlProps(props, props.accessibilityLabel ?? field.label)}
        placeholderTextColor={color['text-subtle']}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          flex: 1,
          minWidth: 0,
          alignSelf: 'stretch',
          fontSize: type('body-lg').fontSize,
          color: color.text,
          ...(ltr ? { writingDirection: 'ltr' as const } : {}),
        }}
      />
      {trailing === undefined ? null : (
        <PressableIcon
          icon={trailing.icon}
          variant="muted"
          accessibilityLabel={trailing.accessibilityLabel}
          onPress={trailing.onPress}
        />
      )}
    </View>
  );
}

const OTP_LENGTH = 6;
const NOT_A_DIGIT = /[^0-9]/g;

/**
 * Six cells over one hidden field that holds the code: typing fills the next cell, a paste or the
 * system's code suggestion fills them all, and the cells read left to right in either direction.
 */
export function Otp({ value, onChange, error = false }: OtpProps) {
  const { color } = useTheme();
  const digits = value.replace(NOT_A_DIGIT, '').slice(0, OTP_LENGTH);
  // The cell the next digit goes into; none once the code is complete.
  const next = digits.length < OTP_LENGTH ? digits.length : -1;
  return (
    <View style={{ direction: 'ltr', alignSelf: 'center' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space['2'] }}>
        {Array.from({ length: OTP_LENGTH }, (_, index) => {
          const filled = index < digits.length;
          const active = index === next;
          return (
            <View
              key={index}
              style={{
                width: size['otp-width'],
                height: size['otp-height'],
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: active || error ? border.selected : border.hairline,
                borderRadius: radius.md,
                borderColor: error
                  ? color.danger
                  : active
                    ? color.primary
                    : filled
                      ? color.border
                      : color['border-strong'],
                backgroundColor: filled ? color.surface : color.bg,
              }}
            >
              <Words variant="title-1" weight="regular" color="text">
                {digits[index] ?? ''}
              </Words>
            </View>
          );
        })}
      </View>
      <TextInput
        testID="otp-input"
        value={digits}
        onChangeText={(typed) => onChange(typed.replace(NOT_A_DIGIT, '').slice(0, OTP_LENGTH))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={OTP_LENGTH}
        caretHidden
        // Covers the cells, transparent, so a tap anywhere on them focuses it.
        style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, opacity: 0 }}
      />
    </View>
  );
}

export function Upload({
  label,
  hint,
  icon,
  tile = false,
  done = false,
  accessibilityLabel,
  onPress,
}: UploadProps) {
  const { color } = useTheme();
  const tint = done ? 'primary-strong' : 'text';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      {...(hint === undefined ? {} : { accessibilityHint: hint })}
      onPress={onPress}
      style={({ pressed: down }) => [
        {
          flexDirection: tile ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: tile ? 'center' : 'flex-start',
          gap: tile ? space['2'] : space['3'],
          borderWidth: border.hairline,
          borderStyle: done ? 'solid' : 'dashed',
          borderColor: done ? color['primary-border'] : color['border-strong'],
          borderRadius: radius.md,
          backgroundColor: done ? color['primary-subtle'] : 'transparent',
        },
        tile
          ? { height: size['upload-tile'], padding: space['2'] }
          : {
              minHeight: size['control-lg'],
              paddingVertical: space['3'],
              paddingHorizontal: space['4'],
            },
        down ? pressed : null,
      ]}
    >
      <Glyph
        {...(icon ?? { name: done ? 'circle-check' : 'upload' })}
        color={done ? 'primary' : 'text-muted'}
      />
      <View style={tile ? { alignItems: 'center' } : { flex: 1, minWidth: 0 }}>
        <Words
          variant={tile ? 'caption' : 'body'}
          weight="medium"
          color={tint}
          align={tile ? 'center' : 'start'}
        >
          {label}
        </Words>
        {hint === undefined ? null : (
          <Words variant="caption" color="text-muted" align={tile ? 'center' : 'start'}>
            {hint}
          </Words>
        )}
      </View>
    </Pressable>
  );
}

export function FileRow({ name, meta, action }: FileRowProps) {
  const { color } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space['3'],
        paddingVertical: space['2'],
        paddingStart: space['3'],
        paddingEnd: space['2'],
        borderWidth: border.hairline,
        borderColor: color.border,
        borderRadius: radius.md,
        backgroundColor: color.bg,
      }}
    >
      <Glyph name="file-text" color="text-muted" />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Words weight="medium" color="text" numberOfLines={1}>
          {name}
        </Words>
        {meta === undefined ? null : (
          <Words variant="caption" color="text-muted">
            {meta}
          </Words>
        )}
      </View>
      {action === undefined ? null : (
        <PressableIcon
          icon={action.icon}
          variant="muted"
          accessibilityLabel={action.accessibilityLabel}
          onPress={action.onPress}
        />
      )}
    </View>
  );
}
