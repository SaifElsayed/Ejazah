// T072 (FR-163, FR-164): the selected credential's panel (`AdminCredentials`, `AdminCredentialCorrect`).
// The header: the subject and the teacher, where the file came from and when (or when and by whom it
// was verified), «طلب الانضمام» for an application's file, and the status. A waiting credential is
// transcribed (the holder's name as on the file, the riwaya, the tariq, the chain by generation from
// its origin to the holder) and approved, sent back for another document with what is needed, or
// rejected. A verified one is corrected with a reason; each generation it changes says what it was.
// One waiting on a file, or rejected, shows what the teacher was told. Every decision is confirmed
// (`CredentialConfirm`). A long chain shows its ends and folds its middle until it is opened.
// «اعتماد» waits until the credential's file has loaded beside the panel (T116).
import { useState } from 'react';
import { useNavigate } from 'react-router';

import {
  Badge,
  Banner,
  Button,
  ChainInput,
  Field,
  IconTile,
  Input,
  Panel,
  Skeleton,
  TextLink,
} from '../../design/components';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { errorMessageKey } from '../../lib/error-message';
import { dayMonthYear } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { CredentialConfirm, type CredentialDecision } from './CredentialConfirm';
import { type CredentialDetail, useCredential } from './queries';

export const STATUS_TEXT: Readonly<Record<CredentialDetail['status'], MessageKey>> = {
  pending: 'admin.status.credential.inReview',
  needs_document: 'admin.status.credential.anotherFileNeeded',
  approved: 'admin.status.credential.verified',
  rejected: 'admin.status.credential.rejected',
};

const STATUS_TONE = {
  pending: 'warning',
  needs_document: 'warning',
  approved: 'accent',
  rejected: 'danger',
} as const;

/** A chain longer than this shows its first and last generations and folds the rest. */
const FOLD_OVER = 10;
const SHOWN_FIRST = 5;
const SHOWN_LAST = 2;

type Chain = readonly (readonly string[])[];

export function CredentialPanel({
  credentialId,
  loadedDocument,
}: {
  readonly credentialId: string;
  /** The document whose PDF has loaded beside the panel, if any. */
  readonly loadedDocument: string | null;
}) {
  const t = useT();
  const credential = useCredential(credentialId);
  const loadFailure = errorMessageKey(credential.error, 'admin.common.loadError.text');
  // Said above the panel, which the next read draws anew (B14c review, round 1, finding 1).
  const [moved, setMoved] = useState(false);
  const detail = credential.data;
  if (detail === undefined) {
    return credential.isError ? (
      <Banner icon={{ name: 'alert-circle' }} tone="danger">
        {t(loadFailure.key, loadFailure.values)}
      </Banner>
    ) : (
      <Skeleton shape="block" />
    );
  }
  return (
    <div className="stack gap-4">
      {moved ? (
        <Banner icon={{ name: 'info' }} tone="warning">
          {t('admin.credentials.panel.conflict')}
        </Banner>
      ) : null}
      {/* A new key for each credential and status, so the form starts from what it holds. */}
      <Transcription
        key={`${detail.credentialId}-${detail.status}`}
        detail={detail}
        fileLoaded={loadedDocument === detail.documentId}
        onMoved={() => setMoved(true)}
        onDeciding={() => setMoved(false)}
      />
    </div>
  );
}

function Transcription({
  detail,
  fileLoaded,
  onMoved,
  onDeciding,
}: {
  readonly detail: CredentialDetail;
  readonly fileLoaded: boolean;
  readonly onMoved: () => void;
  /** A new decision begins: the last one's sentence goes (B14c review, round 2). */
  readonly onDeciding: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const zone = panelTimeZone();
  const original: Chain = (detail.chain ?? []).map(({ names }) => names);
  const [holderName, setHolderName] = useState(detail.holderName ?? '');
  const [riwaya, setRiwaya] = useState(detail.riwaya ?? '');
  const [tariq, setTariq] = useState(detail.tariq ?? '');
  const [chain, setChain] = useState<Chain>(original);
  const [unfolded, setUnfolded] = useState(false);
  const [request, setRequest] = useState('');
  const [reason, setReason] = useState('');
  const [deciding, setDecidingState] = useState<CredentialDecision | null>(null);
  const setDeciding = (next: CredentialDecision | null) => {
    if (next !== null) onDeciding();
    setDecidingState(next);
  };

  const teacher = detail.teacher.displayName;
  const subject = locale === 'ar' ? detail.subject.nameAr : detail.subject.nameEn;
  const editing = detail.status === 'pending' || detail.status === 'approved';
  const correcting = detail.status === 'approved';
  const written = {
    holderName: holderName.trim(),
    riwaya: riwaya.trim(),
    tariq: tariq.trim(),
  };
  const complete =
    written.holderName !== '' &&
    written.riwaya !== '' &&
    chain.length > 0 &&
    chain.every((names) => names.length > 0);
  const changes = {
    ...(written.holderName !== (detail.holderName ?? '') ? { holderName: written.holderName } : {}),
    ...(written.riwaya !== (detail.riwaya ?? '') ? { riwaya: written.riwaya } : {}),
    // A correction cannot clear the tariq (the contract's minimum); emptied, it is left as it was.
    ...(written.tariq !== '' && written.tariq !== (detail.tariq ?? '')
      ? { tariq: written.tariq }
      : {}),
    ...(sameChain(chain, original) ? {} : { chain: chain.map((names) => ({ names })) }),
  };

  const meta = correcting
    ? t('admin.credentials.panel.metaVerified', {
        date: detail.reviewedAt === undefined ? '' : dayMonthYear(detail.reviewedAt, locale, zone),
        admin: detail.reviewedByName ?? '',
      })
    : t(
        detail.origin === 'added'
          ? 'admin.credentials.panel.metaAdded'
          : 'admin.credentials.panel.metaAtApplication',
        { date: dayMonthYear(detail.submittedAt, locale, zone) },
      );
  const toApplication = !correcting && detail.origin === 'application';
  const applicationHref = `/applications?teacher=${detail.teacher.userId}`;

  const edit = (index: number, names: readonly string[]) =>
    setChain((current) => current.map((generation, at) => (at === index ? names : generation)));
  const separator = locale === 'ar' ? '، ' : ', ';
  const folded = !unfolded && chain.length > FOLD_OVER;
  const rows = chain.flatMap((names, index) => {
    if (folded && index >= SHOWN_FIRST && index < chain.length - SHOWN_LAST) {
      return index === SHOWN_FIRST
        ? [
            <li key="fold" className="text-caption tone-muted text-center">
              <TextLink
                label={t('admin.credentials.panel.chainEllipsis', {
                  from: SHOWN_FIRST + 1,
                  to: chain.length - SHOWN_LAST,
                })}
                onPress={() => setUnfolded(true)}
              />
            </li>,
          ]
        : [];
    }
    const was = original[index];
    const changed = correcting && (was === undefined || !sameNames(was, names));
    return [
      <ChainInput
        key={`generation-${index}`}
        position={index + 1}
        names={names}
        changed={changed}
        onAddName={(name) => edit(index, [...names, name])}
        onRemoveName={(at) =>
          edit(
            index,
            names.filter((_, kept) => kept !== at),
          )
        }
        onRemove={() => setChain((current) => current.filter((_, kept) => kept !== index))}
      />,
      ...(changed && was !== undefined
        ? [
            <li key={`was-${index}`} className="text-caption tone-muted">
              {t('admin.credentials.panel.generationWas', {
                n: index + 1,
                name: was.join(separator),
              })}
            </li>,
          ]
        : []),
    ];
  });

  return (
    <>
      <Panel
        header={
          <>
            <IconTile icon={{ name: 'file-text', size: 'lg' }} size="lg" tone="accent" />
            <span className="stack grow">
              <strong className="text-title-3">
                {t('admin.credentials.panel.title', { subject, teacher })}
              </strong>
              <span className="text-caption tone-muted">
                {toApplication ? meta : withoutTrailingSeparator(meta)}
                {toApplication ? (
                  <TextLink
                    label={t('admin.credentials.panel.applicationLink')}
                    href={applicationHref}
                    onPress={() => void navigate(applicationHref)}
                  />
                ) : null}
              </span>
            </span>
            <Badge label={t(STATUS_TEXT[detail.status])} tone={STATUS_TONE[detail.status]} />
          </>
        }
        actions={
          detail.status === 'pending' ? (
            <>
              <Button
                label={t('admin.credentials.panel.approve')}
                // A reminder on the screen, not a protection (R-MOBILE-13): the server's rule is T120.
                disabled={!complete || !fileLoaded}
                onPress={() =>
                  setDeciding({
                    kind: 'approve',
                    transcription: {
                      holderName: written.holderName,
                      riwaya: written.riwaya,
                      ...(written.tariq === '' ? {} : { tariq: written.tariq }),
                      chain: chain.map((names) => ({ names })),
                    },
                  })
                }
              />
              <Button
                label={t('admin.credentials.panel.requestAnother')}
                variant="secondary"
                disabled={request.trim() === ''}
                onPress={() => setDeciding({ kind: 'requestDocument', reason: request.trim() })}
              />
              <Button
                label={t('admin.credentials.panel.reject')}
                variant="danger"
                onPress={() => setDeciding({ kind: 'reject' })}
              />
            </>
          ) : detail.status === 'needs_document' ? (
            <Button
              label={t('admin.credentials.panel.reject')}
              variant="danger"
              onPress={() => setDeciding({ kind: 'reject' })}
            />
          ) : correcting ? (
            <Button
              label={t('admin.credentials.panel.saveCorrection')}
              disabled={!complete || reason.trim() === '' || Object.keys(changes).length === 0}
              onPress={() => setDeciding({ kind: 'correct', changes, reason: reason.trim() })}
            />
          ) : undefined
        }
        {...(detail.status === 'pending'
          ? { note: t('admin.credentials.panel.footer') }
          : correcting
            ? { note: t('admin.credentials.panel.correctFooter') }
            : {})}
      >
        {editing ? (
          <>
            <Field
              label={t('admin.credentials.panel.holderName')}
              hint={t('admin.credentials.panel.holderNameHint')}
            >
              <Input value={holderName} onChangeText={setHolderName} />
            </Field>
            <div className="grid-2 gap-4">
              <Field label={t('admin.credentials.panel.riwaya')}>
                <Input value={riwaya} onChangeText={setRiwaya} />
              </Field>
              <Field label={t('admin.credentials.panel.tariq')}>
                <Input value={tariq} onChangeText={setTariq} />
              </Field>
            </div>
            <div className="section__header">
              <span className="row gap-2">
                <h2 className="field__label" id={`chain-${detail.credentialId}`}>
                  {t('admin.credentials.panel.chain')}
                </h2>
                {chain.length === 0 ? null : (
                  <Badge
                    label={t('admin.common.generations', { count: chain.length })}
                    tone="accent"
                  />
                )}
              </span>
              <Button
                label={t('admin.credentials.panel.addGeneration')}
                variant="add"
                icon={{ name: 'plus', size: 'sm' }}
                onPress={() => {
                  setUnfolded(true);
                  setChain((current) => [...current, []]);
                }}
              />
            </div>
            <ol className="picker" aria-labelledby={`chain-${detail.credentialId}`}>
              {rows}
              <li className="row gap-2 text-callout text-medium">
                <IconTile icon={{ name: 'user', size: 'sm' }} size="sm" tone="accent" round />
                {t('admin.credentials.panel.holderRow', { teacher })}
              </li>
            </ol>
            {correcting ? (
              <>
                <ul className="stack gap-2 text-callout">
                  <li className="row row--top gap-2">
                    <IconTile icon={{ name: 'user', size: 'sm' }} size="sm" tone="outline" />
                    <span>{t('admin.credentials.panel.correctEffect1')}</span>
                  </li>
                  <li className="row row--top gap-2">
                    <IconTile icon={{ name: 'award', size: 'sm' }} size="sm" tone="outline" />
                    <span>{t('admin.credentials.panel.correctEffect2')}</span>
                  </li>
                </ul>
                <Field label={t('admin.credentials.panel.correctReason')}>
                  <Input value={reason} onChangeText={setReason} multiline />
                </Field>
              </>
            ) : (
              <Field label={t('admin.credentials.panel.requestLabel')}>
                <Input
                  value={request}
                  onChangeText={setRequest}
                  placeholder={t('admin.credentials.panel.requestPlaceholder')}
                />
              </Field>
            )}
          </>
        ) : (
          <section className="section">
            <h2 className="group-label">{t('admin.credentials.panel.reviewReason')}</h2>
            <p className="text-callout">
              <bdi>{detail.reviewReason ?? ''}</bdi>
            </p>
          </section>
        )}
      </Panel>
      {deciding === null ? null : (
        <CredentialConfirm
          decision={deciding}
          detail={detail}
          onClose={() => setDeciding(null)}
          // A saved correction leaves no reason for the next one (B14c review, round 1).
          onDone={() => setReason('')}
          onMoved={onMoved}
        />
      )}
    </>
  );
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index]);
}

function sameChain(a: Chain, b: Chain): boolean {
  return a.length === b.length && a.every((names, index) => sameNames(names, b[index] ?? []));
}

/** The drawn meta line ends with « · » before its link; without the link the separator goes. */
function withoutTrailingSeparator(text: string): string {
  // Every trailing separator: an approval with no reviewer's name leaves two (B14c review, nit).
  return text.replace(/(\s·\s*)+$/, '');
}
