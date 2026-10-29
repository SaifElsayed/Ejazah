// T114: a pushed screen's action bar stays above the keyboard on both platforms, so a long form's
// last button is reachable with a field focused (review page م8).
import { describe, expect, it, jest } from '@jest/globals';
import { screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { Text } from '../../../design/primitives';
import { liftedBy, renderIn } from '../../../design/primitives/__tests__/harness';
import { StackScreen } from './index';

describe('StackScreen', () => {
  for (const os of ['ios', 'android'] as const) {
    it(`lifts its footer above the keyboard on ${os}`, async () => {
      jest.replaceProperty(Platform, 'OS', os);
      await renderIn(
        'rtl',
        <StackScreen header={<Text>العنوان</Text>} footer={<Text>متابعة</Text>}>
          <Text>الحقول</Text>
        </StackScreen>,
      );
      expect(await liftedBy(screen.getByText('متابعة'), 300)).toBe(300);
      jest.restoreAllMocks();
    });
  }
});
