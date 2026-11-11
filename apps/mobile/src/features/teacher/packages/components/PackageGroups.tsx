// T021 (FR-311, FR-314, FR-315): the packages in two groups, «فعّالة {n}» then «موقوفة {n}», each
// drawn only when it has a package. «إيقاف» asks through `PackageDeactivateSheet`; «تفعيل» sends
// `isActive: true` in place; a failure says so above the groups.
import type { TeacherPackage } from '@ijazah/contracts';
import { useState } from 'react';

import { Banner, Section } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { type ErrorMessage, genericErrorKey } from '../../../../lib/error-message';
import { usePackageActions } from '../api';
import { PackageCard } from './PackageCard';
import { PackageDeactivateSheet } from './PackageDeactivateSheet';
import { openPackageEditor } from './PackagesFrame';

export function PackageGroups({
  packages,
  published,
}: {
  readonly packages: readonly TeacherPackage[];
  readonly published: boolean;
}) {
  const t = useT();
  const actions = usePackageActions();
  const [pausing, setPausing] = useState<TeacherPackage | undefined>(undefined);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  const active = packages.filter(({ isActive }) => isActive);
  const paused = packages.filter(({ isActive }) => !isActive);

  async function activate(packageId: string): Promise<void> {
    setFailure(null);
    try {
      await actions.update({ packageId, isActive: true });
    } catch (caught: unknown) {
      setFailure(genericErrorKey(caught, 'common.state.actionError'));
    }
  }

  const card = (item: TeacherPackage) => (
    <PackageCard
      key={item.id}
      item={item}
      published={published}
      onEdit={() => openPackageEditor(item.id)}
      onToggle={() => (item.isActive ? setPausing(item) : void activate(item.id))}
    />
  );

  return (
    <>
      {failure !== null ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failure.key, failure.values)}
        </Banner>
      ) : null}
      {active.length === 0 ? null : (
        <Section title={t('teacher.packages.activeGroup', { count: active.length })}>
          {active.map(card)}
        </Section>
      )}
      {paused.length === 0 ? null : (
        <Section title={t('teacher.packages.pausedGroup', { count: paused.length })}>
          {paused.map(card)}
        </Section>
      )}
      <PackageDeactivateSheet item={pausing} onClose={() => setPausing(undefined)} />
    </>
  );
}
