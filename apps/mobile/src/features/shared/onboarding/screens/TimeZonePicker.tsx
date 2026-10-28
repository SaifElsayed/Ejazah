// T051, T052 (FR-AUTH-10): the time-zone picker, a modal route (`time-zone`) the onboarding form and
// the account tab both open. The zones are the city list of `@ijazah/time/cities`, named in the
// person's language and searched by that name; the device's own zone is offered first when it is
// one a person lives by. During the onboarding the choice goes to the draft; for a signed-in person
// it is the account's manual override (`account.setTimezone`), kept across launches and devices.
import type { MeOutput } from '@ijazah/contracts';
import { cityOf, timeZoneCities } from '@ijazah/time/cities';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';

import {
  Banner,
  Choice,
  EmptyState,
  Icon,
  NavHeader,
  SearchRow,
  Text,
} from '../../../../design/primitives';
import { useTheme } from '../../../../design/theme';
import { tokens } from '../../../../design/tokens';
import { useLocale, useT } from '../../../../i18n';
import { ME_QUERY_KEY } from '../../../../lib/account';
import { useApi } from '../../../../lib/api';
import { nameOrder } from '../../../../lib/formatters';
import { useSession } from '../../../../lib/session';
import { deviceTimeZone } from '../../../../lib/time-zone';
import { updateDraft, useDraft } from '../draft';

export function TimeZonePicker() {
  const t = useT();
  const locale = useLocale();
  const { color } = useTheme();
  const session = useSession();
  const draft = useDraft();
  const { client } = useApi();
  const queries = useQueryClient();
  const [query, setQuery] = useState('');
  const [failed, setFailed] = useState(false);
  const signedIn = session.kind === 'signed-in';
  const current = signedIn
    ? queries.getQueryData<MeOutput>(ME_QUERY_KEY)?.timezone
    : (draft?.timezone ?? undefined);
  const device = deviceTimeZone();
  const deviceCity = device === null ? null : cityOf(device, locale);

  // T104: sorted once per language with one collator. `localeCompare` builds a collator on every
  // call, and Hermes took 5.4 s on the phone for the list, so the picker drew seconds late.
  const sorted = useMemo(() => {
    const order = nameOrder(locale);
    return timeZoneCities
      .map((city) => ({ zone: city.zone, name: city[locale] }))
      .sort((a, b) => order(a.name, b.name));
  }, [locale]);
  const cities = useMemo(() => {
    const wanted = query.trim().toLocaleLowerCase();
    return sorted.filter(({ name }) => wanted === '' || name.toLocaleLowerCase().includes(wanted));
  }, [sorted, query]);

  const choose = async (zone: string) => {
    setFailed(false);
    if (!signedIn) {
      updateDraft({ timezone: zone });
      router.back();
      return;
    }
    try {
      await client.api.account.setTimezone.mutate({ timezone: zone });
      await queries.invalidateQueries({ queryKey: ME_QUERY_KEY });
      router.back();
    } catch {
      setFailed(true);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <NavHeader
        title={t('onboarding.timeZone.title')}
        back={{ kind: 'back', onPress: () => router.back() }}
      />
      <View style={{ paddingHorizontal: tokens.layout.gutter, gap: tokens.space['3'] }}>
        <SearchRow
          value={query}
          onChangeText={setQuery}
          placeholder={t('onboarding.timeZone.searchPlaceholder')}
        />
        {failed ? (
          <Banner icon={{ name: 'alert-circle' }} tone="danger">
            {t('common.state.actionError')}
          </Banner>
        ) : null}
        {device === null || deviceCity === null || query.trim() !== '' ? null : (
          <Choice
            selected={current === device}
            onPress={() => void choose(device)}
            label={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['2'] }}>
                <Icon name="smartphone" tone="primary" />
                <Text>{t('onboarding.timeZone.useDevice', { city: deviceCity })}</Text>
              </View>
            }
          />
        )}
        <Text variant="callout" weight="medium" tone="muted">
          {t('onboarding.timeZone.otherCities')}
        </Text>
      </View>
      <FlatList
        accessibilityLabel={t('onboarding.timeZone.a11y.otherCities')}
        data={cities}
        keyExtractor={({ zone }) => zone}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          gap: tokens.space['2'],
          paddingTop: tokens.space['2'],
          paddingHorizontal: tokens.layout.gutter,
          paddingBottom: tokens.space['4'],
        }}
        ListEmptyComponent={
          <EmptyState icon={{ name: 'search' }} title={t('onboarding.timeZone.noMatch')} />
        }
        renderItem={({ item }) => (
          <Choice
            label={item.name}
            selected={current === item.zone}
            onPress={() => void choose(item.zone)}
          />
        )}
      />
    </View>
  );
}
