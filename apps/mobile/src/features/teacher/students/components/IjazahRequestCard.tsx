// 005:T019 (FR-603, FR-608; contracts/app-surface.md, «Enrollment reads gain»): the ijazah on an
// ijazah-track enrollment of the teacher's, as `teacher.students.get` answers its latest request. The
// request's status: waiting for the student's certificate name (its own words, the note under T019),
// pending, issued with its certificate (opened by its signed link; «being prepared» until signed off,
// FR-629), rejected with the reason, or revoked. While the enrollment is confirmed or completed and
// no request is open or issued (none, rejected, closed, or an issued one revoked), the prompt asks for
// one and opens the request's sheet (FR-603's `already_issued` is one ijazah until a revocation). The
// live channel's signal of the enrollment reads it again (`lib/live-channel.ts`), so the status
// follows each decision while the screen is open.
import type { EnrollmentIjazahRequest, TeacherStudentsGetOutput } from '@ijazah/contracts';
import * as Linking from 'expo-linking';
import { useState } from 'react';

import { Banner, Button, Card, Section, Text } from '../../../../design/primitives';
import { type MessageKey, useT } from '../../../../i18n';
import type { ErrorMessage } from '../../../../lib/error-message';
import { usePartyName } from '../../../../lib/party';
import { certificateFailureOf, useIjazahRequestActions } from '../ijazah-request';
import { IjazahRequestSheet } from './IjazahRequestSheet';

/** The enrollment states a request may be sent from (R-404). */
const REQUESTABLE: ReadonlySet<string> = new Set(['confirmed', 'completed']);

/** The status's words, or null for a request that is no longer one (closed). */
function statusWordOf(request: EnrollmentIjazahRequest): MessageKey | null {
  switch (request.status) {
    case 'awaiting_student_name':
      return 'teacher.enrollment.ijazahRequest.awaitingName';
    case 'pending':
      return 'status.ijazah.pending';
    case 'approved':
      return request.revoked === true ? 'status.ijazah.revoked' : 'status.ijazah.issued';
    case 'rejected':
      return 'status.ijazah.rejected';
    case 'closed':
      return null;
  }
}

/** Whether a new request may be asked: none open and none issued unrevoked. */
function mayRequest(request: EnrollmentIjazahRequest | null): boolean {
  if (request === null) return true;
  if (request.status === 'approved') return request.revoked === true;
  return request.status === 'rejected' || request.status === 'closed';
}

export function IjazahRequestCard({
  enrollment,
}: {
  readonly enrollment: TeacherStudentsGetOutput;
}) {
  const t = useT();
  const partyName = usePartyName();
  const actions = useIjazahRequestActions(enrollment.enrollmentId);
  const [requesting, setRequesting] = useState(false);
  const [opening, setOpening] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  if (enrollment.summary.track !== 'ijazah_track') return null;
  const request = enrollment.ijazahRequest;
  const word = request === null ? null : statusWordOf(request);
  const student = partyName(enrollment.student, 'student');
  const ijazahId =
    request?.status === 'approved' && request.revoked !== true ? request.ijazahId : undefined;
  const askable = REQUESTABLE.has(enrollment.status) && mayRequest(request);

  async function openCertificate(id: string): Promise<void> {
    setFailure(null);
    setOpening(true);
    try {
      await Linking.openURL(await actions.certificateLink(id));
    } catch (caught: unknown) {
      setFailure(certificateFailureOf(caught));
    } finally {
      setOpening(false);
    }
  }

  return (
    <Section title={t('teacher.enrollment.ijazah.title')}>
      <Card variant="accent">
        {word === null ? null : (
          <Text weight="medium">
            {t('teacher.enrollment.ijazahRequest.status', { status: t(word) })}
          </Text>
        )}
        {request?.status === 'rejected' && request.reason !== undefined ? (
          <Text variant="callout" tone="muted">
            {t('teacher.enrollment.ijazahRequest.rejectedReason', { reason: request.reason })}
          </Text>
        ) : null}
        {ijazahId === undefined ? null : (
          <Button
            label={t('teacher.enrollment.ijazah.view')}
            variant="secondary"
            loading={opening}
            disabled={opening}
            onPress={() => void openCertificate(ijazahId)}
          />
        )}
        {failure === null ? null : (
          <Banner icon={{ name: 'info' }} tone="info">
            {t(failure.key, failure.values)}
          </Banner>
        )}
        {askable ? (
          <>
            <Text variant="callout">{t('teacher.enrollment.ijazah.prompt', { student })}</Text>
            <Button
              label={t('teacher.enrollment.ijazah.request')}
              onPress={() => setRequesting(true)}
            />
          </>
        ) : null}
      </Card>
      {requesting ? (
        <IjazahRequestSheet
          enrollmentId={enrollment.enrollmentId}
          studentName={student}
          earliest={enrollment.sessions[0]?.localDate}
          onClose={() => setRequesting(false)}
        />
      ) : null}
    </Section>
  );
}
