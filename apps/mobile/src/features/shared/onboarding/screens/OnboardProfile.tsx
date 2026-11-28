// T051 (FR-AUTH-3, FR-AUTH-4, FR-AUTH-10, FR-AUTH-11, FR-GENDER-1, FR-GENDER-5): the second step.
// The display name, the gender (nothing chosen for the person, it never changes), the date of birth
// (never blocking: the under-18 flag is the server's), the zone as a city (the device's, or the one
// chosen in the picker), and the Terms box, unchecked, «متابعة» disabled until it is ticked (decided
// 2026-10-17). A provider identity with no verified address proves one here by a code (FR-122).
// «متابعة» opens the confirmation sheet, whose confirm creates the account. T097 (FR-155): a creation
// refused as a banned person's (`ACCOUNT_RESTRICTED`) forgets the draft and lands on the signed-out
// banned state. T109: the date of birth is picked in the app's own sheet (`BirthDateSheet`), since
// Android's picker takes no locale. T137: the sign-up step checks the password first; a creation
// still refused as `PASSWORD_WEAK` forgets the draft and leads back to that step's password field.
// R3 T189 (FR-AUTH-4 as amended by DEC-109): when the date of birth makes the person under 18 today
// in the step's zone (`isMinorOn`, the server's day), one more checkbox under the Terms, unticked,
// «وليّ أمري موافق على تسجيلي», holds «متابعة» until ticked and sends `guardianAgreed: true`; a date
// that makes an adult hides and clears it, and a refusal for want of it shows it with its error.
import { displayName as displayNameSchema, emailAddress, type Gender } from '@ijazah/contracts';
import { isMinorOn, localDateIn } from '@ijazah/time';
import { calendarDateOfPicked } from '@ijazah/time/calendar';
import { cityOf } from '@ijazah/time/cities';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

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
  Steps,
  Text,
  TextLink,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { isolate, useLocale, useT } from '../../../../i18n';
import { errorCodeOf, errorDetailsOf } from '../../../../lib/client';
import { genericErrorKey } from '../../../../lib/error-message';
import { useFormatters } from '../../../../lib/formatters';
import { deviceTimeZone } from '../../../../lib/time-zone';
import {
  BANNED_ROUTE,
  conflictMethodOf,
  isBannedRefusal,
  PASSWORD_WEAK_ROUTE,
} from '../../auth/api';
import {
  type SignInConflict,
  SignInConflictSheet,
} from '../../auth/components/SignInConflictSheet';
import { BackBar, StackScreen } from '../../screen';
import { type ReadyDraft, useOnboardingApi } from '../api';
import { BirthDateSheet } from '../components/BirthDateSheet';
import { ConfirmGenderSheet } from '../components/ConfirmGenderSheet';
import { clearDraft, type OnboardingDraft, updateDraft, useDraft } from '../draft';
import { useOnboardingSteps } from './Role';

const CODE_LENGTH = 6;
/** The first day the date of birth offers; the last is today. */
const EARLIEST_BIRTH = '1900-01-01';
/** Where the picker opens before a date is chosen. */
const PICKER_START = '2000-01-01';
/**
 * Mark the two links' places in the Terms sentence, which is one template (R-MOBILE-8): the Terms
 * and, since R3 T185, the privacy policy (ق3 (a″)).
 */
const TERMS_LINK = '\u0000';
const PRIVACY_LINK = '\u0001';
/** The marks as `translate` puts them in the sentence: each value between isolates (T109). */
const LINK_MARKS = new RegExp(`(${isolate(TERMS_LINK)}|${isolate(PRIVACY_LINK)})`);

/**
 * R3 T189: whether the date of birth makes the person under 18 today in the zone the step holds,
 * the day the server reads (`onboarding.complete`); unknown, and so not asked, before both are set.
 */
export function isMinorToday(
  draft: Pick<OnboardingDraft, 'dateOfBirth' | 'timezone'>,
  now: Date,
): boolean {
  const { dateOfBirth, timezone } = draft;
  if (dateOfBirth === undefined || timezone === null) return false;
  return isMinorOn(dateOfBirth, localDateIn(now, timezone));
}

/** R3 T189: the guardian's checkbox, whether it is asked and whether it is ticked. */
export interface GuardianAgreement {
  readonly asked: boolean;
  readonly ticked: boolean;
}

/** R3 T189: a creation refused for want of the guardian's tick. */
function isGuardianRefusal(error: unknown): boolean {
  return (
    errorCodeOf(error) === 'VALIDATION_FAILED' &&
    errorDetailsOf(error).some((detail) => detail.path === 'guardianAgreed')
  );
}

/** The draft when it can create the account; null while something is missing. */
export function readyDraft(draft: OnboardingDraft, guardian: GuardianAgreement): ReadyDraft | null {
  const { role, gender, dateOfBirth, timezone } = draft;
  if (role === undefined || gender === undefined || dateOfBirth === undefined) return null;
  if (timezone === null || !draft.termsAccepted) return null;
  if (guardian.asked && !guardian.ticked) return null;
  if (!displayNameSchema.safeParse(draft.displayName).success) return null;
  if (!draft.emailVerified) {
    if (!emailAddress.safeParse(draft.email.trim()).success) return null;
    if (draft.emailCode.length !== CODE_LENGTH) return null;
  }
  return {
    ...draft,
    role,
    gender,
    dateOfBirth,
    timezone,
    ...(guardian.asked ? { guardianAgreed: true } : {}),
  };
}

export function OnboardProfile() {
  const t = useT();
  const locale = useLocale();
  const format = useFormatters();
  const steps = useOnboardingSteps();
  const onboarding = useOnboardingApi();
  const draft = useDraft();
  const [picking, setPicking] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [codeError, setCodeError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SignInConflict | null>(null);
  // R3 T189: the guardian's tick, and whether the server refused the creation for want of it.
  const [guardianTicked, setGuardianTicked] = useState(false);
  const [guardianRefused, setGuardianRefused] = useState(false);

  if (draft === null || draft.role === undefined) return <Redirect href="/(auth)/welcome" />;
  // A refusal shows the checkbox even where the phone's clock read an adult, until the date changes.
  const guardianAsked = guardianRefused || isMinorToday(draft, new Date());
  const ready = readyDraft(draft, { asked: guardianAsked, ticked: guardianTicked });
  const textOf = (caught: unknown) => {
    const { key, values } = genericErrorKey(caught, 'common.state.actionError');
    return t(key, values);
  };

  const sendCode = async () => {
    setError(null);
    try {
      await onboarding.requestEmailCode(draft.onboardingToken, draft.email.trim());
      setCodeSent(true);
    } catch (caught: unknown) {
      setError(textOf(caught));
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
      if (isBannedRefusal(caught)) {
        // Away first: an empty draft redirects a focused profile to the welcome screen.
        router.replace(BANNED_ROUTE);
        clearDraft();
      } else if (method !== null) {
        setConfirming(false);
        setConflict({ method, email: draft.email.trim() });
      } else if (code === 'CODE_INVALID') {
        setConfirming(false);
        setCodeError(true);
      } else if (isGuardianRefusal(caught)) {
        setConfirming(false);
        setGuardianTicked(false);
        setGuardianRefused(true);
      } else if (code === 'ONBOARDING_TOKEN_INVALID') {
        // The token lapsed or was spent: the sign-in starts again.
        clearDraft();
        router.replace('/(auth)/welcome');
      } else if (code === 'PASSWORD_WEAK') {
        // This screen has no password field; the sign-up step's does. Away first, as for a ban.
        router.dismissTo(PASSWORD_WEAK_ROUTE);
        clearDraft();
      } else {
        setError(textOf(caught));
      }
    } finally {
      setBusy(false);
    }
  };

  const zone = draft.timezone;
  const city = zone === null ? null : cityOf(zone, locale);
  const zoneLine =
    city === null
      ? t('onboarding.profile.chooseTimeZone')
      : zone === deviceTimeZone()
        ? t('onboarding.profile.timeZoneFromDevice', { city })
        : city;
  // `translate` isolates each value (T109), so the split takes the isolates with the placeholders;
  // the pieces alternate text and a link's mark, in the order the language puts them.
  const sentence = t('onboarding.profile.agreeTerms', {
    terms: TERMS_LINK,
    privacy: PRIVACY_LINK,
  }).split(LINK_MARKS);

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
          onPress={() => setPicking(true)}
        />
      </Field>
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
          // The sentence is one template; each link sits where its placeholder is (R-MOBILE-8).
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
            {sentence.map((piece, at) =>
              piece === isolate(TERMS_LINK) ? (
                <TextLink
                  key={at}
                  label={t('onboarding.profile.termsLink')}
                  variant="strong"
                  onPress={() => router.push('/terms')}
                />
              ) : piece === isolate(PRIVACY_LINK) ? (
                <TextLink
                  key={at}
                  label={t('onboarding.profile.privacyLink')}
                  variant="strong"
                  onPress={() => router.push('/privacy')}
                />
              ) : piece === '' ? null : (
                <Text key={at}>{piece}</Text>
              ),
            )}
          </View>
        }
      />
      {guardianAsked ? (
        <View style={{ gap: tokens.space['1'] }}>
          <CheckRow
            checked={guardianTicked}
            onChange={setGuardianTicked}
            label={t('onboarding.profile.guardianAgree')}
          />
          {guardianRefused && !guardianTicked ? (
            <Text tone="danger" variant="callout">
              {t('onboarding.profile.guardianRequired')}
            </Text>
          ) : null}
        </View>
      ) : null}
      {error !== null && !confirming ? (
        <Text tone="danger" variant="callout">
          {error}
        </Text>
      ) : null}
      {picking ? (
        <BirthDateSheet
          initial={draft.dateOfBirth ?? PICKER_START}
          earliest={EARLIEST_BIRTH}
          latest={calendarDateOfPicked(new Date())}
          onDone={(dateOfBirth) => {
            setPicking(false);
            updateDraft({ dateOfBirth });
            // R3 T189: a date that makes an adult hides the guardian's checkbox and clears its tick.
            setGuardianRefused(false);
            if (!isMinorToday({ ...draft, dateOfBirth }, new Date())) setGuardianTicked(false);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
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
