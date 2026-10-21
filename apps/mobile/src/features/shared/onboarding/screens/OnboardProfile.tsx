// T051 (FR-AUTH-3, FR-AUTH-4, FR-AUTH-10, FR-AUTH-11, FR-GENDER-1, FR-GENDER-5): the second step.
// The display name, the gender (nothing chosen for the person, it never changes), the date of birth
// (never blocking: the under-18 flag is the server's), the zone as a city (the device's, or the one
// chosen in the picker), and the Terms box, unchecked, «متابعة» disabled until it is ticked (decided
// 2026-10-17). A provider identity with no verified address proves one here by a code (FR-122).
// «متابعة» opens the confirmation sheet, whose confirm creates the account.
import { displayName as displayNameSchema, emailAddress, type Gender } from '@ijazah/contracts';
import { calendarDateOfPicked, pickerDateOf } from '@ijazah/time/calendar';
import { cityOf } from '@ijazah/time/cities';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import {
  ActionBar,
  Button,
  Card,
  CheckRow,
  Field,
  Icon,
  Input,
  Otp as OtpCells,
  PageIntro,
  Segmented,
  Select,
  Sheet,
  Steps,
  Text,
  TextLink,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useLocale, useT } from '../../../../i18n';
import { errorCodeOf } from '../../../../lib/client';
import { useFormatters } from '../../../../lib/formatters';
import { deviceTimeZone } from '../../../../lib/time-zone';
import { conflictMethodOf } from '../../auth/api';
import {
  type SignInConflict,
  SignInConflictSheet,
} from '../../auth/components/SignInConflictSheet';
import { BackBar, StackScreen } from '../../screen';
import { type ReadyDraft, useOnboardingApi } from '../api';
import { ConfirmGenderSheet } from '../components/ConfirmGenderSheet';
import { clearDraft, type OnboardingDraft, updateDraft, useDraft } from '../draft';
import { useOnboardingSteps } from './Role';

const CODE_LENGTH = 6;
/** The first day the date of birth offers; the last is today. */
const EARLIEST_BIRTH = '1900-01-01';
/** Where the picker opens before a date is chosen. */
const PICKER_START = '2000-01-01';
/** Marks the link's place in the Terms sentence, which is one template (R-MOBILE-8). */
const LINK = '\u0000';

/** The draft when it can create the account; null while something is missing. */
export function readyDraft(draft: OnboardingDraft): ReadyDraft | null {
  const { role, gender, dateOfBirth, timezone } = draft;
  if (role === undefined || gender === undefined || dateOfBirth === undefined) return null;
  if (timezone === null || !draft.termsAccepted) return null;
  if (!displayNameSchema.safeParse(draft.displayName).success) return null;
  if (!draft.emailVerified) {
    if (!emailAddress.safeParse(draft.email.trim()).success) return null;
    if (draft.emailCode.length !== CODE_LENGTH) return null;
  }
  return { ...draft, role, gender, dateOfBirth, timezone };
}

export function OnboardProfile() {
  const t = useT();
  const locale = useLocale();
  const format = useFormatters();
  const steps = useOnboardingSteps();
  const onboarding = useOnboardingApi();
  const draft = useDraft();
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Date | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [codeError, setCodeError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SignInConflict | null>(null);

  if (draft === null || draft.role === undefined) return <Redirect href="/(auth)/welcome" />;
  const ready = readyDraft(draft);

  const sendCode = async () => {
    setError(null);
    try {
      await onboarding.requestEmailCode(draft.onboardingToken, draft.email.trim());
      setCodeSent(true);
    } catch {
      setError(t('common.state.actionError'));
    }
  };

  const create = async () => {
    if (ready === null) return;
    setError(null);
    setBusy(true);
    try {
      await onboarding.complete(ready);
    } catch (caught: unknown) {
      const method = conflictMethodOf(caught);
      const code = errorCodeOf(caught);
      if (method !== null) {
        setConfirming(false);
        setConflict({ method, email: draft.email.trim() });
      } else if (code === 'CODE_INVALID') {
        setConfirming(false);
        setCodeError(true);
      } else if (code === 'ONBOARDING_TOKEN_INVALID') {
        // The token lapsed or was spent: the sign-in starts again.
        clearDraft();
        router.replace('/(auth)/welcome');
      } else {
        setError(t(code === 'PASSWORD_WEAK' ? 'auth.password.weak' : 'common.state.actionError'));
      }
    } finally {
      setBusy(false);
    }
  };

  const pickDate = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'ios') {
      if (date !== undefined) setPicked(date);
      return;
    }
    setPicking(false);
    if (event.type === 'set' && date !== undefined) {
      updateDraft({ dateOfBirth: calendarDateOfPicked(date) });
    }
  };

  const picker = (
    <DateTimePicker
      value={picked ?? pickerDateOf(draft.dateOfBirth ?? PICKER_START)}
      mode="date"
      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
      minimumDate={pickerDateOf(EARLIEST_BIRTH)}
      maximumDate={new Date()}
      onChange={pickDate}
    />
  );

  const zone = draft.timezone;
  const city = zone === null ? null : cityOf(zone, locale);
  const zoneLine =
    city === null
      ? t('onboarding.profile.chooseTimeZone')
      : zone === deviceTimeZone()
        ? t('onboarding.profile.timeZoneFromDevice', { city })
        : city;
  const [beforeLink = '', afterLink = ''] = t('onboarding.profile.agreeTerms', {
    terms: LINK,
  }).split(LINK);

  return (
    <StackScreen
      header={
        <View style={{ gap: tokens.space['3'], paddingBottom: tokens.space['2'] }}>
          <BackBar onPress={() => router.back()} />
          <View style={{ paddingHorizontal: tokens.layout.gutter }}>
            <Steps steps={steps} current={1} />
          </View>
        </View>
      }
      footer={
        <ActionBar>
          <Button
            label={t('common.action.continue')}
            layout="block"
            disabled={ready === null}
            onPress={() => setConfirming(true)}
          />
        </ActionBar>
      }
    >
      <PageIntro title={t('onboarding.profile.title')} />
      <Field label={t('onboarding.profile.displayName')}>
        <Input
          value={draft.displayName}
          onChangeText={(displayName) => updateDraft({ displayName })}
        />
      </Field>
      <Field label={t('onboarding.profile.gender')} hint={t('onboarding.profile.genderHint')}>
        <Segmented
          accessibilityLabel={t('onboarding.profile.gender')}
          value={draft.gender ?? ''}
          onChange={(gender) => updateDraft({ gender: gender as Gender })}
          options={[
            { value: 'male', label: t('common.gender.male') },
            { value: 'female', label: t('common.gender.female') },
          ]}
        />
      </Field>
      <Field label={t('onboarding.profile.dateOfBirth')}>
        <Select
          label={t('onboarding.profile.dateOfBirth')}
          placeholder={t('onboarding.profile.chooseDate')}
          {...(draft.dateOfBirth === undefined
            ? {}
            : { value: format.calendarDate(draft.dateOfBirth) })}
          onPress={() => {
            setPicked(null);
            setPicking(true);
          }}
        />
      </Field>
      {picking && Platform.OS !== 'ios' ? picker : null}
      <Field label={t('onboarding.profile.timeZone')}>
        <Card variant="row">
          <Icon name="globe" tone="muted" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text>{zoneLine}</Text>
          </View>
          <TextLink label={t('common.action.change')} onPress={() => router.push('/time-zone')} />
        </Card>
      </Field>
      {draft.emailVerified ? null : (
        <View style={{ gap: tokens.space['3'] }}>
          <Field label={t('auth.field.email')}>
            <Input
              value={draft.email}
              onChangeText={(email) => {
                setCodeSent(false);
                updateDraft({ email, emailCode: '' });
              }}
              keyboard="email"
              ltr
            />
          </Field>
          {codeSent ? (
            <Field
              label={t('auth.otp.lede', { email: draft.email.trim() })}
              {...(codeError ? { error: t('auth.otp.invalid') } : {})}
            >
              <OtpCells
                value={draft.emailCode}
                error={codeError}
                onChange={(emailCode) => {
                  setCodeError(false);
                  updateDraft({ emailCode });
                }}
              />
            </Field>
          ) : (
            <Button
              label={t('auth.emailSignUp.sendCode')}
              variant="secondary"
              layout="block"
              disabled={!emailAddress.safeParse(draft.email.trim()).success}
              onPress={() => void sendCode()}
            />
          )}
        </View>
      )}
      <CheckRow
        checked={draft.termsAccepted}
        onChange={(termsAccepted) => updateDraft({ termsAccepted })}
        label={
          // The sentence is one template; the link sits where its `{terms}` is (R-MOBILE-8).
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
            {beforeLink === '' ? null : <Text>{beforeLink}</Text>}
            <TextLink
              label={t('onboarding.profile.termsLink')}
              variant="strong"
              onPress={() => router.push('/terms')}
            />
            {afterLink === '' ? null : <Text>{afterLink}</Text>}
          </View>
        }
      />
      {error !== null && !confirming ? (
        <Text tone="danger" variant="callout">
          {error}
        </Text>
      ) : null}
      <Sheet open={picking && Platform.OS === 'ios'} onClose={() => setPicking(false)}>
        {picker}
        <Button
          label={t('common.action.done')}
          layout="block"
          onPress={() => {
            setPicking(false);
            if (picked !== null) updateDraft({ dateOfBirth: calendarDateOfPicked(picked) });
          }}
        />
      </Sheet>
      {ready === null ? null : (
        <ConfirmGenderSheet
          open={confirming}
          displayName={ready.displayName.trim()}
          role={ready.role}
          gender={ready.gender}
          busy={busy}
          error={error}
          onConfirm={() => void create()}
          onClose={() => setConfirming(false)}
        />
      )}
      <SignInConflictSheet
        conflict={conflict}
        onClose={() => setConflict(null)}
        onProvider={() => router.replace('/(auth)/welcome')}
      />
    </StackScreen>
  );
}
