// T021 (FR-311, FR-314): pausing a package asks first (screens.md §13, PackageDeactivateSheet). The
// title names the package by its short form «{subject} · {sessions}»; the text says it leaves the
// profile while its ongoing enrollments continue, and that it can be activated again. «إيقاف الباقة»
// sends `isActive: false`; a failure says so in the sheet and keeps it open.
import type { TeacherPackage } from '@ijazah/contracts';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner, Button, IconTile, Sheet, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
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
  const [failed, setFailed] = useState(false);

  async function pause(packageId: string): Promise<void> {
    setBusy(true);
    setFailed(false);
    try {
      await actions.update({ packageId, isActive: false });
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    setFailed(false);
    onClose();
  };

  return (
    <Sheet
      open={item !== undefined}
      onClose={close}
      {...(item === undefined
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
            {t('teacher.packages.deactivateSheet.text', { count: item.activeEnrollmentCount })}
          </Text>
          {failed ? (
            <Banner icon={{ name: 'alert-circle' }} tone="danger">
              {t('common.state.actionError')}
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
