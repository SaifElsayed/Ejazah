// T034 (FR-202, FR-PROFILE-10), T021 (FR-315): the packages tab while the teacher is not published
// (the payout account not verified yet, or replaced and waiting; a suspended teacher alike): the
// warning to the payout over the list, «غير منشورة» on each active package, which shows one line
// with its price and no tiles. Drafting goes on as before; nothing of it reaches a student.
import type { TeacherPackage } from '@ijazah/contracts';

import { PackageGroups } from '../components/PackageGroups';
import { PackagesFrame } from '../components/PackagesFrame';
import { PackagesEmptyState } from './PackagesEmpty';

export function PackagesLocked({
  packages = [],
  onRetry,
}: {
  readonly packages?: readonly TeacherPackage[];
  readonly onRetry?: () => void;
}) {
  return (
    <PackagesFrame published={false} {...(onRetry === undefined ? {} : { onRetry })}>
      {packages.length === 0 ? (
        <PackagesEmptyState />
      ) : (
        <PackageGroups packages={packages} published={false} />
      )}
    </PackagesFrame>
  );
}
