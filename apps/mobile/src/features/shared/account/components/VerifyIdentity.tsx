// T074 (FR-166, FR-VERIFY-10): the `verify-identity` route, outside the role groups, for either role
// under an identity request (`account.identityVerification.*`). The reason the administrator gave,
// the document's type switched in place, its one PDF uploaded as it is picked (the uploads route,
// `kind: identity`), and «إرسال للمراجعة» attaching it to the open request. Once a document is
// attached the screen says it waits for review, with nothing to send again; another request
// (`documents.requestAnother`) opens the form again. The board draws a student: the warning that
// no package can be booked meanwhile is a student's, so a teacher's screen goes without it.
//
// T115 (b): a banner says how the latest closed request ended, and when, in the account's zone: the
// document accepted, or turned away with the reason of the request that replaced it; since an
// accepted request only made the home card vanish and a refused one only reopened the form.
import type { IdentityDocumentType, IdentityVerificationOutcome } from '@ijazah/contracts';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  ActionBar,
  Banner,
  Button,
  Card,
  Field,
  NavHeader,
  Segmented,
  Skeleton,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { useFormatters } from '../../../../lib/formatters';
import { PdfField, type UploadedPdf } from '../../documents';
import { StackScreen } from '../../screen';
import { NotLoaded } from '../../states';
import { useIdentityActions, useIdentityRequest } from '../identity';

const UPLOAD = {
  national_id: {
    label: 'account.verifyIdentity.upload.nationalId',
    hint: 'account.verifyIdentity.upload.nationalIdHint',
  },
  passport: {
    label: 'account.verifyIdentity.upload.passport',
    hint: 'account.verifyIdentity.upload.passportHint',
  },
} as const;

/**
 * How the latest closed request ended, dated in the account's zone (T115). A replacement's reason
 * is said once: `withReason` is false while the «سبب الطلب» card shows it on the same screen.
 */
function OutcomeBanner({
  outcome,
  zone,
  withReason,
}: {
  readonly outcome: IdentityVerificationOutcome;
  readonly zone: string;
  readonly withReason: boolean;
}) {
  const t = useT();
  const format = useFormatters();
  const date = format.date(outcome.resolvedAt, zone);
  if (outcome.status === 'satisfied') {
    return (
      <Banner icon={{ name: 'circle-check' }} tone="success">
        {t('account.verifyIdentity.outcome.satisfied', { date })}
      </Banner>
    );
  }
  return (
    <Banner icon={{ name: 'circle-x' }} tone="danger">
      <View style={{ gap: tokens.space['1'] }}>
        <Text variant="caption" weight="bold">
          {t('account.verifyIdentity.outcome.replaced', { date })}
        </Text>
        {!withReason || outcome.reason === undefined ? null : (
          <Text variant="caption">{outcome.reason}</Text>
        )}
      </View>
    </Banner>
  );
}

export function VerifyIdentity() {
  const t = useT();
  const me = useMe();
  const request = useIdentityRequest();
  const actions = useIdentityActions();
  const [type, setType] = useState<IdentityDocumentType>('national_id');
  const [document, setDocument] = useState<UploadedPdf | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const answer = request.data;
  const asking = answer?.open === true && answer.submittedAt === undefined;
  const zone = me.data?.timezone;
  // The form draws the open request's reason in its own card.
  const reasonCard = asking && answer.reason !== undefined;
  const outcome =
    answer?.lastOutcome === undefined || zone === undefined ? null : (
      <OutcomeBanner outcome={answer.lastOutcome} zone={zone} withReason={!reasonCard} />
    );

  async function send(): Promise<void> {
    if (document === undefined) return;
    setSending(true);
    setFailed(false);
    try {
      await actions.submit(type, document.documentId);
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <StackScreen
      header={
        <NavHeader
          title={t('account.verifyIdentity.title')}
          back={{
            kind: 'back',
            // With nothing behind it (opened from a notification), `/` is no route of its own, so
            // the guard lands the session where it belongs (lib/session.ts `allows`).
            onPress: () => (router.canGoBack() ? router.back() : router.replace('/')),
          }}
        />
      }
      footer={
        asking ? (
          <ActionBar>
            <Button
              label={t('account.verifyIdentity.submit')}
              layout="block"
              loading={sending}
              disabled={document === undefined || sending}
              onPress={() => void send()}
            />
          </ActionBar>
        ) : undefined
      }
    >
      {answer === undefined ? (
        <NotLoaded
          failed={request.isError}
          onRetry={() => void request.refetch()}
          loading={<Skeleton shape="block" />}
        />
      ) : !answer.open ? (
        <>
          {outcome}
          <Text tone="muted">{t('account.verifyIdentity.none')}</Text>
        </>
      ) : answer.submittedAt !== undefined ? (
        <>
          {outcome}
          <Card variant="hero">
            <Text variant="title-2">{t('account.verifyIdentity.submitted.title')}</Text>
            <Text tone="muted">{t('account.verifyIdentity.submitted.text')}</Text>
          </Card>
        </>
      ) : (
        <View style={{ gap: tokens.space['4'] }}>
          {outcome}
          {me.data?.role === 'student' ? (
            <Banner icon={{ name: 'triangle-alert' }} tone="warning">
              <View style={{ gap: tokens.space['1'] }}>
                <Text variant="caption" weight="bold">
                  {t('account.verifyIdentity.banner.strong')}
                </Text>
                <Text variant="caption">{t('account.verifyIdentity.banner.text')}</Text>
              </View>
            </Banner>
          ) : null}
          <Text>{t('account.verifyIdentity.intro')}</Text>
          {!reasonCard ? null : (
            <Card>
              <Text variant="headline">{t('account.verifyIdentity.reasonTitle')}</Text>
              <Text>{answer.reason}</Text>
            </Card>
          )}
          <Field label={t('account.verifyIdentity.docType')}>
            <Segmented
              accessibilityLabel={t('account.verifyIdentity.docType')}
              options={[
                { value: 'national_id', label: t('account.verifyIdentity.docTypes.nationalId') },
                { value: 'passport', label: t('account.verifyIdentity.docTypes.passport') },
              ]}
              value={type}
              onChange={(value) => {
                setType(value === 'passport' ? 'passport' : 'national_id');
                setDocument(undefined);
              }}
            />
          </Field>
          <PdfField
            kind="identity"
            file={document}
            label={t(UPLOAD[type].label)}
            hint={t(UPLOAD[type].hint)}
            onChange={setDocument}
          />
          <Text variant="caption" tone="muted">
            {t('account.verifyIdentity.tip')}
          </Text>
          {failed ? (
            <Banner icon={{ name: 'alert-circle' }} tone="danger">
              {t('common.state.actionError')}
            </Banner>
          ) : null}
        </View>
      )}
    </StackScreen>
  );
}
