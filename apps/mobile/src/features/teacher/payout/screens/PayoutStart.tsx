// T078 (FR-190, FR-194, FR-PAYG-13): «أين تصلك مدفوعاتك؟» (PayoutStart). The gateway's hosted
// recipient onboarding is Phase 2's, so on a development build the button registers the provisional
// details through `teacher.payout.register` (contracts/ports.md, quickstart §6) and on a release
// build it is not drawn. The key is one per visit of the screen: a retry after a lost answer is
// the same registration (FR-106). The external-link icon of the board is left out: nothing opens.
// Reached as the payout route's first state, or at `start` to replace or retry (`PayoutChange`).
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useState } from 'react';

import { ActionBar, Banner, Button, IconTile, PageIntro } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { StackScreen } from '../../../shared/screen';
import { usePayoutActions } from '../api';
import { PayoutHeader } from '../components/PayoutHeader';
import { PAYOUT_ROUTE } from '../navigation';
import { devRegistrationEnabled, PROVISIONAL_PAYOUT_DETAILS } from '../provisional';

export function PayoutStart({ afterRegister }: { readonly afterRegister?: () => void }) {
  const t = useT();
  const actions = usePayoutActions();
  const [idempotencyKey] = useState(() => Crypto.randomUUID());
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function register(): Promise<void> {
    setSending(true);
    setFailed(false);
    try {
      await actions.register(PROVISIONAL_PAYOUT_DETAILS, idempotencyKey);
      afterRegister?.();
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <StackScreen
      header={<PayoutHeader title={t('teacher.payout.start.title')} />}
      {...(devRegistrationEnabled()
        ? {
            footer: (
              <ActionBar>
                <Button
                  label={t('teacher.payout.start.continueToGateway')}
                  layout="block"
                  loading={sending}
                  disabled={sending}
                  onPress={() => void register()}
                />
              </ActionBar>
            ),
          }
        : {})}
    >
      <IconTile icon={{ name: 'landmark' }} size="lg" />
      <PageIntro title={t('teacher.payout.start.heading')} lede={t('teacher.payout.start.lede')} />
      {failed ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t('common.state.actionError')}
        </Banner>
      ) : null}
    </StackScreen>
  );
}

/** The `start` route: a replacement or a retry, back to the payout state once registered. */
export function PayoutChange() {
  return (
    <PayoutStart
      afterRegister={() => {
        if (router.canGoBack()) router.back();
        else router.replace(PAYOUT_ROUTE);
      }}
    />
  );
}
