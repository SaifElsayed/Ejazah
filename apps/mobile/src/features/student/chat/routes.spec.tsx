// T045 of specs/004-sessions: the student's chat route sits beside the enrollment's detail, which
// Expo Router allows: `/enrollments/{id}` is still the detail, `/enrollments/{id}/chat` the chat of
// that enrollment, its `id` handed to the screen. The route module is the real one; the screens are
// stand-ins that say which they are.
import { describe, expect, it, jest } from '@jest/globals';
import { screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

// The factory runs before the imports: it reaches its modules by require.
jest.mock('./index', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const native = jest.requireActual<typeof import('react-native')>('react-native');
  const router = jest.requireActual<typeof import('expo-router')>('expo-router');
  return {
    StudentChat: () => {
      const { id } = router.useLocalSearchParams<{ id: string }>();
      return createElement(native.Text, null, `chat of ${String(id)}`);
    },
  };
});

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';

const routes = {
  '(student)/enrollments/[id]': () => <Text>detail</Text>,
  '(student)/enrollments/[id]/chat': require('../../../app/(student)/enrollments/[id]/chat'),
};

describe('the student’s chat route (T045)', () => {
  it('opens the chat of the enrollment the link names', async () => {
    await renderRouter(routes, { initialUrl: `/enrollments/${ENROLLMENT_ID}/chat` });
    expect(await screen.findByText(`chat of ${ENROLLMENT_ID}`)).toBeTruthy();
  });

  it('leaves the enrollment’s detail where it was', async () => {
    await renderRouter(routes, { initialUrl: `/enrollments/${ENROLLMENT_ID}` });
    expect(await screen.findByText('detail')).toBeTruthy();
  });
});
