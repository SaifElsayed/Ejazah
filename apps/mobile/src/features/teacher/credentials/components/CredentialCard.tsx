// T059 (FR-153, FR-ISNAD-5): one credential on the credentials page. Its subject and its status;
// approved, the riwaya and the tariq, when it was verified with the length of its chain, and the
// chain itself, read-only, with the holder last; otherwise the date it was sent. The PDF row is named
// after its subject (the file's own name is not stored, owner's decision 2026-10-21) with its size
// when the upload recorded one; an approved credential's PDF opens through a signed link. A
// credential waiting on a document opens its request.
// T110: a rejected credential says the reviewer's reason under its subject (spec.md, Edge cases).
import type { CredentialSummary } from '@ijazah/contracts';
import { View } from 'react-native';

import { Badge, Card, FileRow, Text } from '../../../../design/primitives';
import type { BadgeProps } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useT } from '../../../../i18n';
import { useSubjectName } from '../../../../lib/subjects';
import { Chain } from '../../../shared/credentials/components/Chain';
import { useFileSize } from '../../../shared/documents';

const STATUS: Readonly<
  Record<CredentialSummary['status'], { label: MessageKey; tone: BadgeProps['tone'] }>
> = {
  approved: { label: 'status.credential.approved', tone: 'accent' },
  pending: { label: 'status.credential.pending', tone: 'neutral' },
  needs_document: { label: 'status.credential.needsDocument', tone: 'warning' },
  rejected: { label: 'status.credential.rejected', tone: 'danger' },
};

export function CredentialCard({
  credential,
  dated,
  onOpenRequest,
  onOpenFile,
}: {
  readonly credential: CredentialSummary;
  readonly dated: (instant: string) => string;
  readonly onOpenRequest: () => void;
  readonly onOpenFile: () => void;
}) {
  const t = useT();
  const nameOf = useSubjectName();
  const size = useFileSize();
  const subject = nameOf(credential.subject);
  const status = STATUS[credential.status];
  const approved = credential.status === 'approved';
  const generations = credential.chain ?? [];
  return (
    <Card
      variant={approved ? 'accent' : 'default'}
      {...(credential.status === 'needs_document' ? { onPress: onOpenRequest } : {})}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['2'] }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="headline">{subject}</Text>
        </View>
        <Badge label={t(status.label)} tone={status.tone} />
      </View>
      {credential.status === 'rejected' && credential.note !== undefined ? (
        <Text>{credential.note}</Text>
      ) : null}
      {approved && credential.riwaya !== undefined ? (
        <Text variant="callout">
          {credential.tariq === undefined
            ? t('teacher.credentials.riwayaOnly', { riwaya: credential.riwaya })
            : t('teacher.credentials.riwayaLine', {
                riwaya: credential.riwaya,
                tariq: credential.tariq,
              })}
        </Text>
      ) : null}
      <Text variant="caption" tone="muted">
        {approved && credential.reviewedAt !== undefined
          ? t('teacher.credentials.verifiedOn', {
              date: dated(credential.reviewedAt),
              count: generations.length,
            })
          : t('teacher.credentials.submittedOn', { date: dated(credential.submittedAt) })}
      </Text>
      {approved && generations.length > 0 ? (
        <Chain
          generations={generations}
          {...(credential.holderName === undefined ? {} : { holder: credential.holderName })}
        />
      ) : null}
      <FileRow
        name={t('teacher.credentials.fileName', { subject })}
        {...(credential.document.sizeBytes === undefined
          ? {}
          : { meta: size(credential.document.sizeBytes) })}
        {...(approved
          ? {
              action: {
                icon: { name: 'eye' },
                accessibilityLabel: t('teacher.credentials.a11y.openFile'),
                onPress: onOpenFile,
              },
            }
          : {})}
      />
    </Card>
  );
}
