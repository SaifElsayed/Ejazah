// T020 of specs/005-certification (FR-607; R-HONEST-6): the student's ijazahs tab. Each ijazah by
// its subject, with the granting teacher's name as it prints and the day it was issued in the
// student's zone. A ready one (signed off) opens through its signed link in the browser; one not yet
// signed off reads «قيد الإعداد» and a revoked one «مسحوبة», and neither opens. With none, the tab's
// empty state (`CredentialsEmpty`); a failed read again says so over the list it holds.
import type { CertificateItem } from '@ijazah/contracts';
import { View } from 'react-native';

import { AppHeader, Badge, Banner, List, ListRow, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { useFormatters } from '../../../../lib/formatters';
import { useOnline } from '../../../../lib/online';
import { useSubjectName } from '../../../../lib/subjects';
import { TabScreen } from '../../../shared/screen';
import { LoadError, NotLoaded, OfflineNotice } from '../../../shared/states';
import { CredentialsEmpty } from '../../credentials';
import { certificateStateOf, useCertificates, useOpenCertificate } from '../api';

export function Certificates() {
  const t = useT();
  const online = useOnline();
  const me = useMe();
  const certificates = useCertificates();
  const opener = useOpenCertificate();
  const zone = me.data?.timezone;
  const retry = () => {
    void certificates.refetch();
    if (me.isError) void me.refetch();
  };
  const header = <AppHeader title={t('student.credentials.title')} />;
  if (certificates.data === undefined || zone === undefined) {
    return (
      <TabScreen header={header}>
        <NotLoaded
          failed={certificates.isError || me.isError}
          error={certificates.error ?? me.error}
          onRetry={retry}
        />
      </TabScreen>
    );
  }
  const { items } = certificates.data;
  if (items.length === 0) return <CredentialsEmpty />;
  return (
    <TabScreen header={header}>
      <OfflineNotice onRetry={retry} />
      {certificates.isError && online ? (
        <LoadError error={certificates.error} onRetry={retry} />
      ) : null}
      {opener.failure === null ? null : (
        <Banner icon={{ name: 'triangle-alert' }} tone="warning">
          {t(opener.failure.key, opener.failure.values)}
        </Banner>
      )}
      <List>
        {items.map((item) => (
          <CertificateRow
            key={item.ijazahId}
            item={item}
            zone={zone}
            onOpen={opener.busy ? undefined : () => void opener.open(item.ijazahId)}
          />
        ))}
      </List>
    </TabScreen>
  );
}

function CertificateRow({
  item,
  zone,
  onOpen,
}: {
  readonly item: CertificateItem;
  readonly zone: string;
  readonly onOpen: (() => void) | undefined;
}) {
  const t = useT();
  const format = useFormatters();
  const subjectName = useSubjectName();
  const state = certificateStateOf(item);
  const label = (
    <View style={{ gap: tokens.space['1'] }}>
      <Text weight="medium">{subjectName(item.subject)}</Text>
      <Text variant="callout" tone="muted">
        {t('student.credentials.teacherIssued', {
          teacher: item.teacherName,
          date: format.date(item.issuedAt, zone),
        })}
      </Text>
    </View>
  );
  if (state === 'ready') {
    return (
      <ListRow
        label={label}
        value={t('student.credentials.view')}
        onPress={onOpen ?? (() => undefined)}
      />
    );
  }
  return (
    <ListRow
      label={label}
      trailing={
        state === 'revoked' ? (
          <Badge label={t('status.ijazah.revoked')} tone="danger" />
        ) : (
          <Badge label={t('student.credentials.preparing')} tone="neutral" />
        )
      }
    />
  );
}
