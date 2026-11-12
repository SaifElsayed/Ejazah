// B42 lane S (T049, T050; spec FR-487; SRS FR-AUTH-14 as amended on 2026-11-06; research R-327):
// a deleted party's held files inside an open matter, over T040's `disputes.heldFiles` and
// `disputes.heldFileLink`. The page draws it only while its dispute, case or complaint is open and
// a party of its enrollment is deleted, with that matter's id. The list is the server's metadata
// (the kind, the owner's role, a document's upload), never a link: each file's view mints one
// signed link on its press (`held_file.view`, one audit entry per press) and opens it, and a link
// is never asked for before the press nor kept for the next one, since it expires in minutes.
// `NOT_FOUND` and `CONFLICT` (`not_open`) are said in plain words; any other failure, the page's
// generic words (`admin.common.loadError.text` for the list, `admin.dialogs.submitError` for a link).
import type { HeldFileItem } from '@ijazah/contracts/admin';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Banner, Button, List, ListRow, Skeleton } from '../../design/components';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { useAdmin } from '../../lib/admin-context';
import { errorCodeOf } from '../../lib/client';
import { dayMonthYear } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';

const KIND: Readonly<Record<HeldFileItem['kind'], MessageKey>> = {
  photo: 'admin.shared.heldFiles.kind.photo',
  national_id: 'admin.common.documentType.nationalId',
  passport: 'admin.common.documentType.passport',
  credential: 'admin.shared.heldFiles.kind.credential',
  other: 'admin.shared.heldFiles.kind.other',
};

const OWNER: Readonly<Record<HeldFileItem['ownerRole'], MessageKey>> = {
  student: 'admin.shared.heldFiles.owner.student',
  teacher: 'admin.shared.heldFiles.owner.teacher',
};

/** The words of a refused read: the list's (`generic` the read's own) or a link's. */
function heldFilesFailure(error: unknown, generic: MessageKey, notFound: MessageKey): MessageKey {
  switch (errorCodeOf(error)) {
    case 'NOT_FOUND':
      return notFound;
    case 'CONFLICT':
      return 'admin.shared.heldFiles.refused.notOpen';
    default:
      return generic;
  }
}

export interface HeldFilesSectionProps {
  /** The open dispute's, compensation case's or complaint's id. */
  readonly disputeId: string;
}

export function HeldFilesSection({ disputeId }: HeldFilesSectionProps) {
  const t = useT();
  const { client } = useAdmin();
  const list = useQuery({
    queryKey: ['disputes', 'heldFiles', disputeId],
    queryFn: () => client.api.disputes.heldFiles.query({ disputeId }),
  });
  return (
    <section className="section">
      <h2 className="group-label">{t('admin.shared.heldFiles.title')}</h2>
      <p className="text-caption tone-muted">{t('admin.shared.heldFiles.note')}</p>
      {list.data !== undefined ? (
        list.data.files.length === 0 ? (
          <p className="text-callout">{t('admin.shared.heldFiles.empty')}</p>
        ) : (
          <List>
            {list.data.files.map((file) => (
              <HeldFileRow key={file.fileRef} disputeId={disputeId} file={file} />
            ))}
          </List>
        )
      ) : list.isError ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(
            heldFilesFailure(
              list.error,
              'admin.common.loadError.text',
              'admin.shared.heldFiles.refused.notFound',
            ),
          )}
        </Banner>
      ) : (
        <Skeleton shape="block" />
      )}
    </section>
  );
}

function HeldFileRow({
  disputeId,
  file,
}: {
  readonly disputeId: string;
  readonly file: HeldFileItem;
}) {
  const t = useT();
  const locale = useLocale();
  const { client } = useAdmin();
  const [failure, setFailure] = useState<MessageKey | undefined>(undefined);
  const link = useMutation({
    mutationFn: () => client.api.disputes.heldFileLink.mutate({ disputeId, fileRef: file.fileRef }),
  });
  const kind = t(KIND[file.kind]);
  const owner = t(OWNER[file.ownerRole]);
  return (
    <ListRow
      label={
        <span className="stack gap-half">
          <span>{kind}</span>
          <span className="row wrap gap-2 text-caption tone-muted">
            <span>{owner}</span>
            {file.uploadedAt === undefined ? null : (
              <span>
                {t('admin.shared.heldFiles.uploaded', {
                  date: dayMonthYear(file.uploadedAt, locale, panelTimeZone()),
                })}
              </span>
            )}
          </span>
          {failure === undefined ? null : (
            <span className="text-caption tone-danger">{t(failure)}</span>
          )}
        </span>
      }
      trailing={
        <Button
          label={t('admin.shared.heldFiles.view')}
          accessibilityLabel={t('admin.shared.heldFiles.viewFile', {
            file: kind,
            owner: file.ownerRole,
          })}
          variant="secondary"
          icon={{ name: 'eye' }}
          loading={link.isPending}
          onPress={() => {
            setFailure(undefined);
            link.mutate(undefined, {
              onSuccess: ({ url }) => {
                window.open(url, '_blank', 'noopener,noreferrer');
              },
              onError: (error) =>
                setFailure(
                  heldFilesFailure(
                    error,
                    'admin.dialogs.submitError',
                    'admin.shared.heldFiles.refused.fileNotFound',
                  ),
                ),
            });
          }}
        />
      }
    />
  );
}
