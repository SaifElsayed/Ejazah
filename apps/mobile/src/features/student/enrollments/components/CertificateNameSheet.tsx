// T020 of specs/005-certification (FR-602; ADR 0019 D1): the student's name as the ijazah prints it,
// entered once. The field, the name shown as it will print beneath it, and the reminder that it is
// written once and changed only through support. Saved, the sheet closes and the enrollment, read
// again, shows the request pending; a refusal is said in place and the sheet stays.
import { useState } from 'react';
import { View } from 'react-native';

import { Banner, Button, Field, Input, Sheet, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import type { ErrorMessage } from '../../../../lib/error-message';
import { certificateNameRefusal, useSetCertificateName } from '../ijazah-request';

export function CertificateNameSheet({ onClose }: { readonly onClose: () => void }) {
  const t = useT();
  const names = useSetCertificateName();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  const shown = name.trim();

  async function save(): Promise<void> {
    setBusy(true);
    setFailure(null);
    try {
      if (await names.set(name)) onClose();
    } catch (caught: unknown) {
      setFailure(certificateNameRefusal(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={t('student.certificateName.title')}>
      <Field label={t('student.certificateName.fullName')} hint={t('student.certificateName.hint')}>
        <Input value={name} onChangeText={setName} disabled={busy} />
      </Field>
      {shown === '' ? null : (
        <View style={{ gap: tokens.space['1'] }}>
          <Text variant="callout" tone="muted">
            {t('student.certificateName.preview')}
          </Text>
          <Text variant="title-3">{shown}</Text>
        </View>
      )}
      {failure === null ? null : (
        <Banner icon={{ name: 'triangle-alert' }} tone="danger">
          {t(failure.key, failure.values)}
        </Banner>
      )}
      <Button
        label={t('student.certificateName.save')}
        layout="block"
        loading={busy}
        disabled={shown === ''}
        onPress={() => void save()}
      />
    </Sheet>
  );
}
