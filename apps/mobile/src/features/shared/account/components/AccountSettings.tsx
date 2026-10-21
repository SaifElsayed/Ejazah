// T052 (FR-AUTH-5, FR-LOC-3, FR-AUTH-10, FR-GENDER-5, FR-AUTH-11): the settings both account tabs
// draw alike (StudentAccount and TeacherAccount, lists 1 and 2): the language, switched in place;
// the zone as its city, «من الجهاز» while it is the device's own; the sign-in method; the gender,
// read only; the Terms. Also the two states of a tab that reads `account.me`: loading and failed.
import type { MeOutput } from '@ijazah/contracts';
import { cityOf } from '@ijazah/time/cities';
import { router } from 'expo-router';
import { View } from 'react-native';

import {
  Banner,
  Button,
  Icon,
  List,
  ListRow,
  Segmented,
  Skeleton,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type Locale, type MessageKey, useLocale, useT } from '../../../../i18n';
import { deviceTimeZone } from '../../../../lib/time-zone';
import { useAccountActions } from '../hooks';

const PROVIDER: Readonly<Record<MeOutput['signInMethod'], MessageKey>> = {
  google: 'account.providers.google',
  apple: 'account.providers.apple',
  email: 'account.providers.email',
};

export function AccountSettings({ me }: { readonly me: MeOutput }) {
  const t = useT();
  const locale = useLocale();
  const actions = useAccountActions();
  const city = cityOf(me.timezone, locale) ?? me.timezone;
  const chevron = <Icon name="chevron-right" size="sm" tone="subtle" />;
  return (
    <>
      <List>
        <ListRow
          label={t('account.language')}
          trailing={
            <Segmented
              accessibilityLabel={t('account.language')}
              inline
              value={locale}
              onChange={(value) => void actions.setLanguage(value as Locale).catch(() => undefined)}
              options={[
                { value: 'ar', label: t('account.languages.ar') },
                { value: 'en', label: t('account.languages.en') },
              ]}
            />
          }
        />
        <ListRow
          label={t('account.timeZone')}
          value={
            me.timezone === deviceTimeZone() ? t('account.timeZoneFromDevice', { city }) : city
          }
          trailing={chevron}
          onPress={() => router.push('/time-zone')}
        />
      </List>
      <List>
        <ListRow label={t('account.signInMethod')} value={t(PROVIDER[me.signInMethod])} />
        <ListRow
          label={t('account.gender')}
          value={t(me.gender === 'female' ? 'account.genders.female' : 'account.genders.male')}
        />
        <ListRow
          label={t('account.terms')}
          trailing={chevron}
          onPress={() => router.push('/terms')}
        />
      </List>
    </>
  );
}

/** The tab while `account.me` is read: the shapes of the rows to come. */
export function AccountLoading() {
  return (
    <View style={{ gap: tokens.space['3'] }}>
      <Skeleton shape="avatar" />
      <Skeleton shape="title" width="1/2" />
      <Skeleton shape="block" />
      <Skeleton shape="block" />
    </View>
  );
}

/** The tab when `account.me` failed: the generic danger banner and a retry. */
export function AccountFailed({ onRetry }: { readonly onRetry: () => void }) {
  const t = useT();
  return (
    <View style={{ gap: tokens.space['3'] }}>
      <Banner icon={{ name: 'alert-circle' }} tone="danger">
        {t('common.state.loadError')}
      </Banner>
      <Button label={t('common.action.retry')} variant="secondary" onPress={onRetry} />
    </View>
  );
}

/** The initials an avatar draws for a name: the first letter of its first two words. */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 'AB'.length)
    .map((word) => [...word][0] ?? '')
    .join('');
}
