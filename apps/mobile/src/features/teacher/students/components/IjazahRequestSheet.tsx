// 005:T019 (FR-603, FR-IJAZAH-15, FR-LOC-4; contracts/app-surface.md, `teacher.ijazahRequests.preview`
// and `.send`): the ijazah request's sheet on the teacher's enrollment. First the details: the
// completion date (the teacher's today unless changed, in three lists, `CompletionDateLists`) and the
// certificate's language (Arabic unless chosen); then the certificate as it will be filled, read from
// `preview` (the chain origin first with the teacher last, the riwaya and its tariq, the student's
// certificate name or that the student will be asked for it, the dates); then «إرسال الطلب». A refusal
// of either step is said in the sheet in its own words; a missing signature says so with the way to
// upload one (`teacher.ijazahRequest.blocked.*`). The sheet closes once the request is sent.
import type { IjazahRequestsPreviewOutput } from '@ijazah/contracts';
import { calendarDateOfPicked } from '@ijazah/time/calendar';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  Banner,
  Button,
  Field,
  Segmented,
  Select,
  Sheet,
  Summary,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useFormatters } from '../../../../lib/formatters';
import { Chain } from '../../../shared/credentials/components/Chain';
import { SIGNATURE_ROUTE } from '../../signature/navigation';
import { type RequestFailure, requestFailureOf, useIjazahRequestActions } from '../ijazah-request';
import { CompletionDateLists } from './CompletionDateLists';

type Language = 'ar' | 'en';

type Step =
  | { readonly kind: 'details' }
  | { readonly kind: 'date' }
  | { readonly kind: 'preview'; readonly certificate: IjazahRequestsPreviewOutput };

export function IjazahRequestSheet({
  enrollmentId,
  studentName,
  earliest,
  onClose,
}: {
  readonly enrollmentId: string;
  /** The student as the screen names them, for the missing signature's words. */
  readonly studentName: string;
  /** The first day the completion date may be: the enrollment's first session's. */
  readonly earliest: string | undefined;
  readonly onClose: () => void;
}) {
  const t = useT();
  const format = useFormatters();
  const actions = useIjazahRequestActions(enrollmentId);
  const today = calendarDateOfPicked(new Date());
  const [completionDate, setCompletionDate] = useState(today);
  const [language, setLanguage] = useState<Language>('ar');
  const [step, setStep] = useState<Step>({ kind: 'details' });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RequestFailure | null>(null);
  const input = { enrollmentId, completionDate, language };

  async function attempt(work: () => Promise<void>): Promise<void> {
    setFailure(null);
    setBusy(true);
    try {
      await work();
    } catch (caught: unknown) {
      setFailure(requestFailureOf(caught));
    } finally {
      setBusy(false);
    }
  }

  const preview = () =>
    attempt(async () => {
      setStep({ kind: 'preview', certificate: await actions.preview(input) });
    });
  const send = () =>
    attempt(async () => {
      await actions.send(input);
      onClose();
    });

  return (
    <Sheet open onClose={onClose} title={t('teacher.ijazahRequest.title')} snapPoints={[0.9]}>
      {step.kind === 'date' ? (
        <CompletionDateLists
          initial={completionDate}
          earliest={earliest !== undefined && earliest < today ? earliest : today}
          latest={today}
          onDone={(date) => {
            setCompletionDate(date);
            setStep({ kind: 'details' });
          }}
        />
      ) : step.kind === 'preview' ? (
        <Preview certificate={step.certificate} language={language} />
      ) : (
        <>
          <Field label={t('teacher.ijazahRequest.completionDate')}>
            <Select
              label={t('teacher.ijazahRequest.completionDate')}
              value={format.calendarDate(completionDate)}
              onPress={() => {
                setFailure(null);
                setStep({ kind: 'date' });
              }}
            />
          </Field>
          <Field label={t('teacher.ijazahRequest.language')}>
            <Segmented
              accessibilityLabel={t('teacher.ijazahRequest.language')}
              value={language}
              onChange={(value) => setLanguage(value === 'en' ? 'en' : 'ar')}
              options={[
                { value: 'ar', label: t('account.languages.ar') },
                { value: 'en', label: t('account.languages.en') },
              ]}
            />
          </Field>
        </>
      )}
      {failure === null ? null : (
        <Failure failure={failure} studentName={studentName} onUpload={onClose} />
      )}
      {step.kind === 'details' ? (
        <Button
          label={t('teacher.ijazahRequest.preview')}
          layout="block"
          loading={busy}
          disabled={busy}
          onPress={() => void preview()}
        />
      ) : null}
      {step.kind === 'preview' ? (
        <View style={{ gap: tokens.space['2'] }}>
          <Button
            label={t('teacher.ijazahRequest.send')}
            layout="block"
            loading={busy}
            disabled={busy}
            onPress={() => void send()}
          />
          <Button
            label={t('common.action.back')}
            layout="block"
            variant="ghost"
            disabled={busy}
            onPress={() => {
              setFailure(null);
              setStep({ kind: 'details' });
            }}
          />
        </View>
      ) : null}
    </Sheet>
  );
}

/** The certificate as `preview` fills it. */
function Preview({
  certificate,
  language,
}: {
  readonly certificate: IjazahRequestsPreviewOutput;
  readonly language: Language;
}) {
  const t = useT();
  const format = useFormatters();
  const riwaya =
    certificate.tariq === null
      ? certificate.riwaya
      : t('teacher.ijazahRequest.riwayaValue', {
          riwaya: certificate.riwaya,
          tariq: certificate.tariq,
        });
  return (
    <>
      <Field label={t('teacher.ijazahRequest.chain')}>
        <Chain
          generations={certificate.chain.map((names, index) => ({ position: index + 1, names }))}
        />
      </Field>
      <Summary
        rows={[
          { label: t('teacher.ijazahRequest.riwaya'), value: riwaya },
          {
            label: t('teacher.ijazahRequest.student'),
            value: certificate.studentName ?? t('teacher.ijazahRequest.studentMissing'),
          },
          {
            label: t('teacher.ijazahRequest.completionDate'),
            value: format.calendarDate(certificate.dates.completionDate),
          },
          {
            label: t('teacher.ijazahRequest.issueDate'),
            value: format.calendarDate(certificate.dates.issueDate),
          },
          {
            label: t('teacher.ijazahRequest.language'),
            value: t(language === 'en' ? 'account.languages.en' : 'account.languages.ar'),
          },
        ]}
      />
    </>
  );
}

/** A refusal in the sheet; a missing signature with the way to upload one. */
function Failure({
  failure,
  studentName,
  onUpload,
}: {
  readonly failure: RequestFailure;
  readonly studentName: string;
  readonly onUpload: () => void;
}) {
  const t = useT();
  if (!('kind' in failure)) {
    return (
      <Banner icon={{ name: 'alert-circle' }} tone="danger">
        {t(failure.key, failure.values)}
      </Banner>
    );
  }
  return (
    <Banner icon={{ name: 'alert-circle' }} tone="warning">
      <View style={{ gap: tokens.space['2'] }}>
        <Text weight="bold">{t('teacher.ijazahRequest.blocked.title')}</Text>
        <Text>{t('teacher.ijazahRequest.blocked.text', { student: studentName })}</Text>
        <Button
          label={t('teacher.ijazahRequest.blocked.upload')}
          variant="secondary"
          onPress={() => {
            onUpload();
            router.push(SIGNATURE_ROUTE);
          }}
        />
      </View>
    </Banner>
  );
}
