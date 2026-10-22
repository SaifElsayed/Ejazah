// T074 (FR-137, FR-166): the card a home shows while the account is under an identity request
// (`account.me`'s `verification_required`), opening `VerifyIdentity`. Nothing otherwise.
import { router } from 'expo-router';

import { Card, Text } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';

export function IdentityRequestCard() {
  const t = useT();
  const me = useMe();
  if (me.data?.accountStatus !== 'verification_required') return null;
  return (
    <Card variant="warning" onPress={() => router.push('/verify-identity')}>
      <Text variant="headline">{t('account.verifyIdentity.card.title')}</Text>
      <Text variant="caption" tone="muted">
        {t('account.verifyIdentity.card.text')}
      </Text>
    </Card>
  );
}
