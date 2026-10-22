// T036: Field, Input, InputGroup, Otp, Upload (docs/design/components.md, "Primitives"). T071: a
// date Input, the browser's own, with its latest day.
import { fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { translate } from '../../i18n';
import { inBothDirections } from './__tests__/harness';
import { Field, Input, InputGroup, Otp, Upload } from './index';

describe('Field and Input', () => {
  it('names its input by its label, and ties the hint and the error to it', () => {
    inBothDirections(
      () => (
        <Field label="Email" hint="hint" error="error">
          <Input value="a@b.test" onChangeText={() => undefined} keyboard="email" ltr error />
        </Field>
      ),
      ({ view }) => {
        const input = view.getByLabelText('Email');
        expect(input.tagName).toBe('INPUT');
        expect(input.getAttribute('type')).toBe('email');
        expect([...input.classList]).toEqual(['input', 'input--md', 'input--ltr', 'input--error']);
        expect(input.getAttribute('aria-invalid')).toBe('true');
        const described = (input.getAttribute('aria-describedby') ?? '').split(' ');
        const texts = described.map((id) => document.getElementById(id)?.textContent);
        expect(texts).toEqual(['hint', 'error']);
        expect(view.getByText('error').classList.contains('field__error')).toBe(true);
      },
    );
  });

  it('reports each change, hides a secret, and grows to a text area when multiline', () => {
    const onChangeText = vi.fn();
    inBothDirections(
      () => (
        <>
          <Input
            accessibilityLabel="secret"
            value=""
            secure
            size="lg"
            onChangeText={onChangeText}
          />
          <Input accessibilityLabel="notes" value="" multiline onChangeText={onChangeText} />
        </>
      ),
      ({ view }) => {
        const secret = view.getByLabelText('secret');
        expect(secret.getAttribute('type')).toBe('password');
        expect([...secret.classList]).toEqual(['input']);
        fireEvent.change(secret, { target: { value: 'x' } });
        expect(view.getByLabelText('notes').tagName).toBe('TEXTAREA');
      },
    );
    expect(onChangeText.mock.calls).toEqual([['x'], ['x']]);
  });
});

describe('a date Input (T071)', () => {
  it('is the browser’s date field, its value YYYY-MM-DD, bounded by its latest day', () => {
    const onChangeText = vi.fn();
    inBothDirections(
      () => (
        <Field label="day">
          <Input value="" onChangeText={onChangeText} keyboard="date" max="2026-10-22" />
        </Field>
      ),
      ({ view }) => {
        const input = view.getByLabelText('day');
        expect(input.getAttribute('type')).toBe('date');
        expect(input.getAttribute('max')).toBe('2026-10-22');
        fireEvent.change(input, { target: { value: '2026-10-20' } });
      },
    );
    expect(onChangeText).toHaveBeenCalledWith('2026-10-20');
  });
});

describe('InputGroup', () => {
  it('holds an input with a leading icon and a labelled trailing button in one border', () => {
    const onPress = vi.fn();
    inBothDirections(
      () => (
        <InputGroup
          accessibilityLabel="password"
          value=""
          onChangeText={() => undefined}
          secure
          surface
          leadingIcon={{ name: 'lock' }}
          trailing={{ icon: { name: 'eye' }, accessibilityLabel: 'show', onPress }}
        />
      ),
      ({ view, frame }) => {
        const group = frame.querySelector('.input-group');
        expect([...(group?.classList ?? [])]).toEqual(['input-group', 'input-group--surface']);
        expect(view.getByLabelText('password').classList.contains('input-group__control')).toBe(
          true,
        );
        fireEvent.click(view.getByRole('button', { name: 'show' }));
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});

function ControlledOtp({ error = false }: { readonly error?: boolean }) {
  const [value, setValue] = useState('');
  return <Otp value={value} onChange={setValue} error={error} />;
}

describe('Otp', () => {
  it('is six numeric cells, each named for its digit, the first offering the one-time code', () => {
    inBothDirections(
      () => <ControlledOtp />,
      ({ view, locale }) => {
        const cells = [1, 2, 3, 4, 5, 6].map((n) =>
          view.getByLabelText(
            translate(locale, `admin.common.a11y.digit${n}` as 'admin.common.a11y.digit1'),
          ),
        );
        for (const cell of cells) expect(cell.getAttribute('inputmode')).toBe('numeric');
        expect(cells[0]?.getAttribute('autocomplete')).toBe('one-time-code');
        expect(cells[0]?.classList.contains('otp__cell--active')).toBe(true);
      },
    );
  });

  it('fills a digit and moves on, ignores anything else, and takes a pasted code whole', () => {
    inBothDirections(
      () => <ControlledOtp />,
      ({ frame }) => {
        const cells = () => [...frame.querySelectorAll<HTMLInputElement>('.otp__cell')];
        fireEvent.change(cells()[0] as HTMLInputElement, { target: { value: '4' } });
        expect(cells()[0]?.value).toBe('4');
        expect(cells()[0]?.classList.contains('otp__cell--filled')).toBe(true);
        expect(document.activeElement).toBe(cells()[1]);
        fireEvent.change(cells()[1] as HTMLInputElement, { target: { value: 'a' } });
        expect(cells()[1]?.value).toBe('');
        fireEvent.paste(cells()[1] as HTMLInputElement, {
          clipboardData: { getData: () => '123 456' },
        });
        expect(
          cells()
            .map((cell) => cell.value)
            .join(''),
        ).toBe('123456');
      },
    );
  });

  it('steps back on Backspace in an empty cell, clearing the digit before it', () => {
    inBothDirections(
      () => <ControlledOtp />,
      ({ frame }) => {
        const cells = () => [...frame.querySelectorAll<HTMLInputElement>('.otp__cell')];
        fireEvent.change(cells()[0] as HTMLInputElement, { target: { value: '7' } });
        fireEvent.keyDown(cells()[1] as HTMLInputElement, { key: 'Backspace' });
        expect(cells()[0]?.value).toBe('');
        expect(document.activeElement).toBe(cells()[0]);
      },
    );
  });

  it('marks every cell in error', () => {
    inBothDirections(
      () => <ControlledOtp error />,
      ({ frame }) => {
        for (const cell of frame.querySelectorAll('.otp__cell')) {
          expect(cell.classList.contains('otp__cell--error')).toBe(true);
          expect(cell.getAttribute('aria-invalid')).toBe('true');
        }
      },
    );
  });
});

describe('Upload', () => {
  it('is a dashed target that becomes done, with its label and hint', () => {
    const onPress = vi.fn();
    inBothDirections(
      () => <Upload label="label" hint="hint" tile done onPress={onPress} />,
      ({ view }) => {
        const target = view.getByRole('button', { name: /label/ });
        expect([...target.classList]).toEqual(['upload', 'upload--tile', 'upload--done']);
        expect(target.textContent).toContain('hint');
        fireEvent.click(target);
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});
