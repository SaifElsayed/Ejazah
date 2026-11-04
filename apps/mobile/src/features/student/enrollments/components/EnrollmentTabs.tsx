// T050 (screens.md §6): «جارية» and «منتهية», the two tabs of «اشتراكاتي». The active tab is the tab
// bar's root; the ended one is pushed over it, and «جارية» goes back to the root.
import type { EnrollmentListTab, StudentEnrollmentItem } from '@ijazah/contracts';
import { router } from 'expo-router';

import { CategoryTabs } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { ACTIVE_ENROLLMENTS_ROUTE, ENDED_ENROLLMENTS_ROUTE, ENROLLMENT_ROUTE } from '../api';

export function EnrollmentTabs({ value }: { readonly value: EnrollmentListTab }) {
  const t = useT();
  return (
    <CategoryTabs
      tabs={[
        { value: 'active', label: t('student.enrollments.tabs.active') },
        { value: 'ended', label: t('student.enrollments.tabs.ended') },
      ]}
      value={value}
      onChange={(chosen) => {
        if (chosen === value) return;
        if (chosen === 'ended') router.push(ENDED_ENROLLMENTS_ROUTE);
        else router.navigate(ACTIVE_ENROLLMENTS_ROUTE);
      }}
      accessibilityLabel={t('student.enrollments.a11y.tabs')}
    />
  );
}

/** The enrollment's detail (`EnrollmentDetail`). */
export function openEnrollment(item: Pick<StudentEnrollmentItem, 'enrollmentId'>): void {
  router.push({ pathname: ENROLLMENT_ROUTE, params: { id: item.enrollmentId } });
}
