// T034 (FR-202): the teacher's tabs of later phases render their drawn empty or locked state with
// no data path, in both directions, from the catalogue only.
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';

import { inBothDirections } from '../../design/primitives/__tests__/harness';
import { translate } from '../../i18n';
import { AvailabilityEmpty } from './availability';
import { TeacherHomeEmpty } from './home';
import { PackagesLocked } from './packages';
import { TeacherStudentsEmpty } from './students';

const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({ router: { navigate: (route: string) => mockNavigate(route) } }));

const said = (direction: 'rtl' | 'ltr', key: Parameters<typeof translate>[1]) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key);

describe('TeacherHomeEmpty', () => {
  it('says the day has no session and leads to the availability', async () => {
    mockNavigate.mockReset();
    await inBothDirections(
      () => <TeacherHomeEmpty />,
      async (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'teacher.today.title'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'teacher.today.empty.title'))).toBeTruthy();
        await fireEvent.press(
          screen.getByRole('button', { name: said(direction, 'teacher.today.empty.availability') }),
        );
      },
    );
    expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/(tabs)/availability');
  });
});

describe('TeacherStudentsEmpty', () => {
  it('says there is no student yet and leads to the packages', async () => {
    mockNavigate.mockReset();
    await inBothDirections(
      () => <TeacherStudentsEmpty />,
      async (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'teacher.students.title'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'teacher.students.empty.title'))).toBeTruthy();
        await fireEvent.press(
          screen.getByRole('button', { name: said(direction, 'teacher.students.empty.packages') }),
        );
      },
    );
    expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/(tabs)/packages');
  });
});

describe('AvailabilityEmpty', () => {
  it('says there is no slot yet', async () => {
    await inBothDirections(
      () => <AvailabilityEmpty />,
      (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'teacher.availability.title'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'teacher.availability.empty.title'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'teacher.availability.empty.text'))).toBeTruthy();
      },
    );
  });
});

describe('PackagesLocked', () => {
  it('says the packages stay hidden until the payout account is verified', async () => {
    await inBothDirections(
      () => <PackagesLocked />,
      (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'teacher.packages.title'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'teacher.packages.lockedBanner'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'teacher.packages.empty.title'))).toBeTruthy();
      },
    );
  });
});
