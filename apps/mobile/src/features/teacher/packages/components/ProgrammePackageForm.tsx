// 006:T020 (FR-704, FR-704a; ADR 0024, R-503; B-P4's conflict check): a programme package in the
// editor. Its subject and track are fixed and shown; its three session prices, for 30, 45 and 60
// minutes, are typed in pounds and sent in piasters (`price.ts` over `packages/money`), as `prices`
// alone: a programme package has no count, length or total until an offer (R-506). Beside each price,
// what today's editor shows beside its own: the teacher's share of it at the rate the platform answers
// (003:T104, Q-A3 (a)), and the other teachers' average price per session on the ijazah track for
// that length (`useAveragePrice`, one call per length, SRS DEC-88, FR-704a); nothing while unread or
// when fewer than three teachers have one. A change reaches later offers only (FR-705).
import type { SessionLengthMinutes, TeacherProgrammePackage } from '@ijazah/contracts';
import { SESSION_LENGTHS_MINUTES } from '@ijazah/contracts';
import { piasters, teacherShare } from '@ijazah/money';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  ActionBar,
  Banner,
  Button,
  Field,
  Input,
  NavHeader,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useLocale, useT } from '../../../../i18n';
import { type ErrorMessage, genericErrorKey } from '../../../../lib/error-message';
import { formatPoundAmount } from '../../../../lib/formatters';
import { useSubjectName } from '../../../../lib/subjects';
import { StackScreen } from '../../../shared/screen';
import { useAveragePrice, usePackageActions, useTeacherShareRate } from '../api';
import { piastersOfPounds, poundsOf } from '../price';
import { TRACK_LABEL } from './PackageCard';

type PricesText = Readonly<Record<SessionLengthMinutes, string>>;

/** One length's price: its field, the share of what is typed and the length's average. */
function LengthPrice({
  minutes,
  text,
  shareRate,
  onChange,
}: {
  readonly minutes: SessionLengthMinutes;
  readonly text: string;
  readonly shareRate: number | undefined;
  readonly onChange: (text: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const average_piasters = useAveragePrice('ijazah_track', minutes);
  const price_piasters = piastersOfPounds(text);
  const wrong = text.trim() !== '' && price_piasters === null;
  return (
    <View style={{ gap: tokens.space['1'] }}>
      <Field
        label={t('programme.teacher.package.price', { minutes })}
        {...(wrong ? { error: t('teacher.packages.editor.error.price') } : {})}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['3'] }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Input value={text} onChangeText={onChange} keyboard="numeric" />
          </View>
          <Text tone="muted">{t('teacher.packages.editor.currency')}</Text>
        </View>
      </Field>
      {price_piasters !== null && shareRate !== undefined ? (
        <Text tone="muted">
          {t('money.packageEditor.teacherShare', {
            amount: formatPoundAmount(teacherShare(price_piasters, shareRate), locale),
            percent: shareRate,
          })}
        </Text>
      ) : null}
      {average_piasters !== undefined ? (
        <Text tone="muted">
          {t('money.packageEditor.averagePrice', {
            amount: formatPoundAmount(piasters(average_piasters), locale),
          })}
        </Text>
      ) : null}
    </View>
  );
}

export function ProgrammePackageForm({ item }: { readonly item: TeacherProgrammePackage }) {
  const t = useT();
  const nameOf = useSubjectName();
  const actions = usePackageActions();
  const shareRate = useTeacherShareRate();
  const [texts, setTexts] = useState<PricesText>(() => ({
    30: poundsOf(piasters(item.prices.m30_piasters)),
    45: poundsOf(piasters(item.prices.m45_piasters)),
    60: poundsOf(piasters(item.prices.m60_piasters)),
  }));
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  const m30_piasters = piastersOfPounds(texts[30]);
  const m45_piasters = piastersOfPounds(texts[45]);
  const m60_piasters = piastersOfPounds(texts[60]);
  const ready = m30_piasters !== null && m45_piasters !== null && m60_piasters !== null && !sending;

  async function save(): Promise<void> {
    if (m30_piasters === null || m45_piasters === null || m60_piasters === null) return;
    setSending(true);
    setFailure(null);
    try {
      await actions.update({
        packageId: item.id,
        prices: { m30_piasters, m45_piasters, m60_piasters },
      });
      router.back();
    } catch (caught: unknown) {
      setFailure(genericErrorKey(caught, 'common.state.actionError'));
    } finally {
      setSending(false);
    }
  }

  return (
    <StackScreen
      header={
        <NavHeader
          title={t('teacher.packages.editor.title')}
          back={{ kind: 'back', onPress: () => router.back() }}
        />
      }
      footer={
        <ActionBar>
          <Button
            label={t('teacher.packages.editor.save')}
            layout="block"
            loading={sending}
            disabled={!ready}
            onPress={() => void save()}
          />
        </ActionBar>
      }
    >
      <Field label={t('teacher.packages.editor.subject')}>
        <Text variant="body-lg">{nameOf(item.subject)}</Text>
      </Field>
      <Field label={t('teacher.packages.editor.track')}>
        <Text variant="body-lg">{t(TRACK_LABEL[item.track])}</Text>
      </Field>
      {SESSION_LENGTHS_MINUTES.map((minutes) => (
        <LengthPrice
          key={minutes}
          minutes={minutes}
          text={texts[minutes]}
          shareRate={shareRate}
          onChange={(text) => setTexts((before) => ({ ...before, [minutes]: text }))}
        />
      ))}
      <Banner icon={{ name: 'info' }} tone="info">
        {t('programme.teacher.package.editNote')}
      </Banner>
      {failure === null ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failure.key, failure.values)}
        </Banner>
      )}
    </StackScreen>
  );
}
