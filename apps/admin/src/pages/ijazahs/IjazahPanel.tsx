// 005:T022 (B49; FR-609, FR-610, FR-629; R-412; the note under T022): one ijazah beside the list,
// as `ijazahs.get` answers it. The header names its number in groups of four and its status; the
// frozen record (the student's and the grantor's printed names, the subject, riwaya and tariq, the
// completion date, the language, the chain), the revocation's reason, and its request. The rendered
// PDF drawn from `pdfLink`, one page at a time, as `pages/credentials/` draws a file; before its
// rendering (`pdfLink` null) the words that say it is being prepared, and no file is opened. The
// actions its state allows: the sign-off while rendered (FR-629), the re-render until signed off,
// the revocation until revoked (FR-609), and the bar and its lift on its student (FR-610). Words that
// need data v1.0 does not have («approved by {admin}», the public verification page) are not drawn.
import { useState } from 'react';
import { useNavigate } from 'react-router';

import {
  Badge,
  Banner,
  Button,
  KeyValue,
  Panel,
  Skeleton,
  TextLink,
} from '../../design/components';
import { useLocale, useT } from '../../i18n';
import { errorMessageKey } from '../../lib/error-message';
import { dayMonthYear } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { DocumentPages, usePdf } from '../documents/DocumentPages';
import { ActionDialog } from './ActionDialog';
import { type IjazahDetail, useIjazah, useIjazahActions } from './queries';
import { StudentBar, useStudentName } from './StudentBar';
import { groupedNumber, IJAZAH_STATUS, ijazahFailure } from './words';

export function IjazahPanel({ ijazahId }: { readonly ijazahId: string }) {
  const t = useT();
  const read = useIjazah(ijazahId);
  if (read.data !== undefined) return <IjazahRecord ijazah={read.data} />;
  if (read.isError) {
    const failure = errorMessageKey(read.error, 'admin.common.loadError.text');
    return (
      <Banner icon={{ name: 'alert-circle' }} tone="danger">
        {t(failure.key, failure.values)}
      </Banner>
    );
  }
  return <Skeleton shape="block" />;
}

type Acting = 'signOff' | 'rerender' | 'revoke';

function IjazahRecord({ ijazah }: { readonly ijazah: IjazahDetail }) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const navigate = useNavigate();
  const nameOf = useStudentName();
  const actions = useIjazahActions();
  const [acting, setActing] = useState<Acting | null>(null);
  const status = IJAZAH_STATUS[ijazah.status];
  const code = groupedNumber(ijazah.certificateNumber);
  const subject = locale === 'ar' ? ijazah.subject.nameAr : ijazah.subject.nameEn;
  const generations = t('admin.common.generations', { count: ijazah.chain.length });
  const unsigned = ijazah.signedOffAt === null && !ijazah.revoked;
  const requestHref =
    ijazah.requestId === null ? null : `/ijazah-requests?request=${ijazah.requestId}`;
  const close = () => setActing(null);

  return (
    <>
      <Panel
        header={
          <span className="row wrap gap-2 grow">
            <strong className="text-title-3 certificate-number ltr">{code}</strong>
            <Badge label={t(status.label)} tone={status.tone} />
          </span>
        }
      >
        <section className="section">
          <p className="text-callout">
            {t('admin.ijazahs.detail.subtitle', { subject, riwaya: ijazah.riwaya })}
          </p>
          <KeyValue
            columns={2}
            items={[
              {
                label: t('admin.ijazahs.detail.student'),
                value: <bdi>{ijazah.studentNamePrinted}</bdi>,
              },
              {
                label: t('admin.ijazahs.detail.grantor'),
                value: <bdi>{ijazah.teacherNamePrinted}</bdi>,
              },
              {
                label: t('admin.ijazahs.detail.completionDate'),
                value:
                  ijazah.completionDate === null
                    ? t('admin.payments.dash')
                    : dayMonthYear(ijazah.completionDate, locale, zone),
              },
              {
                label: t('admin.ijazahs.detail.language'),
                value: t(`admin.common.language.${ijazah.language}`),
              },
              {
                label: t('admin.ijazahs.columns.issued'),
                value: dayMonthYear(ijazah.grantedAt, locale, zone),
              },
              {
                label: t('admin.ijazahs.detail.request'),
                value:
                  requestHref === null ? (
                    t('admin.payments.dash')
                  ) : (
                    <TextLink
                      label={t('admin.ijazahs.detail.openRequest')}
                      href={requestHref}
                      onPress={() => void navigate(requestHref)}
                    />
                  ),
              },
            ]}
          />
          {ijazah.revokedAt === null ? null : (
            <Banner icon={{ name: 'ban' }} tone="danger">
              <span className="stack gap-1">
                <strong>
                  {t('admin.ijazahs.revokedOn', {
                    date: dayMonthYear(ijazah.revokedAt, locale, zone),
                  })}
                </strong>
                {ijazah.revokedReason === null ? null : (
                  <span>
                    {t('admin.ijazahs.detail.revokedReason', { reason: ijazah.revokedReason })}
                  </span>
                )}
              </span>
            </Banner>
          )}
        </section>
        <section className="section">
          <h2 className="group-label">
            {ijazah.tariq === null
              ? t('admin.ijazahs.detail.chainTitleNoTariq', { generations })
              : t('admin.ijazahs.detail.chainTitle', { generations, tariq: ijazah.tariq })}
          </h2>
          <ol className="stack gap-1 text-callout">
            {ijazah.chain.map((names, index) => (
              <li key={`${String(index)}-${names.join('|')}`} className="row wrap gap-2">
                {names.map((name) => (
                  <bdi key={name}>{name}</bdi>
                ))}
              </li>
            ))}
          </ol>
        </section>
        <section className="section">
          <h2 className="group-label">{t('admin.ijazahs.pdf.title')}</h2>
          {ijazah.pdfLink === null ? (
            <p className="text-callout tone-muted">{t('admin.ijazahs.pdf.notRendered')}</p>
          ) : (
            <IjazahPdf key={ijazah.pdfLink} url={ijazah.pdfLink} name={code} />
          )}
        </section>
        <section className="section">
          <span className="row wrap gap-2">
            {ijazah.status === 'rendered' ? (
              <Button
                label={t('admin.ijazahs.detail.signOff')}
                variant="primary"
                onPress={() => setActing('signOff')}
              />
            ) : null}
            {unsigned ? (
              <Button
                label={t('admin.ijazahs.detail.rerender')}
                variant="secondary"
                onPress={() => setActing('rerender')}
              />
            ) : null}
            {ijazah.revoked ? null : (
              <Button
                label={t('admin.ijazahs.detail.revoke')}
                variant="danger"
                onPress={() => setActing('revoke')}
              />
            )}
          </span>
        </section>
        <section className="section">
          <h2 className="group-label">
            <bdi>{nameOf(ijazah.student)}</bdi>
          </h2>
          <StudentBar student={ijazah.student} />
        </section>
      </Panel>
      {acting === 'signOff' ? (
        <ActionDialog
          title={t('admin.dialogs.confirm.signOffIjazah.title', { code })}
          icon="circle-check"
          tone="primary"
          effects={[
            t('admin.dialogs.confirm.signOffIjazah.effects.shown'),
            t('admin.dialogs.confirm.signOffIjazah.effects.final'),
          ]}
          confirm={t('admin.dialogs.confirm.signOffIjazah.confirm')}
          run={(_reason, key) => actions.signOff(ijazah.ijazahId, key)}
          failureOf={ijazahFailure}
          onClose={close}
        />
      ) : null}
      {acting === 'rerender' ? (
        <ActionDialog
          title={t('admin.dialogs.confirm.rerenderIjazah.title', { code })}
          icon="refresh-cw"
          tone="primary"
          effects={[
            t('admin.dialogs.confirm.rerenderIjazah.effects.rendered'),
            t('admin.dialogs.confirm.rerenderIjazah.effects.notShown'),
          ]}
          reason={{ label: t('admin.dialogs.confirm.rerenderIjazah.reasonLabel') }}
          confirm={t('admin.dialogs.confirm.rerenderIjazah.confirm')}
          run={(reason, key) => actions.rerender(ijazah.ijazahId, reason, key)}
          failureOf={ijazahFailure}
          onClose={close}
        />
      ) : null}
      {acting === 'revoke' ? (
        <ActionDialog
          title={t('admin.dialogs.revoke.title', { code })}
          subtitle={t('admin.ijazahs.detail.subtitle', { subject, riwaya: ijazah.riwaya })}
          icon="ban"
          tone="danger"
          effects={[
            t('admin.dialogs.revoke.effects.kept'),
            t('admin.dialogs.revoke.effects.hidden'),
            t('admin.dialogs.revoke.effects.noBar'),
          ]}
          reason={{
            label: t('admin.dialogs.revoke.reasonLabel'),
            hint: t('admin.dialogs.revoke.reasonHint'),
            placeholder: t('admin.dialogs.revoke.reasonPlaceholder'),
          }}
          confirm={t('admin.dialogs.revoke.confirm')}
          run={(reason, key) => actions.revoke(ijazah.ijazahId, reason, key)}
          failureOf={ijazahFailure}
          onClose={close}
        />
      ) : null}
    </>
  );
}

/** The rendered PDF one page at a time, over its signed link. */
function IjazahPdf({ url, name }: { readonly url: string; readonly name: string }) {
  const t = useT();
  const pdf = usePdf(url);
  if (pdf.failed) {
    return (
      <Banner icon={{ name: 'alert-circle' }} tone="danger">
        {t('admin.dialogs.documentViewer.loadError')}
      </Banner>
    );
  }
  if (pdf.file === undefined) return <Skeleton shape="block" />;
  return <DocumentPages file={pdf.file} name={name} inline />;
}
