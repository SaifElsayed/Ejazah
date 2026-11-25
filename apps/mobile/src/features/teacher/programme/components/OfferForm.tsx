// 006:T020 (FR-705, FR-706a, R-506): the teacher's offer after the delivered assessment. The
// student's level, readiness and the programme's expected length, each 1 to 500 characters; the
// session length, 30, 45 or 60 minutes (the server refuses one longer than the reserved weekly time,
// `length_exceeds_slot`, said in its words); the count, 1 to 200. The deadline as a date and a time in
// the teacher's zone. The total and the months as `packages/money` computes them from the teacher's
// price for the length (`programmeOfferAmounts`), shown while that price is known; the server prices
// the offer itself at sending. Each refusal of `programme.offer` is said in its own words.
import type { SessionLengthMinutes } from '@ijazah/contracts';
import {
  MAX_PROGRAMME_SESSION_COUNT,
  PROGRAMME_TEXT_MAX_LENGTH,
  SESSION_LENGTHS_MINUTES,
} from '@ijazah/contracts';
import { programmeOfferAmounts } from '@ijazah/money';
import { useState } from 'react';
import { View } from 'react-native';

import {
  Banner,
  Button,
  Field,
  Input,
  Segmented,
  Summary,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useLocale, useT } from '../../../../i18n';
import { errorCodeOf, errorDetailsOf } from '../../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../../lib/error-message';
import { formatPounds, useFormatters } from '../../../../lib/formatters';
import { offerCountOf, usePackages } from '../../packages';
import { type OfferTerms } from '../api';
import { offerTextOf, sessionPriceOf } from '../gates';

/** The fewest sessions an offer has (`programmeOfferInput.sessionCount`). */
const MIN_OFFER_SESSIONS = 1;

/** `programme.offer`'s refusals, each in its own words; the count's is the field's own. */
const REFUSAL: Readonly<Record<string, ErrorMessage>> = {
  assessment_not_delivered: { key: 'programme.teacher.offer.refusal.assessment_not_delivered' },
  not_awaiting_offer: { key: 'programme.teacher.offer.refusal.not_awaiting_offer' },
  offer_due_passed: { key: 'programme.teacher.offer.refusal.offer_due_passed' },
  length_exceeds_slot: { key: 'programme.teacher.offer.refusal.length_exceeds_slot' },
  count_out_of_bounds: {
    key: 'programme.teacher.offer.countError',
    values: { min: MIN_OFFER_SESSIONS, max: MAX_PROGRAMME_SESSION_COUNT },
  },
  teacher_not_active: { key: 'programme.teacher.offer.refusal.teacher_not_active' },
};

function offerRefusalOf(caught: unknown): ErrorMessage {
  const cause = errorDetailsOf(caught).find(({ path }) => path === 'cause')?.code;
  const worded = cause === undefined ? undefined : REFUSAL[cause];
  return errorCodeOf(caught) === 'CONFLICT' && worded !== undefined
    ? worded
    : genericErrorKey(caught, 'common.state.actionError');
}

/** One of the offer's three texts, with its field's error once typed and out of bounds. */
function OfferText({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (text: string) => void;
}) {
  const t = useT();
  const wrong = value !== '' && offerTextOf(value) === null;
  return (
    <Field
      label={label}
      {...(wrong
        ? { error: t('programme.teacher.offer.textError', { max: PROGRAMME_TEXT_MAX_LENGTH }) }
        : {})}
    >
      <Input value={value} onChangeText={onChange} multiline />
    </Field>
  );
}

export function OfferForm({
  subjectId,
  offerDueAt,
  when,
  onSend,
}: {
  /** The enrollment's subject, whose programme package prices the preview. */
  readonly subjectId: string;
  /** The offer's deadline (`offerDueAt`), drawn while the server answers one. */
  readonly offerDueAt: string | null;
  /** An instant as a date and a time in the teacher's zone. */
  readonly when: (instant: string) => string;
  readonly onSend: (terms: OfferTerms) => Promise<unknown>;
}) {
  const t = useT();
  const locale = useLocale();
  const format = useFormatters();
  const packages = usePackages();
  const [level, setLevel] = useState('');
  const [readiness, setReadiness] = useState('');
  const [expectedLength, setExpectedLength] = useState('');
  const [minutes, setMinutes] = useState<SessionLengthMinutes>(SESSION_LENGTHS_MINUTES[0]);
  const [countText, setCountText] = useState('');
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);

  const texts = [offerTextOf(level), offerTextOf(readiness), offerTextOf(expectedLength)] as const;
  const sessionCount = offerCountOf(countText);
  const countWrong = countText.trim() !== '' && sessionCount === null;
  const price_piasters = sessionPriceOf(packages.data?.packages ?? [], subjectId, minutes);
  const amounts =
    price_piasters !== undefined && sessionCount !== null
      ? programmeOfferAmounts(price_piasters, sessionCount)
      : undefined;
  const ready = texts.every((text) => text !== null) && sessionCount !== null && !sending;

  async function send(): Promise<void> {
    const [levelText, readinessText, lengthText] = texts;
    if (levelText === null || readinessText === null || lengthText === null) return;
    if (sessionCount === null) return;
    setSending(true);
    setFailure(null);
    try {
      await onSend({
        level: levelText,
        readiness: readinessText,
        expectedLength: lengthText,
        durationMinutes: minutes,
        sessionCount,
      });
    } catch (caught: unknown) {
      setFailure(offerRefusalOf(caught));
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={{ gap: tokens.space['3'] }}>
      <Text variant="headline">{t('programme.teacher.offer.title')}</Text>
      <Text tone="muted">{t('programme.teacher.offer.lede')}</Text>
      {offerDueAt === null ? null : (
        <Banner icon={{ name: 'clock' }} tone="info">
          {t('programme.teacher.offer.dueBy', { when: when(offerDueAt) })}
        </Banner>
      )}
      <OfferText label={t('programme.teacher.offer.level')} value={level} onChange={setLevel} />
      <OfferText
        label={t('programme.teacher.offer.readiness')}
        value={readiness}
        onChange={setReadiness}
      />
      <OfferText
        label={t('programme.teacher.offer.expectedLength')}
        value={expectedLength}
        onChange={setExpectedLength}
      />
      <Field
        label={t('programme.teacher.offer.duration')}
        hint={t('programme.teacher.offer.durationHint')}
      >
        <Segmented
          accessibilityLabel={t('programme.teacher.offer.duration')}
          options={SESSION_LENGTHS_MINUTES.map((value) => ({
            value: String(value),
            label: t('teacher.packages.editor.durationOption', { minutes: value }),
          }))}
          value={String(minutes)}
          onChange={(value) => setMinutes(Number(value) as SessionLengthMinutes)}
        />
      </Field>
      <Field
        label={t('programme.teacher.offer.sessionCount')}
        {...(countWrong
          ? {
              error: t('programme.teacher.offer.countError', {
                min: MIN_OFFER_SESSIONS,
                max: MAX_PROGRAMME_SESSION_COUNT,
              }),
            }
          : {})}
      >
        <Input value={countText} onChangeText={setCountText} keyboard="numeric" />
      </Field>
      {amounts === undefined ? null : (
        <Summary
          rows={[
            {
              label: t('programme.teacher.offer.months'),
              value: format.number(amounts.monthCount),
            },
            {
              label: t('programme.teacher.offer.total'),
              value: formatPounds(amounts.total_piasters, locale),
              kind: 'total',
            },
          ]}
        />
      )}
      {failure === null ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failure.key, failure.values)}
        </Banner>
      )}
      <Button
        label={t('programme.teacher.offer.send')}
        layout="block"
        loading={sending}
        disabled={!ready}
        onPress={() => void send()}
      />
    </View>
  );
}
