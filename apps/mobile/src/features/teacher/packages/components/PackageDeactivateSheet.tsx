// T021 (FR-311, FR-314): pausing a package asks first (screens.md §13, PackageDeactivateSheet). The
// title names the package by its short form «{subject} · {sessions}»; the text says it leaves the
// profile while its ongoing enrollments continue (with none, that line is left out: the owner's
// decision of 2026-11-02, B26), and that it can be activated again. «إيقاف الباقة»
// sends `isActive: false`; a failure says so in the sheet and keeps it open.
import type { TeacherPackage } from '@ijazah/contracts';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner, Button, IconTile, Sheet, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { type ErrorMessage, genericErrorKey } from '../../../../lib/error-message';
import { useSubjectName } from '../../../../lib/subjects';
import { usePackageActions } from '../api';

export function PackageDeactivateSheet({
  item,
  onClose,
}: {
  /** The package to pause; the sheet is open while there is one. */
  readonly item: TeacherPackage | undefined;
  readonly onClose: () => void;
}) {
  const t = useT();
  const nameOf = useSubjectName();
  const actions = usePackageActions();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);

  async function pause(packageId: string): Promise<void> {
    setBusy(true);
    setFailure(null);
    try {
      await actions.update({ packageId, isActive: false });
      onClose();
    } catch (caught: unknown) {
      setFailure(genericErrorKey(caught, 'common.state.actionError'));
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    setFailure(null);
    onClose();
  };

  return (
    <Sheet
      open={item !== undefined}
      onClose={close}
      // 006:T003 (Q-4 (a)): today's package only; a programme package's screens are B-P4's.
      {...(item === undefined || item.isProgramme === true
        ? {}
        : {
            title: t('teacher.packages.deactivateSheet.title', {
              package: t('common.format.packageShort', {
                subject: nameOf(item.subject),
                count: item.sessionCount,
              }),
            }),
          })}
    >
      {item === undefined ? null : (
        <>
          <IconTile icon={{ name: 'layers' }} size="lg" tone="warning" />
          <Text tone="muted">
            {item.activeEnrollmentCount === 0
              ? t('teacher.packages.deactivateSheet.textNoEnrollments')
              : t('teacher.packages.deactivateSheet.text', { count: item.activeEnrollmentCount })}
          </Text>
          {failure !== null ? (
            <Banner icon={{ name: 'alert-circle' }} tone="danger">
              {t(failure.key, failure.values)}
            </Banner>
          ) : null}
          <View style={{ gap: tokens.space['2'] }}>
            <Button
              label={t('teacher.packages.deactivateSheet.confirm')}
              variant="danger"
              layout="block"
              loading={busy}
              disabled={busy}
              onPress={() => void pause(item.id)}
            />
            <Button
              label={t('common.action.cancel')}
              variant="ghost"
              layout="block"
              disabled={busy}
              onPress={close}
            />
          </View>
        </>
      )}
    </Sheet>
  );
}
