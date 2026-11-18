// T021 of specs/005-certification (FR-611, FR-614; the note under T021, Q-T5 (a)): the one report
// and flag sheet, both roles (R-MOBILE-3). The person reported is named in the title; the reasons of
// the reporter's role, one chosen; the details, optional, bounded so the text sent stays within the
// contract's (`reasons.ts`). Sent, the sheet says «received» and nothing else (spec.md:305:
// `common.toast.reportSent`); a refusal is said in place and the sheet stays.
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Banner, Button, Choice, Field, Input, Sheet, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import type { ErrorMessage } from '../../../../lib/error-message';
import { reportRefusal, useFileReport } from '../api';
import {
  detailsTooLong,
  REPORT_WORDS,
  type ReportReason,
  type ReportTarget,
  reportTextOf,
} from '../reasons';

export function ReportSheet({
  target,
  onClose,
}: {
  readonly target: ReportTarget;
  readonly onClose: () => void;
}) {
  const t = useT();
  const words = REPORT_WORDS[target.role];
  const filing = useFileReport(target);
  const [chosen, setChosen] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  const [received, setReceived] = useState(false);
  const text = chosen === null ? undefined : reportTextOf(t(chosen.label), details);
  const tooLong = chosen === null ? detailsTooLong(details) : text === undefined;
  const title =
    target.role === 'teacher'
      ? t('student.report.title', { teacher: target.name })
      : t('teacher.report.title', { student: target.name });

  async function send(): Promise<void> {
    if (chosen === null || text === undefined) return;
    setBusy(true);
    setFailure(null);
    try {
      await filing.file(text, chosen.flag);
      setReceived(true);
    } catch (caught: unknown) {
      setFailure(reportRefusal(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={title}>
      {received ? (
        <View style={{ gap: tokens.space['3'] }}>
          <Banner icon={{ name: 'check' }} tone="success">
            {t('common.toast.reportSent')}
          </Banner>
          <Button
            label={t('common.action.close')}
            variant="secondary"
            layout="block"
            onPress={onClose}
          />
        </View>
      ) : (
        <>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: tokens.space['4'] }}
          >
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={t(words.reasonLabel)}
              style={{ gap: tokens.space['2'] }}
            >
              <Text variant="callout" tone="muted">
                {t(words.reasonLabel)}
              </Text>
              {words.reasons.map((reason) => (
                <Choice
                  key={reason.label}
                  label={t(reason.label)}
                  selected={chosen?.label === reason.label}
                  onPress={() => setChosen(reason)}
                />
              ))}
            </View>
            <Field
              label={t(words.details)}
              {...(tooLong ? { error: t('common.report.tooLong') } : {})}
            >
              <Input
                value={details}
                onChangeText={setDetails}
                placeholder={t(words.detailsPlaceholder)}
                multiline
                disabled={busy}
              />
            </Field>
          </ScrollView>
          {failure === null ? null : (
            <Banner icon={{ name: 'triangle-alert' }} tone="danger">
              {t(failure.key, failure.values)}
            </Banner>
          )}
          <Button
            label={t(words.submit)}
            layout="block"
            loading={busy}
            disabled={text === undefined}
            onPress={() => void send()}
          />
        </>
      )}
    </Sheet>
  );
}
