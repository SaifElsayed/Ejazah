// T021 (FR-311, FR-312, FR-314, FR-315): the teacher's packages tab (screens.md §13). It reads
// `teacher.packages.list` and draws its state: not read yet, the shared states (002:T138); not
// published, `PackagesLocked`; no package, `PackagesEmpty`; else the active and paused groups.
import { NotLoaded } from '../../../shared/states';
import { usePackages } from '../api';
import { PackageGroups } from '../components/PackageGroups';
import { PackagesFrame } from '../components/PackagesFrame';
import { PackagesEmpty } from './PackagesEmpty';
import { PackagesLocked } from './PackagesLocked';

export function Packages() {
  const list = usePackages();
  const retry = () => void list.refetch();
  if (list.data === undefined) {
    return (
      <PackagesFrame published>
        <NotLoaded failed={list.isError} error={list.error} onRetry={retry} />
      </PackagesFrame>
    );
  }
  const { published, packages } = list.data;
  if (!published) return <PackagesLocked packages={packages} onRetry={retry} />;
  if (packages.length === 0) return <PackagesEmpty onRetry={retry} />;
  return (
    <PackagesFrame published onRetry={retry}>
      <PackageGroups packages={packages} published />
    </PackagesFrame>
  );
}
