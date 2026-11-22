// T049 (FR-475, FR-SESS-13; T040's `disputes.chat`; the note under T049, Q2): the enrollment's chat
// on the dispute's page, drawn only while `disputes.get` answers `chatAvailable`. No page of its
// own and no reason for viewing: `disputes.chat` takes none, and each page read is audited
// `chat.read` on the server. The messages newest first as the server answers them, each with its
// sender's role, a document by its name (no link: the panel has no procedure for one), a purged
// message said as such; older pages on the administrator's press. A refusal (`CONFLICT` `not_open`,
// `NOT_FOUND`) is said in plain words; any other failure, the read's generic words.
//
// 005:T034 (R1a; SRS FR-SESS-13 as amended, DEC-100; the note under T034): the view is
// `ChatLogSection`, which takes the chat's query, its banner and its refusals' words as props, so a
// report's panel draws the same read-only chat (`reports.chat`); `DisputeChatSection` passes the
// dispute's (`useDisputeChat`, `admin.chatLog.banner`, `chatFailure`), as before.
import type { DisputesChatOutput } from '@ijazah/contracts/admin';

import { Banner, Button, Skeleton } from '../../design/components';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { UserText } from '../../i18n/UserText';
import type { ErrorMessage } from '../../lib/error-message';
import { dayMonth, timeOfDay } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { chatFailure } from './failures';
import { ROLE } from './labels';
import { useDisputeChat } from './queries';

/** What the view reads of a chat's paged query (TanStack Query's infinite query). */
export interface ChatPagesQuery {
  readonly data: { readonly pages: readonly DisputesChatOutput[] } | undefined;
  readonly error: unknown;
  readonly isError: boolean;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  fetchNextPage(): Promise<unknown>;
}

export function DisputeChatSection({ disputeId }: { readonly disputeId: string }) {
  return (
    <ChatLogSection
      chat={useDisputeChat(disputeId)}
      banner="admin.chatLog.banner"
      failureOf={chatFailure}
    />
  );
}

export function ChatLogSection({
  chat,
  banner,
  failureOf,
}: {
  readonly chat: ChatPagesQuery;
  /** Why the chat is shown here, and that opening it is audited. */
  readonly banner: MessageKey;
  /** The read's refusals in the words of the matter that opens it. */
  readonly failureOf: (error: unknown) => ErrorMessage;
}) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const chatFailed = failureOf(chat.error);
  const messages = chat.data?.pages.flatMap((page) => page.messages) ?? [];
  return (
    <section className="section" aria-label={t('admin.chatLog.a11y.messages')}>
      <h2 className="group-label">{t('admin.disputes.detail.chatTitle')}</h2>
      <p className="text-caption tone-muted">{t(banner)}</p>
      {chat.data !== undefined ? (
        messages.length === 0 ? (
          <p className="text-callout">{t('admin.chatLog.empty.title')}</p>
        ) : (
          <ul className="stack gap-4">
            {messages.map((message) => (
              <li key={message.messageId} className="stack gap-half">
                <span className="text-caption tone-muted">
                  {t('admin.disputes.chat.meta', {
                    sender: t(ROLE[message.senderRole]),
                    date: dayMonth(message.sentAt, locale, zone),
                    time: timeOfDay(message.sentAt, locale, zone),
                  })}
                </span>
                {message.purged ? (
                  <span className="text-callout tone-muted">{t('admin.disputes.chat.purged')}</span>
                ) : (
                  <>
                    {message.body === undefined ? null : (
                      <span className="text-callout">
                        <UserText>{message.body}</UserText>
                      </span>
                    )}
                    {message.attachment === undefined ? null : (
                      <span className="text-callout">
                        {t('admin.disputes.chat.attachment', {
                          name: message.attachment.filename,
                        })}
                      </span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )
      ) : chat.isError ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(chatFailed.key, chatFailed.values)}
        </Banner>
      ) : (
        <Skeleton shape="block" />
      )}
      {chat.hasNextPage ? (
        <span className="self-start">
          <Button
            label={t('admin.disputes.chat.more')}
            variant="secondary"
            loading={chat.isFetchingNextPage}
            onPress={() => void chat.fetchNextPage()}
          />
        </span>
      ) : null}
    </section>
  );
}
