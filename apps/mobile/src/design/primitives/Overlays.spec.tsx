// T032: Sheet and Dialog (R-MOBILE-4/5/6): every modal flow, in both directions.
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';

import { tokens } from '../tokens';
import { colour, inBothDirections, nodesOf, styleOf } from './__tests__/harness';
import { Dialog, Sheet, Text } from './index';

describe('Sheet', () => {
  it('slides up over the scrim with its handle and title; the scrim closes it', async () => {
    const onClose = jest.fn();
    await inBothDirections(
      () => (
        <Sheet open title="اختر المنطقة الزمنية" onClose={onClose}>
          <Text>محتوى</Text>
        </Sheet>
      ),
      async (rendered, direction) => {
        expect(screen.getByText('محتوى')).toBeTruthy();
        expect(styleOf(screen.getByText('اختر المنطقة الزمنية'))['fontSize']).toBe(
          tokens.text['title-2'].size,
        );
        const sheet = nodesOf(rendered).find(
          (node) => styleOf(node)['borderTopStartRadius'] === tokens.radius.xl,
        );
        expect(styleOf(sheet ?? { props: {} })['backgroundColor']).toBe(colour('light', 'bg'));
        const handle = nodesOf(rendered).find(
          (node) => styleOf(node)['width'] === tokens.size['handle-width'],
        );
        expect(handle).toBeDefined();
        await fireEvent.press(
          screen.getByRole('button', { name: direction === 'rtl' ? 'إغلاق' : 'Close' }),
        );
      },
    );
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders nothing while closed', async () => {
    await inBothDirections(
      () => (
        <Sheet open={false} onClose={() => undefined}>
          <Text>مخفي</Text>
        </Sheet>
      ),
      () => {
        expect(screen.queryByText('مخفي')).toBeNull();
      },
    );
  });
});

describe('Dialog', () => {
  it('centres its title, its body and its actions at the end; it cannot be swiped away', async () => {
    const confirm = jest.fn();
    await inBothDirections(
      () => (
        <Dialog
          open
          title="أضف توقيعك أولًا"
          actions={[
            { label: 'لاحقًا', variant: 'secondary', onPress: () => undefined },
            { label: 'رفع التوقيع', onPress: confirm },
          ]}
        >
          <Text>نص</Text>
        </Dialog>
      ),
      async (rendered) => {
        const card = nodesOf(rendered).find(
          (node) => styleOf(node)['maxWidth'] === tokens.layout.dialog,
        );
        expect(styleOf(card ?? { props: {} })).toMatchObject({
          borderRadius: tokens.radius.xl,
          backgroundColor: colour('light', 'bg'),
        });
        const actions = nodesOf(rendered).find(
          (node) => styleOf(node)['justifyContent'] === 'flex-end',
        );
        expect(actions).toBeDefined();
        expect(card?.props['accessibilityViewIsModal']).toBe(true);
        expect(screen.getByRole('header', { name: 'أضف توقيعك أولًا' })).toBeTruthy();
        await fireEvent.press(screen.getByRole('button', { name: 'رفع التوقيع' }));
      },
    );
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
