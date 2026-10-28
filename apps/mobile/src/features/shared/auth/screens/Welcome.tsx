// T050 (FR-AUTH-1 as ADR 0012 D1 rewrote it, FR-AUTH-5, FR-AUTH-12, FR-LOC-3): the welcome screen.
// The language segmented switches in place; the brand, the tagline and the two feature lines; then
// the ways in: Google, Apple on iOS only, email, and in a development build the stand-in. A
// returning person lands through the guard; a new one goes to Role; an address another method
// holds opens the conflict sheet. T097: a new account refused as a banned person's lands on the
// signed-out banned state. T106: the root paints the theme's background, as StackScreen does for
// every other (auth) screen; the stack beneath draws React Navigation's light default.
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import {
  ActionBar,
  Banner,
  Brand,
  Button,
  Icon,
  Segmented,
  Text,
} from '../../../../design/primitives';
import { useTheme } from '../../../../design/theme';
import { tokens } from '../../../../design/tokens';
import { type Locale, setLocale, useLocale, useT } from '../../../../i18n';
import { BANNED_ROUTE, type SignInProvider, useAuthApi } from '../api';
import { type SignInConflict, SignInConflictSheet } from '../components/SignInConflictSheet';
import { devSignInEnabled } from '../dev-sign-in';

export function Welcome() {
  const t = useT();
  const locale = useLocale();
  const { color } = useTheme();
  const auth = useAuthApi();
  const [busy, setBusy] = useState<SignInProvider | null>(null);
  const [failed, setFailed] = useState(false);
  const [conflict, setConflict] = useState<SignInConflict | null>(null);

  const signIn = async (provider: SignInProvider) => {
    setFailed(false);
    setBusy(provider);
    try {
      const outcome = await auth.withProvider(provider);
      if (outcome.kind === 'onboarding') router.push('/(auth)/role');
      if (outcome.kind === 'conflict') setConflict(outcome);
      if (outcome.kind === 'banned') router.replace(BANNED_ROUTE);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <View
        style={{
          flex: 1,
          paddingHorizontal: tokens.layout.gutter,
          paddingTop: tokens.space['2'],
          gap: tokens.space['6'],
        }}
      >
        <View style={{ alignSelf: 'flex-end' }}>
          <Segmented
            accessibilityLabel={t('common.language.a11y.label')}
            inline
            value={locale}
            onChange={(value) => setLocale(value as Locale)}
            options={[
              { value: 'ar', label: t('common.language.ar') },
              { value: 'en', label: t('common.language.en') },
            ]}
          />
        </View>
        <View style={{ flex: 1, justifyContent: 'center', gap: tokens.space['5'] }}>
          <Brand size="lg" />
          <Text variant="title-2">{t('auth.welcome.tagline')}</Text>
          <View style={{ gap: tokens.space['3'] }}>
            <Feature icon="award" text={t('auth.welcome.feature.isnad')} />
            <Feature icon="users" text={t('auth.welcome.feature.gender')} />
          </View>
        </View>
        {failed ? (
          <Banner icon={{ name: 'alert-circle' }} tone="danger">
            {t('auth.welcome.failed')}
          </Banner>
        ) : null}
      </View>
      <ActionBar>
        <Button
          label={t('auth.welcome.google')}
          variant="google"
          icon={{ name: 'google', fill: 'solid' }}
          layout="block"
          loading={busy === 'google'}
          disabled={busy !== null}
          onPress={() => void signIn('google')}
        />
        {Platform.OS === 'ios' ? (
          <Button
            label={t('auth.welcome.apple')}
            variant="apple"
            icon={{ name: 'apple', fill: 'solid' }}
            layout="block"
            loading={busy === 'apple'}
            disabled={busy !== null}
            onPress={() => void signIn('apple')}
          />
        ) : null}
        <Button
          label={t('auth.welcome.email')}
          variant="secondary"
          icon={{ name: 'mail' }}
          layout="block"
          disabled={busy !== null}
          onPress={() => router.push('/(auth)/email-sign-in')}
        />
        {devSignInEnabled() ? (
          <Button
            label={t('auth.welcome.devSignIn')}
            variant="ghost"
            layout="block"
            loading={busy === 'dev'}
            disabled={busy !== null}
            onPress={() => void signIn('dev')}
          />
        ) : null}
      </ActionBar>
      <SignInConflictSheet
        conflict={conflict}
        onClose={() => setConflict(null)}
        onProvider={(provider) => void signIn(provider)}
      />
    </View>
  );
}

function Feature({ icon, text }: { readonly icon: 'award' | 'users'; readonly text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['3'] }}>
      <Icon name={icon} tone="primary" />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text tone="muted">{text}</Text>
      </View>
    </View>
  );
}
