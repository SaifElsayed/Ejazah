// T084 (FR-AUTH-8, FR-PROFILE-1, R-GENDER-6; decision 46): the student's profile editor
// (StudentProfileEditor), at `(student)/account/profile`. The avatar with «تغيير الصورة»: the system
// picker opens for one JPEG or PNG, uploaded at once (`POST /uploads/photos`) and shown by the link
// the upload answers. «الاسم الظاهر» is saved by «حفظ» through `account.updateProfile`, refused here
// as the contract refuses it; an unchanged name saves nothing. The date of birth and the gender are
// shown locked with «للتغيير تواصل مع الدعم.», and no input of either exists. The board's name hint
// speaks of the certificate name at the first ijazah request, a later phase, so it is left out
// (R-HONEST; the key stays in the catalogue).
import { displayName as displayNameSchema } from '@ijazah/contracts';
import { useState } from 'react';
import { View } from 'react-native';

import {
  ActionBar,
  Avatar,
  Banner,
  Button,
  Field,
  Input,
  NavHeader,
  Spinner,
  TextLink,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { type ErrorMessage, genericErrorKey } from '../../../../lib/error-message';
import { pickPhoto } from '../../../../lib/files';
import { useFormatters } from '../../../../lib/formatters';
import { AccountLoading, initialsOf } from '../../../shared/account';
import { StackScreen } from '../../../shared/screen';
import { NotLoaded } from '../../../shared/states';
import { useProfileActions } from '../api';
import { leaveToAccount } from '../navigation';

export function StudentProfileEditor() {
  const t = useT();
  const me = useMe();
  const format = useFormatters();
  const actions = useProfileActions();
  const [name, setName] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  const account = me.data;
  const typed = name ?? account?.displayName ?? '';
  const valid = displayNameSchema.safeParse(typed).success;

  async function changePhoto(): Promise<void> {
    const picked = await pickPhoto();
    if (picked === null) return;
    setFailure(null);
    setUploading(true);
    try {
      setPhotoUrl(await actions.uploadPhoto(picked));
    } catch (caught: unknown) {
      setFailure(genericErrorKey(caught, 'common.state.actionError'));
    } finally {
      setUploading(false);
    }
  }

  async function save(): Promise<void> {
    const next = typed.trim();
    if (next === account?.displayName) {
      leaveToAccount();
      return;
    }
    setFailure(null);
    setSaving(true);
    try {
      await actions.rename(next);
      leaveToAccount();
    } catch (caught: unknown) {
      setFailure(genericErrorKey(caught, 'common.state.actionError'));
    } finally {
      setSaving(false);
    }
  }

  const image = photoUrl ?? account?.photoUrl;
  return (
    <StackScreen
      header={
        <NavHeader
          title={t('student.profile.title')}
          back={{ kind: 'back', onPress: leaveToAccount }}
        />
      }
      footer={
        <ActionBar>
          <Button
            label={t('student.profile.save')}
            layout="block"
            loading={saving}
            disabled={account === undefined || !valid || saving || uploading}
            onPress={() => void save()}
          />
        </ActionBar>
      }
    >
      {account === undefined ? (
        <NotLoaded
          failed={me.isError}
          error={me.error}
          onRetry={() => void me.refetch()}
          loading={<AccountLoading />}
        />
      ) : (
        <>
          {failure !== null ? (
            <Banner icon={{ name: 'alert-circle' }} tone="danger">
              {t(failure.key, failure.values)}
            </Banner>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['4'] }}>
            <Avatar
              initials={initialsOf(typed === '' ? account.displayName : typed)}
              size="xl"
              {...(image === undefined ? {} : { imageUri: image })}
            />
            <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }}>
              {uploading ? (
                <Spinner />
              ) : (
                <TextLink
                  label={t('student.profile.changePhoto')}
                  icon={{ name: 'upload' }}
                  onPress={() => void changePhoto()}
                />
              )}
            </View>
          </View>
          <Field label={t('student.profile.name')}>
            <Input value={typed} onChangeText={setName} />
          </Field>
          <Field label={t('student.profile.birthDate')} hint={t('student.profile.lockedHint')}>
            <Input value={format.calendarDate(account.dateOfBirth)} onChangeText={noop} disabled />
          </Field>
          <Field label={t('account.gender')} hint={t('student.profile.lockedHint')}>
            <Input
              value={t(
                account.gender === 'female' ? 'account.genders.female' : 'account.genders.male',
              )}
              onChangeText={noop}
              disabled
            />
          </Field>
        </>
      )}
    </StackScreen>
  );
}

/** A locked field takes no text. */
function noop(): void {}
