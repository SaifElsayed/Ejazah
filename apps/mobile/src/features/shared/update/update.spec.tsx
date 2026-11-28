// R3 T184 (SRS DEC-99, DEC-109; the note under T184, Q-W (a)): the one blocking screen a build
// below the server's floor sees, built as the crash screen is, in the theme and the direction
// (Arabic first): «حدّث التطبيق», why, and one button «حدّث التطبيق» opening the app's Play page.
// On iOS (deferred, the first release is Android only) the same screen has no button.
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { UpdateRequired } from './UpdateRequired';

const mockOpen = jest.fn(async (_url: string) => true);
jest.mock('expo-linking', () => ({ openURL: (url: string) => mockOpen(url) }));

const ar = (key: MessageKey) => translate('ar', key);
const en = (key: MessageKey) => translate('en', key);

afterEach(() => {
  jest.restoreAllMocks();
  mockOpen.mockClear();
});

describe('UpdateRequired (R3 T184)', () => {
  it('says the build must be updated, with the one button, Arabic first, in the theme', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await inBothDirections(
      () => <UpdateRequired />,
      (_rendered, direction) => {
        const t = direction === 'rtl' ? ar : en;
        // In Arabic the title and the button say the same words.
        expect(screen.getAllByText(t('common.update.title'))).toHaveLength(
          direction === 'rtl' ? 2 : 1,
        );
        expect(screen.getByText(t('common.update.body'))).toBeTruthy();
        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(screen.getByRole('button', { name: t('common.update.action') })).toBeTruthy();
      },
    );
  });

  it('opens the app’s page on Google Play on the button', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderIn('rtl', <UpdateRequired />);
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: ar('common.update.action') }));
    });
    expect(mockOpen.mock.calls).toEqual([
      ['https://play.google.com/store/apps/details?id=com.ijazah.app'],
    ]);
  });

  it('shows the same screen with no button on iOS', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    await renderIn('rtl', <UpdateRequired />);
    expect(screen.getByText(ar('common.update.title'))).toBeTruthy();
    expect(screen.getByText(ar('common.update.body'))).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
