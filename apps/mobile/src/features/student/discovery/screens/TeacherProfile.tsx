// T030 (FR-336, FR-DISC-4, FR-PROFILE-6, FR-PROFILE-7): the teacher's profile a student opens from
// discovery (screens.md §4, `TeacherProfile`). The photo when one is set (the only place a student
// sees it), else the initials; the name, the gender and the subjects; the rating line, or the
// no-reviews line with no stars; the bio, the qualification and the active packages. No riwaya,
// tariq or chain, which are Phase 4's (FR-ISNAD-5). An excluded teacher is the unknown-teacher
// state, with no hint of why (R-GENDER-2); the shared states draw loading, failure and offline.
// T044 (FR-BOOK-1, screens.md §4 and §5): the student chooses a package, the first until another is
// pressed, and the action bar «اختيار الموعد · {package}» opens the booking sheet for it over the page.
import type { DiscoveryTeacherOutput, DiscoveryTeacherPackage } from '@ijazah/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  ActionBar,
  Avatar,
  Badge,
  Button,
  EmptyState,
  Icon,
  Section,
  Skeleton,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useFormatters } from '../../../../lib/formatters';
import { useSubjectName } from '../../../../lib/subjects';
import { initialsOf } from '../../../shared/account';
import { BookingSheet } from '../../booking';
import { BackBar, StackScreen } from '../../../shared/screen';
import { NotLoaded, OfflineNotice } from '../../../shared/states';
import { ProfilePackage } from '../components/ProfilePackage';
import { isTeacherId, isUnknownTeacher, useDiscoveryTeacher } from '../teacher-api';

export function TeacherProfile() {
  const params = useLocalSearchParams<{ teacherId: string }>();
  const teacherId = typeof params.teacherId === 'string' ? params.teacherId : '';
  const profile = useDiscoveryTeacher(teacherId);
  const retry = () => void profile.refetch();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const packages = profile.data?.packages ?? [];
  const chosen = packages.find(({ packageId }) => packageId === chosenId) ?? packages[0];
  return (
    <StackScreen
      header={<BackBar onPress={() => router.back()} />}
      footer={
        chosen === undefined || isUnknownTeacher(profile.error) ? undefined : (
          <ChooseSlot item={chosen} onPress={() => setBooking(true)} />
        )
      }
    >
      {!isTeacherId(teacherId) || isUnknownTeacher(profile.error) ? (
        <UnknownTeacher />
      ) : profile.data === undefined ? (
        <NotLoaded
          failed={profile.isError}
          error={profile.error}
          onRetry={retry}
          loading={<Skeleton shape="block" />}
        />
      ) : (
        <>
          <OfflineNotice onRetry={retry} />
          <Profile teacher={profile.data} chosenId={chosen?.packageId} onChoose={setChosenId} />
          {booking && chosen !== undefined ? (
            <BookingSheet item={chosen} onClose={() => setBooking(false)} />
          ) : null}
        </>
      )}
    </StackScreen>
  );
}

function UnknownTeacher() {
  const t = useT();
  return (
    <EmptyState
      icon={{ name: 'user-x' }}
      title={t('student.teacherProfile.notFound.title')}
      text={t('student.teacherProfile.notFound.text')}
    />
  );
}

/** «اختيار الموعد · {package}»: the booking sheet for the package chosen. */
function ChooseSlot({
  item,
  onPress,
}: {
  readonly item: DiscoveryTeacherPackage;
  readonly onPress: () => void;
}) {
  const t = useT();
  const nameOf = useSubjectName();
  return (
    <ActionBar>
      <Button
        label={t('student.teacherProfile.chooseSlot', {
          package: t('common.format.packageShort', {
            subject: nameOf(item.subject),
            count: item.sessionCount,
          }),
        })}
        layout="block"
        onPress={onPress}
      />
    </ActionBar>
  );
}

function Profile({
  teacher,
  chosenId,
  onChoose,
}: {
  readonly teacher: DiscoveryTeacherOutput;
  readonly chosenId: string | undefined;
  readonly onChoose: (packageId: string) => void;
}) {
  const t = useT();
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['4'] }}>
        <Avatar
          initials={initialsOf(teacher.displayName)}
          size="2xl"
          {...(teacher.photoUrl === undefined ? {} : { imageUri: teacher.photoUrl })}
        />
        <View style={{ flex: 1, minWidth: 0, gap: tokens.space['1'] }}>
          <Text variant="title-2">{teacher.displayName}</Text>
          <Identity teacher={teacher} />
          <RatingLine teacher={teacher} />
        </View>
      </View>
      <Text variant="callout">{teacher.bio}</Text>
      <Section title={t('student.teacherProfile.qualification')}>
        <Text variant="callout">{teacher.qualificationSummary}</Text>
      </Section>
      {teacher.packages.length === 0 ? null : (
        <Section title={t('student.teacherProfile.packages')}>
          {teacher.packages.map((item) => (
            <ProfilePackage
              key={item.packageId}
              item={item}
              selected={item.packageId === chosenId}
              onPress={() => onChoose(item.packageId)}
            />
          ))}
        </Section>
      )}
    </>
  );
}

/** The gender badge, then the subjects with an approved credential (FR-PROFILE-7). */
function Identity({ teacher }: { readonly teacher: DiscoveryTeacherOutput }) {
  const t = useT();
  const nameOf = useSubjectName();
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: tokens.space['2'],
      }}
    >
      <Badge
        label={t(teacher.gender === 'female' ? 'common.gender.female' : 'common.gender.male')}
        tone="neutral"
      />
      <Text variant="callout" tone="muted">
        {teacher.subjects.map(nameOf).join(t('student.teacherProfile.subjectsSeparator'))}
      </Text>
    </View>
  );
}

/** The aggregate rating and its count, or, with no review yet, no stars and the line saying so. */
function RatingLine({ teacher }: { readonly teacher: DiscoveryTeacherOutput }) {
  const t = useT();
  const format = useFormatters();
  if (teacher.rating === undefined || teacher.reviewCount === 0) {
    return (
      <Text variant="callout" tone="muted">
        {t('student.teacherProfile.noReviews')}
      </Text>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['1'] }}>
      <Icon name="star" size="sm" fill="filled" />
      <Text variant="callout">
        {t('student.teacherProfile.ratingOf', {
          rating: format.rating(teacher.rating),
          count: teacher.reviewCount,
        })}
      </Text>
    </View>
  );
}
