// T158 (FR-PROFILE-1, FR-310): the teacher's public profile (ProfileEditor), at `(teacher)/profile`,
// opened by the account tab's «الملف العام». «الاسم الظاهر» is saved by «حفظ» through
// `account.updateProfile`, refused here as the contract refuses it; an unchanged name saves nothing.
//
// T023 (FR-310, FR-PROFILE-1, FR-PROFILE-7, FR-GENDER-5, R-GENDER-6; screens.md §12): the profile
// `teacher.profile.get` answers. The avatar with «تغيير الصورة»: the system picker opens for one
// JPEG or PNG, uploaded at once (`POST /uploads/photos`) and shown by the link the upload answers.
// «نبذة» and «نوع المؤهل» are saved by «حفظ» through `teacher.profile.update`, only when one of
// them changed; a bio over BIO_MAX_LENGTH characters or an empty qualification keeps «حفظ»
// disabled, the bio's bound said under it. The gender is shown locked with «للتغيير تواصل مع
// الدعم.», and no input of it exists. The board's subjects and years of teaching are not in T023's
// text or the contract, so they are left out (the owner's rule); `published` is not drawn here.
import {
  BIO_MAX_LENGTH,
  displayName as displayNameSchema,
  teacherProfileUpdateInput,
} from '@ijazah/contracts';
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
  Skeleton,
  Spinner,
  TextLink,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { pickPhoto } from '../../../../lib/files';
import { initialsOf } from '../../../shared/account';
import { StackScreen } from '../../../shared/screen';
import { NotLoaded } from '../../../shared/states';
import { useProfileActions, useTeacherProfile } from '../api';
import { leaveToAccount } from '../navigation';

export function ProfileEditor() {
  const t = useT();
  const profile = useTeacherProfile();
  const actions = useProfileActions();
  const [name, setName] = useState<string | null>(null);
  const [bio, setBio] = useState<string | null>(null);
  const [qualification, setQualification] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const current = profile.data;
  const typedName = name ?? current?.displayName ?? '';
  const typedBio = bio ?? current?.bio ?? '';
  const typedQualification = qualification ?? current?.qualificationSummary ?? '';
  const description = teacherProfileUpdateInput.safeParse({
    bio: typedBio,
    qualificationSummary: typedQualification,
  });
  const valid = displayNameSchema.safeParse(typedName).success && description.success;
  const bioTooLong = typedBio.trim().length > BIO_MAX_LENGTH;

  async function changePhoto(): Promise<void> {
    const picked = await pickPhoto();
    if (picked === null) return;
    setFailed(false);
    setUploading(true);
    try {
      setPhotoUrl(await actions.uploadPhoto(picked));
    } catch {
      setFailed(true);
    } finally {
      setUploading(false);
    }
  }

  async function save(): Promise<void> {
    if (current === undefined || !description.success) return;
    const nextName = typedName.trim();
    const next = description.data;
    const writes: Promise<void>[] = [];
    if (nextName !== current.displayName) writes.push(actions.rename(nextName));
    if (next.bio !== current.bio || next.qualificationSummary !== current.qualificationSummary) {
      writes.push(actions.describe(next));
    }
    if (writes.length === 0) {
      leaveToAccount();
      return;
    }
    setFailed(false);
    setSaving(true);
    try {
      await Promise.all(writes);
      leaveToAccount();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  const image = photoUrl ?? current?.photoUrl;
  return (
    <StackScreen
      header={
        <NavHeader
          title={t('teacher.profile.title')}
          back={{ kind: 'back', onPress: leaveToAccount }}
        />
      }
      footer={
        <ActionBar>
          <Button
            label={t('common.action.save')}
            layout="block"
            loading={saving}
            disabled={current === undefined || !valid || saving || uploading}
            onPress={() => void save()}
          />
        </ActionBar>
      }
    >
      {current === undefined ? (
        <NotLoaded
          failed={profile.isError}
          onRetry={() => void profile.refetch()}
          loading={<Skeleton shape="block" />}
        />
      ) : (
        <>
          {failed ? (
            <Banner icon={{ name: 'alert-circle' }} tone="danger">
              {t('common.state.actionError')}
            </Banner>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['4'] }}>
            <Avatar
              initials={initialsOf(typedName === '' ? current.displayName : typedName)}
              size="xl"
              {...(image === undefined ? {} : { imageUri: image })}
            />
            <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }}>
              {uploading ? (
                <Spinner />
              ) : (
                <TextLink
                  label={t('teacher.profile.changePhoto')}
                  icon={{ name: 'upload' }}
                  onPress={() => void changePhoto()}
                />
              )}
            </View>
          </View>
          <Field label={t('teacher.profile.displayName')}>
            <Input value={typedName} onChangeText={setName} />
          </Field>
          <Field label={t('teacher.profile.gender')} hint={t('teacher.profile.genderHint')}>
            <Input
              value={t(
                current.gender === 'female' ? 'account.genders.female' : 'account.genders.male',
              )}
              onChangeText={noop}
              disabled
            />
          </Field>
          <Field
            label={t('teacher.profile.bio')}
            {...(bioTooLong
              ? { error: t('teacher.profile.bioTooLong', { max: BIO_MAX_LENGTH }) }
              : {})}
          >
            <Input value={typedBio} onChangeText={setBio} multiline />
          </Field>
          <Field label={t('teacher.profile.qualificationType')}>
            <Input value={typedQualification} onChangeText={setQualification} multiline />
          </Field>
        </>
      )}
    </StackScreen>
  );
}

/** A locked field takes no text. */
function noop(): void {}
