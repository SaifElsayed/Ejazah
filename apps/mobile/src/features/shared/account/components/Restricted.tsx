// T074 (FR-137, FR-145, FR-162, FR-165): the restricted screen the guard lands a suspended or banned
// account on, with no tab bar and nothing else to reach. The student's (`AccountRestricted`) and the
// teacher's (`TeacherRestricted`) differ in what stopped and what stays; a ban takes the banned
// title and the final line in place of "until the review ends" (decision 34). A revoked approval
// never lands here: the teacher reads the note on `ApplicationRejected` and reapplies, so decision
// 34's revoked title is retired. «تواصل مع الدعم» writes to the support address the public
// configuration serves, read once per launch (lib/client.ts); «تسجيل الخروج» opens the sheet.
//
// T097 (FR-155, app-surface.md): `BannedSignedOut`, the banned state without a session, where a
// sign-up refused with `ACCOUNT_RESTRICTED` lands (the identifiers of a banned person's deleted
// account). No role is known signed out, so it draws `AccountRestricted`'s banned title and final
// line, the same words as the teacher's, then the support contact and the way back to the start
// in place of «تسجيل الخروج»; nothing on it says an account was deleted.
import type { MeOutput } from '@ijazah/contracts';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  ActionBar,
  Banner,
  Button,
  Icon,
  IconTile,
  PageIntro,
  Section,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { useApi } from '../../../../lib/api';
import { StackScreen } from '../../screen';
import { AccountFailed, AccountLoading } from './AccountSettings';
import { SignOutSheet } from './SignOutSheet';

interface RestrictedText {
  readonly title: MessageKey;
  readonly bannedTitle: MessageKey;
  readonly lede: MessageKey;
  readonly finalLede: MessageKey;
  readonly stopped: MessageKey;
  readonly stoppedItems: readonly MessageKey[];
  readonly available: MessageKey;
  readonly availableItems: readonly MessageKey[];
}

const STUDENT: RestrictedText = {
  title: 'account.restricted.title',
  bannedTitle: 'account.restricted.bannedTitle',
  lede: 'account.restricted.lede',
  finalLede: 'account.restricted.finalLede',
  stopped: 'account.restricted.stopped',
  stoppedItems: ['account.restricted.stoppedItems.booking', 'account.restricted.stoppedItems.chat'],
  available: 'account.restricted.available',
  availableItems: [
    'account.restricted.availableItems.ijazahs',
    'account.restricted.availableItems.support',
  ],
};

const TEACHER: RestrictedText = {
  title: 'teacher.restricted.title',
  bannedTitle: 'teacher.restricted.bannedTitle',
  lede: 'teacher.restricted.lede',
  finalLede: 'teacher.restricted.finalLede',
  stopped: 'teacher.restricted.stoppedTitle',
  stoppedItems: [
    'teacher.restricted.stoppedDiscovery',
    'teacher.restricted.stoppedSessions',
    'teacher.restricted.stoppedUpcoming',
  ],
  available: 'teacher.restricted.availableTitle',
  availableItems: ['teacher.restricted.availableIjazahs', 'teacher.restricted.availableSupport'],
};

/** The `restricted` route: the screen of the account's role, from `account.me`. */
export function Restricted() {
  const me = useMe();
  if (me.data === undefined) {
    return me.isError ? <AccountFailed onRetry={() => void me.refetch()} /> : <AccountLoading />;
  }
  return me.data.role === 'teacher' ? (
    <TeacherRestricted account={me.data} />
  ) : (
    <AccountRestricted account={me.data} />
  );
}

export function AccountRestricted({ account }: { readonly account: MeOutput }) {
  return <RestrictedScreen account={account} text={STUDENT} />;
}

export function TeacherRestricted({ account }: { readonly account: MeOutput }) {
  return <RestrictedScreen account={account} text={TEACHER} />;
}

function RestrictedScreen({
  account,
  text,
}: {
  readonly account: MeOutput;
  readonly text: RestrictedText;
}) {
  const t = useT();
  const support = useWriteToSupport();
  const [signingOut, setSigningOut] = useState(false);
  const banned = account.accountStatus === 'banned';

  return (
    <StackScreen
      header={<View style={{ height: tokens.space['6'] }} />}
      footer={
        <ActionBar>
          <ContactSupport onPress={support.write} />
          <Button
            label={t('account.restricted.signOut')}
            variant="ghost"
            layout="block"
            onPress={() => setSigningOut(true)}
          />
        </ActionBar>
      }
    >
      <IconTile icon={{ name: 'lock' }} tone="warning" size="2xl" />
      <PageIntro
        title={t(banned ? text.bannedTitle : text.title)}
        lede={t(banned ? text.finalLede : text.lede)}
      />
      <Section title={t(text.stopped)}>
        <Lines items={text.stoppedItems} icon="x" tone="danger" />
      </Section>
      <Section title={t(text.available)}>
        <Lines items={text.availableItems} icon="check" tone="success" />
      </Section>
      {support.failed ? <SupportFailed /> : null}
      <SignOutSheet
        open={signingOut}
        method={account.signInMethod}
        onClose={() => setSigningOut(false)}
      />
    </StackScreen>
  );
}

/** The `(auth)/banned` route: the banned state with no session and no role (T097). */
export function BannedSignedOut() {
  const t = useT();
  const support = useWriteToSupport();
  return (
    <StackScreen
      header={<View style={{ height: tokens.space['6'] }} />}
      footer={
        <ActionBar>
          <ContactSupport onPress={support.write} />
          <Button
            label={t('auth.banned.backToStart')}
            variant="ghost"
            layout="block"
            onPress={() => router.replace('/(auth)/welcome')}
          />
        </ActionBar>
      }
    >
      <IconTile icon={{ name: 'lock' }} tone="warning" size="2xl" />
      <PageIntro
        title={t('account.restricted.bannedTitle')}
        lede={t('account.restricted.finalLede')}
      />
      {support.failed ? <SupportFailed /> : null}
    </StackScreen>
  );
}

/** «تواصل مع الدعم»: a mail to the support address the public configuration serves (FR-145). */
function useWriteToSupport() {
  const { client } = useApi();
  const [failed, setFailed] = useState(false);

  async function writeToSupport(): Promise<void> {
    setFailed(false);
    try {
      const { supportEmail } = await client.publicConfig();
      await Linking.openURL(`mailto:${supportEmail}`);
    } catch {
      setFailed(true);
    }
  }

  return { failed, write: () => void writeToSupport() };
}

function ContactSupport({ onPress }: { readonly onPress: () => void }) {
  const t = useT();
  return (
    <Button
      label={t('account.restricted.contactSupport')}
      icon={{ name: 'mail' }}
      layout="block"
      onPress={onPress}
    />
  );
}

function SupportFailed() {
  const t = useT();
  return (
    <Banner icon={{ name: 'alert-circle' }} tone="danger">
      {t('common.state.actionError')}
    </Banner>
  );
}

function Lines({
  items,
  icon,
  tone,
}: {
  readonly items: readonly MessageKey[];
  readonly icon: 'x' | 'check';
  readonly tone: 'danger' | 'success';
}) {
  const t = useT();
  return (
    <View style={{ gap: tokens.space['2'] }}>
      {items.map((item) => (
        <View
          key={item}
          style={{ flexDirection: 'row', alignItems: 'flex-start', gap: tokens.space['2'] }}
        >
          <Icon name={icon} size="sm" stroke="medium" tone={tone} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="callout">{t(item)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
