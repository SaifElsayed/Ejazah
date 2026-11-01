// T032: the selection primitives (R-MOBILE-4/5/6): Segmented, Chip, CheckRow, Choice, Picker and
// Select, each announcing its state, in both directions.
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';

import { tokens } from '../tokens';
import { colour, inBothDirections, styleOf } from './__tests__/harness';
import { CheckRow, Chip, Choice, Picker, Segmented, Select } from './index';

describe('Segmented', () => {
  const options = [
    { value: 'ar', label: 'العربية' },
    { value: 'en', label: 'English' },
  ];

  it('marks the selected option and reports a change', async () => {
    const onChange = jest.fn();
    await inBothDirections(
      () => (
        <Segmented options={options} value="ar" onChange={onChange} accessibilityLabel="اللغة" />
      ),
      async () => {
        expect(screen.getByLabelText('اللغة')).toBeTruthy();
        const selected = screen.getByRole('radio', { name: 'العربية' });
        expect(selected.props['accessibilityState']).toMatchObject({ checked: true });
        expect(styleOf(selected)['backgroundColor']).toBe(colour('light', 'bg'));
        expect(styleOf(selected)['height']).toBe(tokens.size.touch);
        const other = screen.getByRole('radio', { name: 'English' });
        expect(other.props['accessibilityState']).toMatchObject({ checked: false });
        await fireEvent.press(other);
      },
    );
    expect(onChange).toHaveBeenCalledWith('en');
  });

  it('fills the row, or hugs its content inline', async () => {
    await inBothDirections(
      () => (
        <>
          <Segmented
            options={options}
            value="ar"
            onChange={() => undefined}
            accessibilityLabel="fill"
          />
          <Segmented
            options={options}
            value="ar"
            onChange={() => undefined}
            accessibilityLabel="inline"
            inline
          />
        </>
      ),
      () => {
        expect(styleOf(screen.getByLabelText('fill'))['alignSelf']).toBe('stretch');
        expect(styleOf(screen.getByLabelText('inline'))['alignSelf']).toBe('flex-start');
      },
    );
  });
});

describe('Chip', () => {
  it('is a pill at the touch height; selected in the primary colours', async () => {
    await inBothDirections(
      () => (
        <>
          <Chip label="تجويد" onPress={() => undefined} />
          <Chip label="حفظ" selected onPress={() => undefined} />
        </>
      ),
      () => {
        const plain = screen.getByRole('button', { name: 'تجويد' });
        expect(styleOf(plain)['height']).toBe(tokens.size.touch);
        expect(styleOf(plain)['borderRadius']).toBe(tokens.radius.full);
        const selected = screen.getByRole('button', { name: 'حفظ' });
        expect(selected.props['accessibilityState']).toMatchObject({ selected: true });
        expect(styleOf(selected)['backgroundColor']).toBe(colour('light', 'primary-subtle'));
      },
    );
  });

  it('shows the remove mark at the end when removable', async () => {
    const onPress = jest.fn();
    await inBothDirections(
      () => (
        <Chip label="ورش" removable accessibilityLabel="إزالة فلتر الرواية" onPress={onPress} />
      ),
      async () => {
        const chip = screen.getByRole('button', { name: 'إزالة فلتر الرواية' });
        expect(styleOf(chip)['paddingEnd']).toBe(tokens.space['2']);
        await fireEvent.press(chip);
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});

describe('CheckRow', () => {
  it('is one touch target that toggles its box', async () => {
    const onChange = jest.fn();
    await inBothDirections(
      () => <CheckRow label="أوافق على الشروط" checked={false} onChange={onChange} />,
      async () => {
        const row = screen.getByRole('checkbox', { name: 'أوافق على الشروط' });
        expect(row.props['accessibilityState']).toMatchObject({ checked: false });
        expect(styleOf(row)['minHeight']).toBe(tokens.size.touch);
        await fireEvent.press(row);
      },
    );
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('aligns the box to the first line when top', async () => {
    await inBothDirections(
      () => <CheckRow label="سطر طويل" checked top onChange={() => undefined} />,
      () => {
        const row = screen.getByRole('checkbox', { name: 'سطر طويل' });
        expect(styleOf(row)['alignItems']).toBe('flex-start');
        expect(row.props['accessibilityState']).toMatchObject({ checked: true });
      },
    );
  });
});

describe('Choice', () => {
  it('is a radio with a card body; danger turns red when selected', async () => {
    await inBothDirections(
      () => (
        <>
          <Choice label="سبب" selected={false} onPress={() => undefined} />
          <Choice label="محدد" selected onPress={() => undefined} />
          <Choice label="خطر" selected danger onPress={() => undefined} />
        </>
      ),
      () => {
        const plain = screen.getByRole('radio', { name: 'سبب' });
        expect(styleOf(plain)['minHeight']).toBe(tokens.size['list-row']);
        expect(styleOf(plain)['backgroundColor']).toBe(colour('light', 'surface-raised'));
        expect(styleOf(screen.getByRole('radio', { name: 'محدد' }))['backgroundColor']).toBe(
          colour('light', 'primary-subtle'),
        );
        expect(styleOf(screen.getByRole('radio', { name: 'خطر' }))['backgroundColor']).toBe(
          colour('light', 'danger-subtle'),
        );
      },
    );
  });
});

describe('Picker', () => {
  const zones = [
    { value: 'Africa/Cairo', label: 'القاهرة', hint: 'GMT+3' },
    { value: 'Asia/Riyadh', label: 'الرياض', hint: 'GMT+3' },
    { value: 'Europe/London', label: 'لندن', disabled: true },
  ];

  it('lists the options, filters them by the search, and reports a choice', async () => {
    const onChange = jest.fn();
    await inBothDirections(
      () => (
        <Picker options={zones} value="Africa/Cairo" onChange={onChange} searchPlaceholder="ابحث" />
      ),
      async () => {
        expect(
          screen.getByRole('radio', { name: /القاهرة/ }).props['accessibilityState'],
        ).toMatchObject({ checked: true });
        await fireEvent.changeText(screen.getByPlaceholderText('ابحث'), 'الري');
        expect(screen.queryByRole('radio', { name: /القاهرة/ })).toBeNull();
        await fireEvent.press(screen.getByRole('radio', { name: /الرياض/ }));
      },
    );
    expect(onChange).toHaveBeenCalledWith('Asia/Riyadh');
  });

  it('never reports a disabled option', async () => {
    const onChange = jest.fn();
    await inBothDirections(
      () => <Picker options={zones} onChange={onChange} />,
      async () => {
        const london = screen.getByRole('radio', { name: /لندن/ });
        expect(london.props['accessibilityState']).toMatchObject({ disabled: true });
        await fireEvent.press(london);
      },
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  // T137: past the list's height the options scroll, so none is reached only through the search.
  it('scrolls the options below the search, and a tap with the keyboard open still chooses', async () => {
    const subjects = Array.from({ length: 8 }, (_, index) => ({
      value: `subject-${index + 1}`,
      label: `مادة ${index + 1}`,
    }));
    const onChange = jest.fn();
    await inBothDirections(
      () => <Picker options={subjects} onChange={onChange} searchPlaceholder="ابحث" />,
      async () => {
        const scroller = scrollerOf(screen.getByRole('radio', { name: /مادة 8/ }));
        expect(scroller).not.toBeNull();
        expect(styleOf(scroller ?? { props: {} })['maxHeight']).toBe(tokens.size['media-preview']);
        expect(scroller?.props['keyboardShouldPersistTaps']).toBe('handled');
        expect(scrollerOf(screen.getByPlaceholderText('ابحث'))).toBeNull();
        await fireEvent.press(screen.getByRole('radio', { name: /مادة 8/ }));
      },
    );
    expect(onChange).toHaveBeenCalledWith('subject-8');
  });
});

type Instance = ReturnType<typeof screen.getByText>;

/** The nearest scroll view holding `node`, or null when none does. */
function scrollerOf(node: Instance): Instance | null {
  for (let at: Instance | null = node; at !== null; at = at.parent) {
    if (at.type === 'RCTScrollView') return at;
  }
  return null;
}

describe('Select', () => {
  it('shows the value, or the placeholder in the subtle colour, and opens on press', async () => {
    const onPress = jest.fn();
    await inBothDirections(
      () => (
        <>
          <Select label="المنطقة الزمنية" value="القاهرة" onPress={onPress} />
          <Select label="المادة" placeholder="اختر مادة" size="md" onPress={onPress} />
        </>
      ),
      async () => {
        const filled = screen.getByRole('button', { name: 'المنطقة الزمنية' });
        expect(styleOf(filled)['height']).toBe(tokens.size['control-lg']);
        expect(screen.getByText('القاهرة')).toBeTruthy();
        const empty = screen.getByRole('button', { name: 'المادة' });
        expect(styleOf(empty)['height']).toBe(tokens.size['control-md']);
        expect(styleOf(screen.getByText('اختر مادة'))['color']).toBe(
          colour('light', 'text-subtle'),
        );
        await fireEvent.press(filled);
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});
