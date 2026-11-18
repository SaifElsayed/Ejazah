// T045 of specs/004-sessions (FR-488 to FR-492; contracts/app-surface.md, `chat`): the chat as both
// roles see it (R-MOBILE-3); each role's screen reads its enrollment and hands in the counterparty's
// name and the status. The messages newest at the foot (an inverted list), each on its side, the
// person's own at the end, with its day and time in the viewer's zone; a document as its name and
// its type, opened through its signed link; a purged message as its side, its time and the words
// that it was deleted, never a body (FR-492); the older pages on the person's ask. While the
// enrollment is confirmed the composer: a text and a document (PDF or plain text). Once it has
// ended the words that the chat is read-only, and no composer (FR-488); the server refuses a send
// all the same (`CHAT_CLOSED`, R-MOBILE-13). What is shown and sent is the hooks' (`api.ts`);
// this file renders.
//
// 005:T021 (FR-611, FR-614): once the role's screen has read the counterparty, the header's
// «إبلاغ» opens the report and flag sheet on them, from this chat (its enrollment).
import type { ChatMessage, EnrollmentStatus } from '@ijazah/contracts';
import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { FlatList, KeyboardAvoidingView, View } from 'react-native';

import {
  Banner,
  Button,
  Card,
  EmptyState,
  FileRow,
  IconButton,
  Input,
  NavHeader,
  Spinner,
  Text,
} from '../../../../design/primitives';
import { useTheme } from '../../../../design/theme';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import type { ErrorMessage } from '../../../../lib/error-message';
import { useFormatters } from '../../../../lib/formatters';
import { ReportEntry, type ReportTarget } from '../../reports';
import { StackScreen } from '../../screen';
import { LoadError, NotLoaded } from '../../states';
import {
  type ChatPages,
  useChatAttach,
  useChatPages,
  useChatSend,
  useOpenAttachment,
} from '../api';
import { chatWritable } from '../messages';

export interface ChatScreenProps {
  readonly enrollmentId: string;
  /** The counterparty's name as the role's screen shows it; undefined until it is read. */
  readonly counterpart: string | undefined;
  /** The enrollment's status, which the role's screen reads; undefined until it is read. */
  readonly status: EnrollmentStatus | undefined;
  /** The enrollment's read failed, with its error. */
  readonly failed: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
  /** 005:T021: the counterparty to report from this chat; undefined until it is read. */
  readonly report?: ReportTarget | undefined;
}

export function ChatScreen({
  enrollmentId,
  counterpart,
  status,
  failed,
  error,
  onRetry,
  report,
}: ChatScreenProps) {
  const t = useT();
  const me = useMe();
  const zone = me.data?.timezone;
  const header = (
    <NavHeader
      title={t('chat.thread.title')}
      {...(counterpart === undefined ? {} : { subtitle: counterpart })}
      back={{ kind: 'back', onPress: () => router.back() }}
      {...(report === undefined ? {} : { trailing: <ReportEntry target={report} /> })}
    />
  );
  if (status === undefined || zone === undefined) {
    return (
      <StackScreen header={header}>
        <NotLoaded
          failed={failed || me.isError}
          error={error ?? me.error}
          onRetry={() => {
            onRetry();
            if (me.isError) void me.refetch();
          }}
        />
      </StackScreen>
    );
  }
  return (
    <ChatThread
      header={header}
      enrollmentId={enrollmentId}
      writable={chatWritable(status)}
      counterpart={counterpart ?? ''}
      zone={zone}
    />
  );
}

function ChatThread({
  header,
  enrollmentId,
  writable,
  counterpart,
  zone,
}: {
  readonly header: ReactNode;
  readonly enrollmentId: string;
  readonly writable: boolean;
  readonly counterpart: string;
  readonly zone: string;
}) {
  const t = useT();
  const { color } = useTheme();
  const pages = useChatPages(enrollmentId);
  const opener = useOpenAttachment();
  if (!pages.loaded) {
    return (
      <StackScreen header={header}>
        <NotLoaded failed={pages.failed} error={pages.error} onRetry={pages.retry} />
      </StackScreen>
    );
  }
  return (
    // T114's frame (features/shared/screen): padding on Android too, under edge-to-edge.
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: color.bg }}>
      {header}
      {pages.messages.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon={{ name: 'message-square' }}
            title={t('chat.empty.title')}
            {...(writable ? { text: t('chat.empty.text', { name: counterpart }) } : {})}
          />
        </View>
      ) : (
        <FlatList
          inverted
          data={pages.messages}
          keyExtractor={(shown) => shown.messageId}
          renderItem={({ item }) => (
            <Bubble
              message={item}
              zone={zone}
              onOpen={(messageId) => void opener.open(messageId)}
            />
          )}
          ListFooterComponent={<Older pages={pages} />}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            gap: tokens.space['3'],
            paddingHorizontal: tokens.layout.gutter,
            paddingVertical: tokens.space['4'],
          }}
        />
      )}
      <View
        style={{
          gap: tokens.space['2'],
          paddingHorizontal: tokens.layout.gutter,
          paddingVertical: tokens.space['3'],
        }}
      >
        <Failure error={opener.error} />
        {writable ? (
          <Composer enrollmentId={enrollmentId} />
        ) : (
          <Banner icon={{ name: 'lock' }} tone="neutral">
            {t('chat.thread.readOnly')}
          </Banner>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

/** At the head of the list: the older messages on the person's ask, or why they did not load. */
function Older({ pages }: { readonly pages: ChatPages }) {
  const t = useT();
  if (pages.olderError !== null)
    return <LoadError error={pages.olderError} onRetry={pages.loadOlder} />;
  if (!pages.hasOlder) return null;
  return (
    <Button
      label={t('chat.thread.older')}
      variant="ghost"
      size="md"
      loading={pages.loadingOlder}
      onPress={pages.loadOlder}
    />
  );
}

/** One message on its side: the person's own at the end, the counterparty's at the start. */
function Bubble({
  message,
  zone,
  onOpen,
}: {
  readonly message: ChatMessage;
  readonly zone: string;
  readonly onOpen: (messageId: string) => void;
}) {
  const t = useT();
  const format = useFormatters();
  const { attachment, body, purged } = message;
  return (
    <View
      style={{
        alignSelf: message.mine ? 'flex-end' : 'flex-start',
        maxWidth: tokens.size['bubble-max'],
        gap: tokens.space['1'],
      }}
    >
      <Card variant={message.mine ? 'selected' : 'surface'}>
        {purged ? (
          <Text variant="callout" tone="muted">
            {t('chat.thread.purged')}
          </Text>
        ) : null}
        {purged || body === undefined ? null : <Text>{body}</Text>}
        {purged || attachment === undefined ? null : (
          <FileRow
            name={attachment.filename}
            meta={attachment.mime === 'application/pdf' ? t('chat.pdf') : t('chat.thread.textFile')}
            action={{
              icon: { name: 'external-link' },
              accessibilityLabel: t('chat.thread.openFile'),
              onPress: () => onOpen(message.messageId),
            }}
          />
        )}
      </Card>
      <Text variant="caption" tone="muted" align={message.mine ? 'end' : 'start'}>
        {t('common.time.dateTime', {
          date: format.date(message.sentAt, zone),
          time: format.time(message.sentAt, zone),
        })}
      </Text>
    </View>
  );
}

/** A text and a document: the field keeps its text until it has gone. */
function Composer({ enrollmentId }: { readonly enrollmentId: string }) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const sender = useChatSend(enrollmentId);
  const attacher = useChatAttach(enrollmentId);
  const send = async () => {
    const sent = draft;
    if (await sender.send(sent)) setDraft((now) => (now === sent ? '' : now));
  };
  return (
    <View style={{ gap: tokens.space['2'] }}>
      <Failure error={sender.error} />
      <Failure error={attacher.error} />
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: tokens.space['2'] }}>
        {attacher.busy ? (
          <View style={{ minHeight: tokens.size['control-md'], justifyContent: 'center' }}>
            <Spinner size="sm" />
          </View>
        ) : (
          <IconButton
            icon={{ name: 'paperclip' }}
            variant="surface"
            accessibilityLabel={t('chat.thread.attach')}
            onPress={() => void attacher.attach()}
          />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Input
            value={draft}
            onChangeText={setDraft}
            placeholder={t('chat.placeholder')}
            accessibilityLabel={t('chat.message')}
            size="md"
            multiline
          />
        </View>
        <Button
          label={t('common.action.send')}
          size="md"
          loading={sender.busy}
          disabled={!sender.canSend(draft)}
          onPress={() => void send()}
        />
      </View>
    </View>
  );
}

/** The words of an action's last failure, or nothing. */
function Failure({ error }: { readonly error: ErrorMessage | null }) {
  const t = useT();
  if (error === null) return null;
  return (
    <Banner icon={{ name: 'alert-circle' }} tone="danger">
      {t(error.key, error.values)}
    </Banner>
  );
}
