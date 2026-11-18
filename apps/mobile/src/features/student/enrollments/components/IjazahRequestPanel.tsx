// T020 of specs/005-certification (FR-602, FR-605, FR-607, FR-608; R-HONEST-6): the enrollment's
// ijazah request, as the student reads it. Awaiting the student's name: «بانتظار اسمك», what the
// teacher asked, and the name's sheet; pending: «قيد المراجعة»; issued: «صدرت» and the certificate,
// opened through its signed link, or «قيد الإعداد» until an administrator signs it off; revoked:
// «مسحوبة», never opened, with no reason; rejected: «مرفوض», with no reason (FR-608; the reason is
// the teacher's). The certificates are read under a key holding the enrollment, so the request's
// live event reads them again with it.
import type { EnrollmentsGetOutput } from '@ijazah/contracts';
import { useState } from 'react';
import { View } from 'react-native';

import { Badge, type BadgeProps, Banner, Button, Card, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useT } from '../../../../i18n';
import {
  certificatesOfEnrollmentQueryKey,
  useCertificates,
  useOpenCertificate,
} from '../../certificates';
import { type StudentRequestState, studentRequestStateOf } from '../ijazah-request';
import { CertificateNameSheet } from './CertificateNameSheet';

const BADGE = {
  awaitingName: { label: 'student.ijazahRequest.awaitingName', tone: 'warning' },
  pending: { label: 'status.ijazah.pending', tone: 'neutral' },
  rejected: { label: 'status.ijazah.rejected', tone: 'danger' },
  preparing: { label: 'student.credentials.preparing', tone: 'neutral' },
  issued: { label: 'status.ijazah.issued', tone: 'success' },
  revoked: { label: 'status.ijazah.revoked', tone: 'danger' },
} as const satisfies Readonly<
  Record<Exclude<StudentRequestState, 'none'>, { label: MessageKey; tone: BadgeProps['tone'] }>
>;

export function IjazahRequestPanel({ enrollment }: { readonly enrollment: EnrollmentsGetOutput }) {
  const t = useT();
  const request = enrollment.ijazahRequest;
  const approved = request?.status === 'approved' && request.revoked !== true;
  const certificates = useCertificates(
    certificatesOfEnrollmentQueryKey(enrollment.enrollmentId),
    approved,
  );
  const opener = useOpenCertificate();
  const [naming, setNaming] = useState(false);
  const state = studentRequestStateOf(request, certificates.data?.items);
  if (state === 'none' || request === null) return null;
  const badge = BADGE[state];
  return (
    <Card variant="surface">
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: tokens.space['3'],
        }}
      >
        <Text variant="headline">{t('student.certificate.title')}</Text>
        <Badge label={t(badge.label)} tone={badge.tone} />
      </View>
      {state === 'awaitingName' ? (
        <>
          <Text tone="muted">{t('student.ijazahRequest.awaitingNameText')}</Text>
          <Button
            label={t('student.ijazahRequest.enterName')}
            layout="block"
            onPress={() => setNaming(true)}
          />
        </>
      ) : null}
      {state === 'revoked' ? (
        <Text tone="muted">{t('student.certificate.revoked.title')}</Text>
      ) : null}
      {state === 'issued' && request.ijazahId !== undefined ? (
        <Button
          label={t('student.credentials.view')}
          variant="secondary"
          layout="block"
          loading={opener.busy}
          onPress={() => {
            if (request.ijazahId !== undefined) void opener.open(request.ijazahId);
          }}
        />
      ) : null}
      {opener.failure === null ? null : (
        <Banner icon={{ name: 'triangle-alert' }} tone="warning">
          {t(opener.failure.key, opener.failure.values)}
        </Banner>
      )}
      {naming ? <CertificateNameSheet onClose={() => setNaming(false)} /> : null}
    </Card>
  );
}
