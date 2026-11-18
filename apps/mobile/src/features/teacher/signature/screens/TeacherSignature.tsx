// 005:T019 (FR-601, FR-IJAZAH-12; contracts/app-surface.md, `teacher.signature.get` and
// `POST /uploads/signature`): the teacher's signature image, at `(teacher)/account/signature`, opened
// from the account tab and from a request refused for want of one. The current signature is drawn by
// the signed link `teacher.signature.get` answers, or the empty pad while none is held; «رفع التوقيع»
// or «استبدال الصورة» opens the system picker for one JPEG or PNG (`pickPhoto`, expo-document-picker;
// `SignaturePad` stays an interface, the note under T019), uploaded at once and read again. The
// server decides the type by content and the size by its limit: a refused image (VALIDATION_FAILED)
// is said in its own words, any other failure as the generic one.
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, View } from 'react-native';

import {
  Banner,
  Button,
  Card,
  NavHeader,
  Section,
  Skeleton,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { errorCodeOf } from '../../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../../lib/error-message';
import { pickPhoto } from '../../../../lib/files';
import { StackScreen } from '../../../shared/screen';
import { NotLoaded, OfflineNotice } from '../../../shared/states';
import { useSignatureActions, useTeacherSignature } from '../api';

/** A refused upload in the screen's words: a refused image its own, every other T065's. */
function uploadFailure(error: unknown): ErrorMessage {
  if (errorCodeOf(error) === 'VALIDATION_FAILED') return { key: 'teacher.signature.refused' };
  return genericErrorKey(error, 'common.state.actionError');
}

export function TeacherSignature() {
  const t = useT();
  const signature = useTeacherSignature();
  const actions = useSignatureActions();
  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  const link = signature.data?.link ?? null;

  async function choose(): Promise<void> {
    const picked = await pickPhoto();
    if (picked === null) return;
    setFailure(null);
    setUploading(true);
    try {
      await actions.upload(picked);
    } catch (caught: unknown) {
      setFailure(uploadFailure(caught));
    } finally {
      setUploading(false);
    }
  }

  return (
    <StackScreen
      header={
        <NavHeader
          title={t('teacher.signature.title')}
          back={{ kind: 'back', onPress: () => router.back() }}
        />
      }
    >
      {signature.data === undefined ? (
        <NotLoaded
          failed={signature.isError}
          error={signature.error}
          onRetry={() => void signature.refetch()}
          loading={<Skeleton shape="block" />}
        />
      ) : (
        <>
          <OfflineNotice onRetry={() => void signature.refetch()} />
          <Text tone="muted">{t('teacher.signature.lede')}</Text>
          <Section title={t('teacher.signature.previewTitle')}>
            <Card>
              {link === null ? (
                <View
                  accessible
                  accessibilityLabel={t('teacher.signature.a11y.emptyPad')}
                  style={{ minHeight: tokens.size['upload-tile'], justifyContent: 'center' }}
                >
                  <Text tone="muted" align="center">
                    {t('teacher.signature.emptyPad')}
                  </Text>
                </View>
              ) : (
                <Image
                  accessible
                  accessibilityLabel={t('teacher.signature.a11y.preview')}
                  source={{ uri: link }}
                  resizeMode="contain"
                  style={{ width: '100%', height: tokens.size['upload-tile'] }}
                />
              )}
            </Card>
            <Text variant="caption" tone="muted">
              {t('teacher.signature.hint')}
            </Text>
          </Section>
          {failure === null ? null : (
            <Banner icon={{ name: 'alert-circle' }} tone="danger">
              {t(failure.key, failure.values)}
            </Banner>
          )}
          <Button
            label={t(link === null ? 'teacher.signature.upload' : 'teacher.signature.replaceImage')}
            layout="block"
            variant={link === null ? 'primary' : 'secondary'}
            loading={uploading}
            disabled={uploading}
            onPress={() => void choose()}
          />
          <Section title={t('teacher.signature.whereTitle')}>
            <Text>{t('teacher.signature.whereText')}</Text>
          </Section>
        </>
      )}
    </StackScreen>
  );
}
