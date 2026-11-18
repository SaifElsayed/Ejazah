// 003:T105 (SRS DEC-89; ADR 0025 D2; the note under T105 and the owner's «تمام موافق» of 2026-11-17):
// «مستحقاتي», the teacher's own share as `teacher.dues.get` answers it, pushed from «حسابي». Two
// totals on top, held and paid; one row per part (a recitation package; the ijazah half; the ijazah
// rest; a close's release), each with its amount and its state: held, with when it falls due in the
// account's zone «if no complaint is opened» (with no date yet, the dispute window's hours as
// `teacher.dues.get` read them: «بعد آخر حصة بـ 72 ساعة»), or waiting for an open complaint; due,
// awaiting the
// administration; or paid, with its date. «عليك» (the owner's «عليه»): his own share of each refund,
// with the reason when one is given. The answer carries no order line and no student's name, and
// the screen draws none. Amounts are the server's, formatted only (`formatPounds`).
import type { TeacherDuesDeduction, TeacherDuesRelease } from '@ijazah/contracts';
import { type Piasters, piasters } from '@ijazah/money';
import { router } from 'expo-router';
import { View } from 'react-native';

import {
  Badge,
  EmptyState,
  List,
  ListRow,
  NavHeader,
  Skeleton,
  Stats,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useLocale, useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { formatPounds, useFormatters } from '../../../../lib/formatters';
import { StackScreen } from '../../../shared/screen';
import { NotLoaded, OfflineNotice } from '../../../shared/states';
import { useTeacherDues } from '../api';
import { PART, reasonKey, STATE } from '../words';

export function TeacherDues() {
  const t = useT();
  const locale = useLocale();
  const format = useFormatters();
  const me = useMe();
  const read = useTeacherDues();
  const zone = me.data?.timezone ?? 'UTC';
  const pounds = (amount_piasters: Piasters) => formatPounds(amount_piasters, locale);

  /** When the release falls due (`hours` after the last session with no date yet), waits, or was paid. */
  const stateLine = (release: TeacherDuesRelease, hours: number): string => {
    switch (release.state) {
      case 'held':
        if (release.waitsForCase) return t('money.dues.heldWaitsForCase');
        return release.fallsDueAt === undefined
          ? t('money.dues.heldAfterLast', { hours })
          : t('money.dues.heldUntil', {
              date: format.date(release.fallsDueAt, zone),
              time: format.time(release.fallsDueAt, zone),
            });
      case 'due':
        return t('money.dues.dueAwaiting');
      case 'paid':
        return release.paidAt === undefined
          ? t('money.dues.state.paid')
          : t('money.dues.paidOn', { date: format.date(release.paidAt, zone) });
    }
  };

  const releaseRow = (release: TeacherDuesRelease, index: number, hours: number) => {
    const state = STATE[release.state];
    return (
      <ListRow
        key={`${release.part}-${index}`}
        label={
          <View style={{ gap: tokens.space['1'] }}>
            <Text variant="body" weight="medium">
              {t(PART[release.part])}
            </Text>
            <Text variant="caption" tone="muted">
              {stateLine(release, hours)}
            </Text>
          </View>
        }
        value={
          <Text variant="callout" weight="bold">
            {pounds(piasters(release.amount_piasters))}
          </Text>
        }
        trailing={<Badge label={t(state.label)} tone={state.tone} />}
      />
    );
  };

  const deductionRow = (deduction: TeacherDuesDeduction, index: number) => {
    const reason = reasonKey(deduction.caseReason);
    return (
      <ListRow
        key={`deduction-${index}`}
        label={
          <View style={{ gap: tokens.space['1'] }}>
            <Text variant="body" weight="medium">
              {pounds(piasters(deduction.share_piasters))}
            </Text>
            {reason === undefined ? null : (
              <Text variant="caption" tone="muted">
                {t('money.dues.reasonLine', { reason: t(reason) })}
              </Text>
            )}
          </View>
        }
      />
    );
  };

  const dues = read.data;
  return (
    <StackScreen
      header={
        <NavHeader
          title={t('money.dues.title')}
          back={{ kind: 'back', onPress: () => router.back() }}
        />
      }
    >
      {dues === undefined ? (
        <NotLoaded
          failed={read.isError}
          error={read.error}
          onRetry={() => void read.refetch()}
          loading={<Skeleton shape="block" />}
        />
      ) : (
        <>
          <OfflineNotice onRetry={() => void read.refetch()} />
          <Text variant="callout" tone="muted">
            {t('money.dues.lede')}
          </Text>
          <Stats
            tile
            items={[
              { value: pounds(piasters(dues.held_piasters)), label: t('money.dues.totals.held') },
              { value: pounds(piasters(dues.paid_piasters)), label: t('money.dues.totals.paid') },
            ]}
          />
          {dues.releases.length === 0 ? (
            <EmptyState
              icon={{ name: 'landmark' }}
              title={t('money.dues.empty.title')}
              text={t('money.dues.empty.text')}
            />
          ) : (
            <List header={t('money.dues.releasesTitle')}>
              {dues.releases.map((release, index) =>
                releaseRow(release, index, dues.disputeWindowHours),
              )}
            </List>
          )}
          <View style={{ gap: tokens.space['2'] }}>
            <List header={t('money.dues.deductionsTitle')}>
              {dues.deductions.length === 0 ? (
                <ListRow label={t('money.dues.deductionsEmpty')} />
              ) : (
                dues.deductions.map(deductionRow)
              )}
            </List>
            <Text variant="caption" tone="muted">
              {t('money.dues.deductionsLede')}
            </Text>
          </View>
        </>
      )}
    </StackScreen>
  );
}
