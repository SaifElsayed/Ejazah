// T032: the form primitives (R-MOBILE-4/5/6): Field, Input, InputGroup, Otp, Upload and FileRow,
// in both directions; the code cells read left to right in either.
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';

import { tokens } from '../tokens';
import { colour, inBothDirections, nodesOf, styleOf } from './__tests__/harness';
import { Field, FileRow, Input, InputGroup, Otp, Upload } from './index';

describe('Field', () => {
  it('labels its control, with the hint, or the error in the danger colour', async () => {
    await inBothDirections(
      () => (
        <>
          <Field label="البريد الإلكتروني" hint="نرسل إليه رمزًا">
            <Input value="" onChangeText={() => undefined} />
          </Field>
          <Field label="كلمة المرور" error="كلمة المرور قصيرة">
            <Input value="" onChangeText={() => undefined} error secure />
          </Field>
        </>
      ),
      () => {
        expect(styleOf(screen.getByText('البريد الإلكتروني'))['fontSize']).toBe(
          tokens.text.callout.size,
        );
        expect(styleOf(screen.getByText('نرسل إليه رمزًا'))['color']).toBe(
          colour('light', 'text-muted'),
        );
        expect(styleOf(screen.getByText('كلمة المرور قصيرة'))['color']).toBe(
          colour('light', 'danger'),
        );
        // The label is the control's accessible name.
        expect(screen.getByLabelText('البريد الإلكتروني')).toBeTruthy();
      },
    );
  });
});

describe('Input', () => {
  it('is 52 high, reports each change, and turns the border red on error', async () => {
    const onChangeText = jest.fn();
    await inBothDirections(
      () => (
        <>
          <Input value="" onChangeText={onChangeText} placeholder="الاسم" />
          <Input value="" onChangeText={() => undefined} placeholder="خطأ" error />
        </>
      ),
      async () => {
        const input = screen.getByPlaceholderText('الاسم');
        expect(styleOf(input)['height']).toBe(tokens.size['control-lg']);
        expect(styleOf(input)['borderColor']).toBe(colour('light', 'border-strong'));
        expect(styleOf(screen.getByPlaceholderText('خطأ'))['borderColor']).toBe(
          colour('light', 'danger'),
        );
        await fireEvent.changeText(input, 'أمل');
      },
    );
    expect(onChangeText).toHaveBeenCalledWith('أمل');
  });

  it('keeps an LTR value left to right, and never edits when disabled', async () => {
    await inBothDirections(
      () => (
        <>
          <Input
            value="a@b.test"
            onChangeText={() => undefined}
            placeholder="email"
            ltr
            keyboard="email"
          />
          <Input value="x" onChangeText={() => undefined} placeholder="off" disabled />
        </>
      ),
      () => {
        const email = screen.getByPlaceholderText('email');
        expect(styleOf(email)['writingDirection']).toBe('ltr');
        expect(email.props['keyboardType']).toBe('email-address');
        expect(email.props['autoCapitalize']).toBe('none');
        const off = screen.getByPlaceholderText('off');
        expect(off.props['editable']).toBe(false);
        expect(styleOf(off)['backgroundColor']).toBe(colour('light', 'surface'));
      },
    );
  });

  it('is 44 high at md and grows for multiple lines', async () => {
    await inBothDirections(
      () => (
        <>
          <Input value="" onChangeText={() => undefined} placeholder="md" size="md" />
          <Input value="" onChangeText={() => undefined} placeholder="multi" multiline />
        </>
      ),
      () => {
        expect(styleOf(screen.getByPlaceholderText('md'))['height']).toBe(
          tokens.size['control-md'],
        );
        const multi = screen.getByPlaceholderText('multi');
        expect(multi.props['multiline']).toBe(true);
        expect(styleOf(multi)['height']).toBeUndefined();
      },
    );
  });
});

describe('InputGroup', () => {
  it('holds a leading icon, the control and a trailing button in one border', async () => {
    const onPress = jest.fn();
    await inBothDirections(
      () => (
        <InputGroup
          value=""
          onChangeText={() => undefined}
          placeholder="ابحث"
          leadingIcon={{ name: 'search' }}
          trailing={{ icon: { name: 'eye' }, accessibilityLabel: 'إظهار', onPress }}
          surface
        />
      ),
      async (rendered) => {
        const group = nodesOf(rendered).find(
          (node) => styleOf(node)['backgroundColor'] === colour('light', 'surface'),
        );
        expect(styleOf(group ?? { props: {} })).toMatchObject({
          flexDirection: 'row',
          paddingStart: tokens.space['4'],
          paddingEnd: tokens.space['1'],
        });
        await fireEvent.press(screen.getByRole('button', { name: 'إظهار' }));
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});

describe('Otp', () => {
  it('draws six cells left to right in either direction, the next one active', async () => {
    await inBothDirections(
      () => <Otp value="12" onChange={() => undefined} />,
      (rendered) => {
        const row = nodesOf(rendered).find((node) => styleOf(node)['direction'] === 'ltr');
        expect(row).toBeDefined();
        const cells = nodesOf(rendered).filter(
          (node) => styleOf(node)['width'] === tokens.size['otp-width'],
        );
        expect(cells).toHaveLength(6);
        expect(styleOf(cells[0] ?? { props: {} })['backgroundColor']).toBe(
          colour('light', 'surface'),
        );
        expect(styleOf(cells[2] ?? { props: {} })['borderColor']).toBe(colour('light', 'primary'));
        expect(screen.getByText('1')).toBeTruthy();
      },
    );
  });

  it('takes digits only, up to six, and marks every cell on error', async () => {
    const onChange = jest.fn();
    await inBothDirections(
      () => <Otp value="" onChange={onChange} error />,
      async (rendered) => {
        await fireEvent.changeText(screen.getByTestId('otp-input'), '12a34567');
        const cells = nodesOf(rendered).filter(
          (node) => styleOf(node)['width'] === tokens.size['otp-width'],
        );
        for (const cell of cells)
          expect(styleOf(cell)['borderColor']).toBe(colour('light', 'danger'));
      },
    );
    expect(onChange).toHaveBeenLastCalledWith('123456');
  });
});

describe('Upload', () => {
  it('is a dashed target; solid in the primary colours once done', async () => {
    const onPress = jest.fn();
    await inBothDirections(
      () => (
        <>
          <Upload label="ارفع الوثيقة" hint="PDF فقط" onPress={onPress} />
          <Upload label="تم" done tile onPress={onPress} />
        </>
      ),
      async () => {
        const empty = screen.getByRole('button', { name: /ارفع الوثيقة/ });
        expect(styleOf(empty)['borderStyle']).toBe('dashed');
        expect(styleOf(empty)['minHeight']).toBe(tokens.size['control-lg']);
        const done = screen.getByRole('button', { name: /تم/ });
        expect(styleOf(done)).toMatchObject({
          borderStyle: 'solid',
          backgroundColor: colour('light', 'primary-subtle'),
          height: tokens.size['upload-tile'],
        });
        await fireEvent.press(empty);
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});

describe('FileRow', () => {
  it('names the document, its meta, and its action', async () => {
    const onPress = jest.fn();
    await inBothDirections(
      () => (
        <FileRow
          name="ijazah.pdf"
          meta="تم الرفع · 1.2 م.ب"
          action={{ icon: { name: 'trash' }, accessibilityLabel: 'حذف الملف', onPress }}
        />
      ),
      async () => {
        expect(screen.getByText('ijazah.pdf')).toBeTruthy();
        expect(styleOf(screen.getByText('تم الرفع · 1.2 م.ب'))['color']).toBe(
          colour('light', 'text-muted'),
        );
        await fireEvent.press(screen.getByRole('button', { name: 'حذف الملف' }));
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});
