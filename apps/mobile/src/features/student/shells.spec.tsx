// T034 (FR-202): the student's tabs of later phases render their drawn empty state with no data
// path, in both directions, from the catalogue only.
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';

import { inBothDirections } from '../../design/primitives/__tests__/harness';
import { translate } from '../../i18n';
import { CredentialsEmpty } from './credentials';
import { DiscoveryNoTeachers } from './discovery';
import { EnrollmentsEmpty } from './enrollments';
import { StudentHomeEmpty } from './home';

const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({ router: { navigate: (route: string) => mockNavigate(route) } }));

const said = (direction: 'rtl' | 'ltr', key: Parameters<typeof translate>[1]) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key);

describe('StudentHomeEmpty', () => {
  it('draws the brand, the first step with its three lines, and the way to discovery', async () => {
    mockNavigate.mockReset();
    await inBothDirections(
      () => <StudentHomeEmpty />,
      async (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'common.brand.name'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'student.home.empty.kicker'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'student.home.empty.title'))).toBeTruthy();
        for (const step of ['step1', 'step2', 'step3'] as const) {
          expect(screen.getByText(said(direction, `student.home.empty.${step}`))).toBeTruthy();
        }
        await fireEvent.press(
          screen.getByRole('button', { name: said(direction, 'student.home.empty.findTeacher') }),
        );
      },
    );
    expect(mockNavigate).toHaveBeenCalledWith('/(student)/(tabs)/discovery');
  });
});

describe('DiscoveryNoTeachers', () => {
  it('says no teacher is available yet, with no search and no filter', async () => {
    await inBothDirections(
      () => <DiscoveryNoTeachers />,
      (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'student.discovery.title'))).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'student.discovery.noTeachers.title')),
        ).toBeTruthy();
        expect(screen.getByText(said(direction, 'student.discovery.noTeachers.text'))).toBeTruthy();
        expect(screen.queryByRole('search')).toBeNull();
      },
    );
  });
});

describe('EnrollmentsEmpty', () => {
  it('says there is no enrollment yet and leads to discovery', async () => {
    mockNavigate.mockReset();
    await inBothDirections(
      () => <EnrollmentsEmpty />,
      async (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'student.enrollments.empty.title'))).toBeTruthy();
        await fireEvent.press(
          screen.getByRole('button', { name: said(direction, 'student.enrollments.empty.action') }),
        );
      },
    );
    expect(mockNavigate).toHaveBeenCalledWith('/(student)/(tabs)/discovery');
  });
});

describe('CredentialsEmpty', () => {
  it('says there is no ijazah yet and leads to the enrollments', async () => {
    mockNavigate.mockReset();
    await inBothDirections(
      () => <CredentialsEmpty />,
      async (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'student.credentials.empty.title'))).toBeTruthy();
        await fireEvent.press(
          screen.getByRole('button', { name: said(direction, 'student.credentials.empty.action') }),
        );
      },
    );
    expect(mockNavigate).toHaveBeenCalledWith('/(student)/(tabs)/enrollments');
  });
});
