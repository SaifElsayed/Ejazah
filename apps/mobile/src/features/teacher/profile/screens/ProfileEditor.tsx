// T158 (FR-PROFILE-1, FR-310): the teacher's public profile (ProfileEditor), at `(teacher)/profile`,
// opened by the account tab's «الملف العام». «الاسم الظاهر» is saved by «حفظ» through
// `account.updateProfile`, refused here as the contract refuses it; an unchanged name saves nothing.
import { displayName as displayNameSchema } from '@ijazah/contracts';
import { useState } from 'react';

import { ActionBar, Banner, Button, Field, Input, NavHeader } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { AccountLoading } from '../../../shared/account';
import { StackScreen } from '../../../shared/screen';
import { NotLoaded } from '../../../shared/states';
import { useProfileActions } from '../api';
import { leaveToAccount } from '../navigation';

export function ProfileEditor() {
  const t = useT();
  const me = useMe();
  const actions = useProfileActions();
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const account = me.data;
  const typed = name ?? account?.displayName ?? '';
  const valid = displayNameSchema.safeParse(typed).success;

  async function save(): Promise<void> {
    const next = typed.trim();
    if (next === account?.displayName) {
      leaveToAccount();
      return;
    }
    setFailed(false);
    setSaving(true);
    try {
      await actions.rename(next);
      leaveToAccount();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

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
            disabled={account === undefined || !valid || saving}
            onPress={() => void save()}
          />
        </ActionBar>
      }
    >
      {account === undefined ? (
        <NotLoaded
          failed={me.isError}
          onRetry={() => void me.refetch()}
          loading={<AccountLoading />}
        />
      ) : (
        <>
          {failed ? (
            <Banner icon={{ name: 'alert-circle' }} tone="danger">
              {t('common.state.actionError')}
            </Banner>
          ) : null}
          <Field label={t('teacher.profile.displayName')}>
            <Input value={typed} onChangeText={setName} />
          </Field>
        </>
      )}
    </StackScreen>
  );
}
