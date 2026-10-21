// T051 (FR-AUTH-3, FR-GENDER-1, FR-GENDER-5, ADR 0012 D4, ADR 0016 D1): the last look before the
// account exists (ConfirmGender, and ConfirmGenderTeacher for a teacher): the name, the role and the
// gender, the gender emphasised, and the warning that neither role nor gender changes afterwards.
// Confirming creates the account; nothing is stored before.
import type { Gender, Role } from '@ijazah/contracts';
import { View } from 'react-native';

import { Banner, Button, Sheet, Summary } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';

export function ConfirmGenderSheet({
  open,
  displayName,
  role,
  gender,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  readonly open: boolean;
  readonly displayName: string;
  readonly role: Role;
  readonly gender: Gender;
  readonly busy: boolean;
  /** The failure to say on the sheet, already in words. */
  readonly error: string | null;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}) {
  const t = useT();
  return (
    <Sheet open={open} onClose={onClose} title={t('onboarding.confirm.title')}>
      <Summary
        rows={[
          { label: t('onboarding.confirm.name'), value: displayName },
          {
            label: t('onboarding.confirm.role'),
            value:
              role === 'teacher' ? t('common.role.teacher') : t('common.role.student', { gender }),
          },
          {
            label: t('onboarding.confirm.gender'),
            value: t(gender === 'female' ? 'common.gender.female' : 'common.gender.male'),
            kind: 'emphasis',
          },
        ]}
      />
      <Banner icon={{ name: 'triangle-alert' }} tone="warning">
        {t('onboarding.confirm.warning')}
      </Banner>
      {error === null ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {error}
        </Banner>
      )}
      <View style={{ gap: tokens.space['2'] }}>
        <Button
          label={t(
            role === 'teacher'
              ? 'onboarding.confirm.confirmTeacher'
              : 'onboarding.confirm.confirmStudent',
          )}
          layout="block"
          loading={busy}
          disabled={busy}
          onPress={onConfirm}
        />
        <Button
          label={t('common.action.edit')}
          variant="ghost"
          layout="block"
          disabled={busy}
          onPress={onClose}
        />
      </View>
    </Sheet>
  );
}
