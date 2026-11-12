// T070 (FR-171, ADR 0019 D3): the second factor's setup on a first sign-in (`AdminMfaSetup`), in
// three steps on one page.
// 1. The QR of a fresh secret (`auth.mfa.setup.begin`), drawn here as SVG (qrcode.react, owner's
//    decision 2026-10-22) so the secret never leaves the page, with the key to type by hand. The
//    secret is begun once per showing: a second begin would replace it behind the QR (React's
//    strict mode runs an effect twice in development).
// 2. The first code (`auth.mfa.setup.confirm`), sent at its sixth digit.
// 3. The recovery codes the confirmation answers, shown this once, to copy or download as a text
//    file.
// The server marks the session verified at the confirmation; the tab lets it in only when the
// person says they saved the codes and presses «إتمام الإعداد والدخول» (a gate of the client's,
// owner's decision at B14's conflict check). A reload after the codes finds the session verified,
// which a waiting session's procedures refuse (`ADMIN_SIGN_IN_FAILED`): the person signs in again
// with the authenticator, and the codes are regenerated from their own account (B14d). An account
// another sign-in set up meanwhile (`FORBIDDEN` on `begin`) owes its code (B14a review, round 1).
// The email in the lede is read from the URI's label (admin-surface.md, `auth.mfa.setup.begin`).
import { QRCodeSVG } from 'qrcode.react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Banner, Button, Field, IconButton, Otp, Skeleton } from '../../design/components';
import { useT } from '../../i18n';
import { useAdmin } from '../../lib/admin-context';
import { errorCodeOf } from '../../lib/client';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';
import { RecoveryCodes } from './RecoveryCodes';
import { TOTP_PERIOD_SECONDS, useStartOver } from './start-over';

const CODE_LENGTH = 6;
/** The QR's side in CSS pixels, and its quiet zone in modules (ISO/IEC 18004 asks for four). */
const QR_SIZE = 160;
const QR_QUIET_ZONE = 4;

interface Begun {
  readonly uri: string;
  readonly key: string;
  readonly email: string;
}

export function AdminMfaSetup() {
  const t = useT();
  const { client, sessions } = useAdmin();
  const startOver = useStartOver();
  const keyLabel = useId();
  const [begun, setBegun] = useState<Begun | { readonly failed: ErrorMessage } | null>(null);
  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  const [codes, setCodes] = useState<readonly string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const started = useRef(false);

  const begin = useCallback(async () => {
    setBegun(null);
    try {
      const { otpauthUri, manualKey } = await client.api.auth.mfa.setup.begin.mutate({
        sessionToken: sessions.read()?.token ?? '',
      });
      setBegun({ uri: otpauthUri, key: manualKey, email: emailOf(otpauthUri) });
    } catch (error) {
      if (startOver(error)) return;
      if (errorCodeOf(error) === 'FORBIDDEN') sessions.setStep('mfa');
      else setBegun({ failed: errorMessageKey(error, 'admin.mfaSetup.loadError') });
    }
  }, [client, sessions, startOver]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void begin();
  }, [begin]);

  async function confirm(typed: string): Promise<void> {
    setConfirming(true);
    setFailure(null);
    try {
      const { recoveryCodes } = await client.api.auth.mfa.setup.confirm.mutate({
        sessionToken: sessions.read()?.token ?? '',
        code: typed,
      });
      setCodes(recoveryCodes);
    } catch (error) {
      if (startOver(error)) return;
      setCode('');
      setFailure(
        errorCodeOf(error) === 'CODE_INVALID'
          ? { key: 'admin.mfa.codeInvalid' }
          : errorMessageKey(error, 'admin.mfa.failed'),
      );
    } finally {
      setConfirming(false);
    }
  }

  function enter(typed: string): void {
    setCode(typed);
    if (typed.length === CODE_LENGTH && !confirming && codes === null) void confirm(typed);
  }

  const failed = begun !== null && 'failed' in begun ? begun.failed : null;
  const ready = begun !== null && 'uri' in begun ? begun : null;

  return (
    <>
      <div className="page-intro">
        <h1 className="page-intro__title">{t('admin.mfaSetup.title')}</h1>
        {ready === null ? null : (
          <p className="page-intro__lede">{t('admin.mfaSetup.lede', { email: ready.email })}</p>
        )}
      </div>
      {failed !== null ? (
        <div className="stack gap-4">
          <Banner icon={{ name: 'alert-circle' }} tone="danger">
            {t(failed.key, failed.values)}
          </Banner>
          <div className="row">
            <Button
              label={t('admin.common.action.retry')}
              variant="secondary"
              onPress={() => void begin()}
            />
          </div>
        </div>
      ) : ready === null ? (
        <Skeleton shape="block" />
      ) : (
        <ol className="grid-3 gap-5">
          <li className="card card--hero gap-4">
            <StepTitle number={1} title={t('admin.mfaSetup.step1.title')} />
            <p className="text-callout tone-muted">{t('admin.mfaSetup.step1.text')}</p>
            <div className="doc-viewer" role="img" aria-label={t('admin.mfaSetup.step1.a11y.qr')}>
              <QRCodeSVG value={ready.uri} size={QR_SIZE} marginSize={QR_QUIET_ZONE} aria-hidden />
              <span className="text-caption">{t('admin.mfaSetup.step1.qrCaption')}</span>
            </div>
            <div className="field">
              <span className="field__label" id={keyLabel}>
                {t('admin.mfaSetup.step1.manualKey')}
              </span>
              <div className="file" aria-labelledby={keyLabel}>
                <span className="grow text-latin text-medium ltr">{ready.key}</span>
                <IconButton
                  icon={{ name: 'copy' }}
                  variant="muted"
                  accessibilityLabel={t('admin.mfaSetup.step1.a11y.copyKey')}
                  onPress={() => copy(ready.key)}
                />
              </div>
            </div>
          </li>

          <li className="card card--hero gap-4">
            <StepTitle number={2} title={t('admin.mfaSetup.step2.title')} />
            <p className="text-callout tone-muted">
              {t('admin.mfaSetup.step2.text', { seconds: TOTP_PERIOD_SECONDS })}
            </p>
            <Field label={t('admin.mfaSetup.step2.codeLabel')}>
              <Otp value={code} onChange={enter} error={failure?.key === 'admin.mfa.codeInvalid'} />
            </Field>
            {codes !== null ? (
              <Banner icon={{ name: 'circle-check' }} tone="success">
                {t('admin.mfaSetup.step2.verified')}
              </Banner>
            ) : failure === null ? null : (
              <Banner icon={{ name: 'alert-circle' }} tone="danger">
                {t(failure.key, failure.values)}
              </Banner>
            )}
          </li>

          <li className="card card--hero gap-4">
            <StepTitle number={3} title={t('admin.mfaSetup.step3.title')} />
            <p className="text-callout tone-muted">{t('admin.mfaSetup.step3.text')}</p>
            {codes === null ? null : (
              <RecoveryCodes codes={codes} saved={saved} onSaved={setSaved} />
            )}
          </li>
        </ol>
      )}
      <div className="row gap-3">
        <Button
          label={t('admin.mfaSetup.finish')}
          size="md"
          disabled={codes === null || !saved}
          onPress={() => sessions.setStep('verified')}
        />
        <Button
          label={t('admin.mfaSetup.backToSignIn')}
          variant="ghost"
          size="md"
          onPress={() => sessions.clear()}
        />
        <p className="text-caption tone-muted">{t('admin.mfaSetup.footer')}</p>
      </div>
    </>
  );
}

function StepTitle({ number, title }: { readonly number: number; readonly title: string }) {
  return (
    <div className="row gap-3">
      <span className="icon-tile icon-tile--sm icon-tile--round icon-tile--primary">{number}</span>
      <h2 className="section__title">{title}</h2>
    </div>
  );
}

/** The administrator's email, from the URI's label `Ijazah:<email>` (admin-surface.md). */
export function emailOf(otpauthUri: string): string {
  try {
    const label = decodeURIComponent(new URL(otpauthUri).pathname.replace(/^\//, ''));
    const colon = label.indexOf(':');
    return colon === -1 ? label : label.slice(colon + 1);
  } catch {
    return '';
  }
}

function copy(text: string): void {
  void navigator.clipboard.writeText(text).catch(() => undefined);
}
