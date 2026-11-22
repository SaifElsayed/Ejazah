// T021 (FR-311, FR-312): a new package or one of the list, at `(teacher)/packages/[id]` (`new` for a
// new one; screens.md §13, PackageEditor). The subject is one of the teacher's approved subjects,
// chosen in `PackageSubjectPicker`, and never changes once the package exists; the track; the count,
// one to 52; the length, 30, 45 or 60 minutes; the total price typed in pounds and sent in piasters,
// with the price per session under it (R-212). Once the package has an enrollment (`frozen`) its
// track and length are shown as fixed and never sent. A new package is sent under one key for the
// whole draft, so a retry is the same request; `SUBJECT_NOT_APPROVED` and `PACKAGE_FROZEN` are said
// plainly, the second reading the package again, after which the fixed track and length drawn are
// the package's own, never the choice the editor did not send (T069; PR #116's review). Not drawn on the board and left out: the weekly
// slots hint and the «الباقة فعّالة» check (a new package is active; pausing is the list's).
import type {
  PackageTrack,
  SessionLengthMinutes,
  SubjectSummary,
  TeacherFixedPackage,
} from '@ijazah/contracts';
import { MAX_SESSION_COUNT, SESSION_LENGTHS_MINUTES } from '@ijazah/contracts';
import { perSession, piasters, teacherShare } from '@ijazah/money';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  ActionBar,
  Banner,
  Button,
  Field,
  Input,
  NavHeader,
  Segmented,
  Select,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useLocale, useT } from '../../../../i18n';
import { errorCodeOf } from '../../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../../lib/error-message';
import { formatPoundAmount } from '../../../../lib/formatters';
import { useSubjectName } from '../../../../lib/subjects';
import { StackScreen } from '../../../shared/screen';
import { NotLoaded } from '../../../shared/states';
import { useAveragePrice, usePackageActions, usePackages, useTeacherShareRate } from '../api';
import { TRACK_LABEL } from '../components/PackageCard';
import { PackageSubjectPicker } from '../components/PackageSubjectPicker';
import { piastersOfPounds, poundsOf, sessionCountOf } from '../price';

const NEW = 'new';
const TRACKS: readonly PackageTrack[] = ['recitation', 'ijazah_track'];

type Refusal = 'subject' | 'frozen' | ErrorMessage;

export function PackageEditor() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const list = usePackages();
  if (id === NEW) return <PackageForm />;
  // 006:T003 (Q-4 (a)): today's package only; a programme package's editor is B-P4's (T020).
  const item = list.data?.packages.find(
    (candidate): candidate is TeacherFixedPackage =>
      candidate.id === id && candidate.isProgramme !== true,
  );
  if (item !== undefined) return <PackageForm key={item.id} item={item} />;
  return (
    <StackScreen header={<EditorHeader title={t('teacher.packages.editor.title')} />}>
      <NotLoaded
        failed={list.isError || list.data !== undefined}
        error={list.error}
        onRetry={() => void list.refetch()}
      />
    </StackScreen>
  );
}

function EditorHeader({ title }: { readonly title: string }) {
  return <NavHeader title={title} back={{ kind: 'back', onPress: () => router.back() }} />;
}

function PackageForm({ item }: { readonly item?: TeacherFixedPackage }) {
  const t = useT();
  const locale = useLocale();
  const nameOf = useSubjectName();
  const actions = usePackageActions();
  const shareRate = useTeacherShareRate();
  const [idempotencyKey] = useState(() => Crypto.randomUUID());
  const [subject, setSubject] = useState<SubjectSummary | undefined>(item?.subject);
  const [track, setTrack] = useState<PackageTrack>(item?.track ?? 'recitation');
  const [minutes, setMinutes] = useState<SessionLengthMinutes>(
    item?.sessionDurationMinutes ?? SESSION_LENGTHS_MINUTES[0],
  );
  const [countText, setCountText] = useState(item === undefined ? '' : String(item.sessionCount));
  const [priceText, setPriceText] = useState(
    item === undefined ? '' : poundsOf(piasters(item.price_piasters)),
  );
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | undefined>(undefined);

  // The package as read once it is frozen: what the fixed fields draw, read again after
  // `PACKAGE_FROZEN`, so an unsent track or length never shows as the package's.
  const fixed = item?.frozen === true ? item : undefined;
  const frozen = fixed !== undefined;
  const sessionCount = sessionCountOf(countText);
  const price_piasters = piastersOfPounds(priceText);
  // 003:T113: the average for the track and length the package will have, a frozen one's own.
  const average_piasters = useAveragePrice(
    fixed?.track ?? track,
    fixed?.sessionDurationMinutes ?? minutes,
  );
  const share_piasters =
    price_piasters !== null && shareRate !== undefined
      ? teacherShare(price_piasters, shareRate)
      : undefined;
  const countWrong = countText.trim() !== '' && sessionCount === null;
  const priceWrong = priceText.trim() !== '' && price_piasters === null;
  const ready =
    subject !== undefined && sessionCount !== null && price_piasters !== null && !sending;

  async function save(): Promise<void> {
    if (subject === undefined || sessionCount === null || price_piasters === null) return;
    setSending(true);
    setRefusal(undefined);
    try {
      if (item === undefined) {
        await actions.create({
          subjectId: subject.id,
          track,
          sessionCount,
          sessionDurationMinutes: minutes,
          price_piasters,
          isActive: true,
          idempotencyKey,
        });
      } else {
        await actions.update({
          packageId: item.id,
          sessionCount,
          ...(frozen ? {} : { track, sessionDurationMinutes: minutes }),
          price_piasters,
        });
      }
      router.back();
    } catch (caught) {
      const code = errorCodeOf(caught);
      if (code === 'PACKAGE_FROZEN') void actions.refreshed();
      setRefusal(
        code === 'SUBJECT_NOT_APPROVED'
          ? 'subject'
          : code === 'PACKAGE_FROZEN'
            ? 'frozen'
            : genericErrorKey(caught, 'common.state.actionError'),
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <StackScreen
      header={
        <EditorHeader
          title={t(
            item === undefined
              ? 'teacher.packages.editor.newTitle'
              : 'teacher.packages.editor.title',
          )}
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
      <Field
        label={t('teacher.packages.editor.subject')}
        {...(refusal === 'subject'
          ? { error: t('teacher.packages.editor.error.subjectNotApproved') }
          : {})}
      >
        {item === undefined ? (
          <Select
            label={t('teacher.packages.editor.subject')}
            placeholder={t('teacher.packages.editor.subjectPlaceholder')}
            {...(subject === undefined ? {} : { value: nameOf(subject) })}
            onPress={() => setPicking(true)}
          />
        ) : (
          <Text variant="body-lg">{nameOf(item.subject)}</Text>
        )}
      </Field>

      {fixed !== undefined ? (
        <Field label={t('teacher.packages.editor.track')}>
          <Text variant="body-lg">{t(TRACK_LABEL[fixed.track])}</Text>
        </Field>
      ) : (
        <Field
          label={t('teacher.packages.editor.track')}
          hint={t('teacher.packages.editor.trackHint')}
        >
          <Segmented
            accessibilityLabel={t('teacher.packages.editor.track')}
            options={TRACKS.map((value) => ({ value, label: t(TRACK_LABEL[value]) }))}
            value={track}
            onChange={(value) => setTrack(value as PackageTrack)}
          />
        </Field>
      )}

      <Field
        label={t('teacher.packages.editor.sessionCount')}
        {...(countWrong
          ? {
              error: t('teacher.packages.editor.error.sessionCount', {
                min: 1,
                max: MAX_SESSION_COUNT,
              }),
            }
          : {})}
      >
        <Input value={countText} onChangeText={setCountText} keyboard="numeric" />
      </Field>

      {fixed !== undefined ? (
        <Field label={t('teacher.packages.editor.duration')}>
          <Text variant="body-lg">
            {t('common.format.duration', { minutes: fixed.sessionDurationMinutes })}
          </Text>
        </Field>
      ) : (
        <Field label={t('teacher.packages.editor.duration')}>
          <Segmented
            accessibilityLabel={t('teacher.packages.editor.duration')}
            options={SESSION_LENGTHS_MINUTES.map((value) => ({
              value: String(value),
              label: t('teacher.packages.editor.durationOption', { minutes: value }),
            }))}
            value={String(minutes)}
            onChange={(value) => setMinutes(Number(value) as SessionLengthMinutes)}
          />
        </Field>
      )}

      {frozen ? (
        <Banner icon={{ name: 'lock' }} tone="neutral">
          {t('teacher.packages.editor.frozenHint')}
        </Banner>
      ) : null}

      <Field
        label={t('teacher.packages.editor.totalPrice')}
        {...(priceWrong ? { error: t('teacher.packages.editor.error.price') } : {})}
        {...(price_piasters !== null && sessionCount !== null
          ? {
              hint: t('teacher.packages.editor.perSessionHint', {
                amount: formatPoundAmount(perSession(price_piasters, sessionCount), locale),
              }),
            }
          : {})}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['3'] }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Input value={priceText} onChangeText={setPriceText} keyboard="numeric" />
          </View>
          <Text tone="muted">{t('teacher.packages.editor.currency')}</Text>
        </View>
      </Field>

      {/* 003:T104 (ADR 0025 D1, Q-A3 (a)): the price guide. The teacher's share of the price as it
          is typed, at the rate the platform answers, rounded up as the order will be; nothing while
          the rate is unread. 003:T113 (SRS DEC-88): beside it, the other teachers' average price
          per session on the same track and length; nothing when fewer than three have one. */}
      {share_piasters !== undefined || average_piasters !== undefined ? (
        <View style={{ gap: tokens.space['1'] }}>
          {share_piasters !== undefined && shareRate !== undefined ? (
            <Text tone="muted">
              {t('money.packageEditor.teacherShare', {
                amount: formatPoundAmount(share_piasters, locale),
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
      ) : null}

      {item === undefined ? null : (
        <Banner icon={{ name: 'info' }} tone="info">
          {t('teacher.packages.editor.editNote')}
        </Banner>
      )}

      {refusal === 'frozen' ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t('teacher.packages.editor.error.frozen')}
        </Banner>
      ) : typeof refusal === 'object' ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(refusal.key, refusal.values)}
        </Banner>
      ) : null}

      {item === undefined ? (
        <PackageSubjectPicker
          open={picking}
          {...(subject === undefined ? {} : { value: subject })}
          onChange={(chosen) => {
            setSubject(chosen);
            if (refusal === 'subject') setRefusal(undefined);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </StackScreen>
  );
}
