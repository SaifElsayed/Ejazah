// T045 of specs/004-sessions (FR-427, FR-488 to FR-492; contracts/app-surface.md, `chat` and `live`;
// research R-324): the chat both roles open, in both languages. Its pages, newest first, the older
// ones on the person's ask; a text sent (`chat.send`, a fresh key per send, the same key on its
// retry); a PDF or a text document attached (`POST /uploads/chat`, the server deciding its type by
// content); a document opened through its signed link; read-only once the enrollment has ended
// (FR-488). `CHAT_CLOSED`, `ATTACHMENT_REFUSED` and `RATE_LIMITED` in plain words, every other
// failure the generic words (`genericErrorKey`); a failed send keeps its text and offers no
// «لم تُرسل» retry. A purged message keeps its side and its time, never its body (FR-492). Each
// `chat` event of the live channel is merged into the open chat's first page by `messageId`, a
// message already there not added twice, one out of order placed by its time; a (re)start of the
// channel reads the first page again, and a signal of the enrollment does not.
import type { ChatListOutput, ChatMessage, EnrollmentStatus } from '@ijazah/contracts';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';

import { renderIn, styleOf } from '../../../design/primitives/__tests__/harness';
import { type Locale, type MessageKey, type MessageValues, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { formatDate, formatTime } from '../../../lib/formatters';
import { handChatEvent, Rereads } from '../../../lib/live-channel';
import { apiError, fakeApi, type Procedure } from '../__tests__/api-double';
import { ChatScreen } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({ router: { back: () => mockBack() } }));

const mockOpenBrowser = jest.fn(async (_url: string) => ({ type: 'opened' }));
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: (url: string) => mockOpenBrowser(url),
}));

const mockPick = jest.fn<() => Promise<unknown>>();
jest.mock('./pick', () => ({ pickChatDocument: () => mockPick() }));

let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `chat-key-${String(++mockKey)}` }));

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const OTHER_ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e2';
const ZONE = 'Asia/Riyadh';
const TEACHER = 'الشيخ أحمد المصري';
const me = { userId: '0193a6f0-0000-7000-8000-000000000002', timezone: ZONE };

const id = (n: number) => `0193a6f0-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`;
const at = (hour: number) => `2026-11-12T${String(hour).padStart(2, '0')}:00:00.000Z`;

function message(n: number, of: Partial<ChatMessage> = {}): ChatMessage {
  return { messageId: id(n), mine: false, body: `رسالة ${n}`, sentAt: at(n), purged: false, ...of };
}

const page = (messages: ChatMessage[], nextCursor?: string): ChatListOutput =>
  nextCursor === undefined ? { messages } : { messages, nextCursor };

const localeOf = (direction: Direction): Locale => (direction === 'rtl' ? 'ar' : 'en');
const said = (direction: Direction, key: MessageKey, values?: MessageValues) =>
  translate(localeOf(direction), key, values);
const sentAtText = (direction: Direction, instant: string) =>
  said(direction, 'common.time.dateTime', {
    date: formatDate(instant, ZONE, localeOf(direction)),
    time: formatTime(instant, ZONE, localeOf(direction)),
  });

/** The chat's procedures, added beside the double's (T037, T038). */
function chatProcedures() {
  const chat = {
    list: { query: jest.fn(async () => page([])) as Procedure },
    send: { mutate: jest.fn(async () => undefined) as Procedure },
    attachmentLink: { query: jest.fn(async () => undefined) as Procedure },
  };
  const uploadChatDocument = jest.fn(
    async (_enrollmentId: string, _filename: string, _file: { uri: string; mimeType: string }) =>
      ({
        messageId: id(50),
        attachment: { filename: 'x', mime: 'text/plain' },
        sentAt: at(20),
      }) as unknown,
  );
  Object.assign(mockApi.api, { chat });
  Object.assign(mockApi.value.client, { uploadChatDocument });
  return { ...chat, uploadChatDocument };
}

let chat = chatProcedures();
let queries: QueryClient;

beforeEach(() => {
  mockApi = fakeApi();
  chat = chatProcedures();
  mockBack.mockReset();
  mockOpenBrowser.mockClear();
  mockPick.mockReset();
  mockKey = 0;
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});

function ui(status: EnrollmentStatus = 'confirmed', enrollmentId = ENROLLMENT_ID) {
  return (
    <QueryClientProvider client={queries}>
      <ChatScreen
        enrollmentId={enrollmentId}
        counterpart={TEACHER}
        status={status}
        failed={false}
        error={undefined}
        onRetry={() => undefined}
      />
    </QueryClientProvider>
  );
}

/** Runs `check` on a fresh render in each language, the cache and the mocks fresh each time. */
async function inEach(
  check: (direction: Direction) => Promise<void>,
  arrange: () => void = () => undefined,
) {
  for (const direction of ['rtl', 'ltr'] as const) {
    mockApi = fakeApi();
    chat = chatProcedures();
    mockKey = 0;
    mockPick.mockReset();
    mockOpenBrowser.mockClear();
    queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queries.setQueryData(ME_QUERY_KEY, me);
    arrange();
    await check(direction);
    await cleanup();
    queries.clear();
  }
}

/** The side a message is drawn on: the bubble's alignment along the reading direction. */
function sideOf(node: TestInstance): 'mine' | 'theirs' {
  let current: TestInstance | null = node;
  while (current !== null) {
    const align = styleOf(current)['alignSelf'];
    if (align === 'flex-end') return 'mine';
    if (align === 'flex-start') return 'theirs';
    current = current.parent;
  }
  throw new Error('no bubble around the message');
}

const bodies = () => screen.queryAllByText(/^رسالة \d+$/).map((node) => node.props.children);

describe('the chat’s pages (T045, FR-491)', () => {
  it('draws the first page, each message on its side with its time in the viewer’s zone', async () => {
    await inEach(
      async (direction) => {
        await renderIn(direction, ui());
        const theirs = await screen.findByText('رسالة 11');
        expect(sideOf(theirs)).toBe('theirs');
        expect(sideOf(screen.getByText('رسالة 12'))).toBe('mine');
        expect(screen.getByText(sentAtText(direction, at(11)))).toBeTruthy();
        expect(screen.getByText(said(direction, 'chat.thread.title'))).toBeTruthy();
        expect(screen.getByText(TEACHER)).toBeTruthy();
        expect(chat.list.query.mock.calls).toEqual([[{ enrollmentId: ENROLLMENT_ID }]]);
        expect(screen.queryByText(said(direction, 'chat.thread.older'))).toBeNull();
      },
      () => chat.list.query.mockResolvedValue(page([message(12, { mine: true }), message(11)])),
    );
  });

  it('reads the older pages on the person’s ask, by the cursor the last page answered', async () => {
    await inEach(
      async (direction) => {
        await renderIn(direction, ui());
        await screen.findByText('رسالة 12');
        expect(chat.list.query).toHaveBeenCalledTimes(1);
        await fireEvent.press(screen.getByText(said(direction, 'chat.thread.older')));
        expect(await screen.findByText('رسالة 10')).toBeTruthy();
        expect(chat.list.query.mock.calls[1]).toEqual([
          { enrollmentId: ENROLLMENT_ID, cursor: id(11) },
        ]);
        await fireEvent.press(screen.getByText(said(direction, 'chat.thread.older')));
        expect(await screen.findByText('رسالة 9')).toBeTruthy();
        expect(chat.list.query.mock.calls[2]).toEqual([
          { enrollmentId: ENROLLMENT_ID, cursor: id(10) },
        ]);
        expect(bodies()).toEqual(['رسالة 12', 'رسالة 11', 'رسالة 10', 'رسالة 9']);
        expect(screen.queryByText(said(direction, 'chat.thread.older'))).toBeNull();
      },
      () =>
        chat.list.query
          .mockResolvedValueOnce(page([message(12), message(11)], id(11)))
          .mockResolvedValueOnce(page([message(10)], id(10)))
          .mockResolvedValueOnce(page([message(9)])),
    );
  });

  it('says a failed read in plain words, RATE_LIMITED as «طلبات كثيرة…», and reads again on retry', async () => {
    await inEach(
      async (direction) => {
        await renderIn(direction, ui());
        expect(
          await screen.findByText(said(direction, 'common.state.rateLimitedIn', { count: 2 })),
        ).toBeTruthy();
        await fireEvent.press(screen.getByText(said(direction, 'common.action.retry')));
        expect(await screen.findByText('رسالة 11')).toBeTruthy();
      },
      () =>
        chat.list.query
          .mockRejectedValueOnce(
            apiError('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '90' }]),
          )
          .mockResolvedValue(page([message(11)])),
    );
  });

  it('says an empty chat has no messages yet, and whom to write to while it is open', async () => {
    await inEach(async (direction) => {
      await renderIn(direction, ui());
      expect(await screen.findByText(said(direction, 'chat.empty.title'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'chat.empty.text', { name: TEACHER }))).toBeTruthy();
    });
  });

  it('draws a purged message on its side with its time, and never a body or a document', async () => {
    await inEach(
      async (direction) => {
        await renderIn(direction, ui());
        const purged = await screen.findByText(said(direction, 'chat.thread.purged'));
        expect(sideOf(purged)).toBe('mine');
        expect(screen.getByText(sentAtText(direction, at(11)))).toBeTruthy();
        expect(bodies()).toEqual([]);
        expect(screen.queryByLabelText(said(direction, 'chat.thread.openFile'))).toBeNull();
      },
      () =>
        chat.list.query.mockResolvedValue(
          page([{ messageId: id(11), mine: true, sentAt: at(11), purged: true }]),
        ),
    );
  });
});

describe('a text sent (T045, FR-488, FR-491)', () => {
  const field = (direction: Direction) => screen.getByLabelText(said(direction, 'chat.message'));
  const send = (direction: Direction) =>
    fireEvent.press(screen.getByText(said(direction, 'common.action.send')));

  it('sends the text with a fresh key, empties the field and draws the message once', async () => {
    await inEach(
      async (direction) => {
        await renderIn(direction, ui());
        await screen.findByText('رسالة 11');
        await fireEvent.changeText(field(direction), '  السلام عليكم  ');
        await send(direction);
        expect(await screen.findByText('السلام عليكم')).toBeTruthy();
        expect(chat.send.mutate.mock.calls).toEqual([
          [{ enrollmentId: ENROLLMENT_ID, body: 'السلام عليكم', idempotencyKey: 'chat-key-1' }],
        ]);
        expect(field(direction).props.value).toBe('');
        expect(sideOf(screen.getByText('السلام عليكم'))).toBe('mine');
        // The sender's own copy of the live event changes nothing.
        await act(async () => {
          handChatEvent({
            type: 'chat',
            enrollmentId: ENROLLMENT_ID,
            message: {
              messageId: id(20),
              mine: true,
              body: 'السلام عليكم',
              sentAt: at(20),
              purged: false,
            },
          });
        });
        await fireEvent.changeText(field(direction), 'وعليكم السلام');
        await send(direction);
        // Drawn once the next message is: the copy had its chance to be drawn before it.
        expect(await screen.findByText('وعليكم السلام')).toBeTruthy();
        expect(screen.getAllByText('السلام عليكم')).toHaveLength(1);
        expect(chat.send.mutate.mock.calls[1]?.[0]).toMatchObject({ idempotencyKey: 'chat-key-2' });
      },
      () => {
        chat.list.query.mockResolvedValue(page([message(11)]));
        chat.send.mutate
          .mockResolvedValueOnce({
            messageId: id(20),
            mine: true,
            body: 'السلام عليكم',
            sentAt: at(20),
            purged: false,
          })
          .mockResolvedValueOnce({
            messageId: id(21),
            mine: true,
            body: 'وعليكم السلام',
            sentAt: at(21),
            purged: false,
          });
      },
    );
  });

  it('keeps the text after a failure, says it, and sends it again on the same key; a changed text takes a new one', async () => {
    await inEach(
      async (direction) => {
        await renderIn(direction, ui());
        await screen.findByText('رسالة 11');
        await fireEvent.changeText(field(direction), 'متى الجلسة القادمة؟');
        await send(direction);
        expect(await screen.findByText(said(direction, 'common.state.actionError'))).toBeTruthy();
        expect(field(direction).props.value).toBe('متى الجلسة القادمة؟');
        expect(screen.queryByText(said(direction, 'chat.notSent'))).toBeNull();
        await send(direction);
        expect(
          await screen.findByText(said(direction, 'common.state.rateLimitedIn', { count: 1 })),
        ).toBeTruthy();
        await fireEvent.changeText(field(direction), 'متى الجلسة القادمة يا شيخ؟');
        await send(direction);
        await waitFor(() => expect(chat.send.mutate).toHaveBeenCalledTimes(3));
        expect(
          chat.send.mutate.mock.calls.map(
            ([input]) => (input as { idempotencyKey: string }).idempotencyKey,
          ),
        ).toEqual(['chat-key-1', 'chat-key-1', 'chat-key-2']);
      },
      () => {
        chat.list.query.mockResolvedValue(page([message(11)]));
        chat.send.mutate
          .mockRejectedValueOnce(new TypeError('Network request failed'))
          .mockRejectedValueOnce(
            apiError('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '30' }]),
          )
          .mockReturnValueOnce(new Promise(() => undefined));
      },
    );
  });

  // RATE_LIMITED reads nothing again (PR #136, Saif r1's Minor 2): only CHAT_CLOSED closes the chat.
  it.each([
    ['CHAT_CLOSED', 'chat.thread.closed', 2],
    ['RATE_LIMITED', 'common.state.rateLimited', 1],
  ] as const)(
    'says %s in plain words; only CHAT_CLOSED reads the enrollment’s screens again',
    async (code, key, readsAfter) => {
      await inEach(
        async (direction) => {
          const enrollmentKey = ['student', 'enrollments', 'get', ENROLLMENT_ID];
          const reads = jest.fn(async () => 'read');
          const observer = new QueryObserver(queries, { queryKey: enrollmentKey, queryFn: reads });
          const stop = observer.subscribe(() => undefined);
          await renderIn(direction, ui());
          await screen.findByText('رسالة 11');
          await waitFor(() => expect(reads).toHaveBeenCalledTimes(1));
          await fireEvent.changeText(field(direction), 'هل نبدأ؟');
          await send(direction);
          expect(await screen.findByText(said(direction, key))).toBeTruthy();
          await act(async () => undefined);
          await waitFor(() => expect(reads).toHaveBeenCalledTimes(readsAfter));
          expect(field(direction).props.value).toBe('هل نبدأ؟');
          stop();
        },
        () => {
          chat.list.query.mockResolvedValue(page([message(11)]));
          chat.send.mutate.mockRejectedValue(apiError(code));
        },
      );
    },
  );
});

describe('a document attached and opened (T045, FR-489, FR-490)', () => {
  const attach = (direction: Direction) =>
    fireEvent.press(screen.getByLabelText(said(direction, 'chat.thread.attach')));

  it('sends the picked document under its name and draws it as the person’s message', async () => {
    await inEach(
      async (direction) => {
        await renderIn(direction, ui());
        await screen.findByText('رسالة 11');
        await attach(direction);
        expect(await screen.findByText('ملاحظات الحفظ.txt')).toBeTruthy();
        expect(chat.uploadChatDocument.mock.calls).toEqual([
          [
            ENROLLMENT_ID,
            'ملاحظات الحفظ.txt',
            { uri: 'file:///cache/notes.txt', name: 'ملاحظات الحفظ.txt', mimeType: 'text/plain' },
          ],
        ]);
        expect(screen.getByText(said(direction, 'chat.thread.textFile'))).toBeTruthy();
        expect(sideOf(screen.getByText('ملاحظات الحفظ.txt'))).toBe('mine');
      },
      () => {
        chat.list.query.mockResolvedValue(page([message(11)]));
        mockPick.mockResolvedValue({
          uri: 'file:///cache/notes.txt',
          name: 'ملاحظات الحفظ.txt',
          mimeType: 'text/plain',
        });
        chat.uploadChatDocument.mockResolvedValue({
          messageId: id(30),
          attachment: { filename: 'ملاحظات الحفظ.txt', mime: 'text/plain' },
          sentAt: at(22),
        });
      },
    );
  });

  it('sends nothing when the person closes the picker', async () => {
    await inEach(
      async (direction) => {
        await renderIn(direction, ui());
        await screen.findByText('رسالة 11');
        await attach(direction);
        await waitFor(() => expect(mockPick).toHaveBeenCalledTimes(1));
        expect(chat.uploadChatDocument).not.toHaveBeenCalled();
      },
      () => {
        chat.list.query.mockResolvedValue(page([message(11)]));
        mockPick.mockResolvedValue(null);
      },
    );
  });

  it.each([
    ['ATTACHMENT_REFUSED', apiError('ATTACHMENT_REFUSED'), 'chat.thread.refused'],
    ['CHAT_CLOSED', apiError('CHAT_CLOSED'), 'chat.thread.closed'],
    ['RATE_LIMITED', apiError('RATE_LIMITED'), 'common.state.rateLimited'],
    ['no answer', new TypeError('Network request failed'), 'common.state.actionError'],
  ] as const)('says a refused document (%s) in plain words', async (_name, error, key) => {
    await inEach(
      async (direction) => {
        await renderIn(direction, ui());
        await screen.findByText('رسالة 11');
        await attach(direction);
        expect(await screen.findByText(said(direction, key))).toBeTruthy();
      },
      () => {
        chat.list.query.mockResolvedValue(page([message(11)]));
        mockPick.mockResolvedValue({
          uri: 'file:///cache/scan.pdf',
          name: 'scan.pdf',
          mimeType: 'application/pdf',
        });
        chat.uploadChatDocument.mockRejectedValue(error);
      },
    );
  });

  it('opens a document through its signed link, and says a failure in plain words', async () => {
    await inEach(
      async (direction) => {
        await renderIn(direction, ui());
        expect(await screen.findByText('الإجازة.pdf')).toBeTruthy();
        expect(screen.getByText(said(direction, 'chat.pdf'))).toBeTruthy();
        await fireEvent.press(screen.getByLabelText(said(direction, 'chat.thread.openFile')));
        await waitFor(() =>
          expect(mockOpenBrowser).toHaveBeenCalledWith('https://files.ijazah.test/chat/1?s=1'),
        );
        expect(chat.attachmentLink.query.mock.calls).toEqual([[{ messageId: id(11) }]]);
        await fireEvent.press(screen.getByLabelText(said(direction, 'chat.thread.openFile')));
        expect(await screen.findByText(said(direction, 'common.state.actionError'))).toBeTruthy();
        expect(mockOpenBrowser).toHaveBeenCalledTimes(1);
      },
      () => {
        chat.list.query.mockResolvedValue(
          page([
            message(11, {
              body: undefined,
              attachment: { filename: 'الإجازة.pdf', mime: 'application/pdf' },
            }),
          ]),
        );
        chat.attachmentLink.query
          .mockResolvedValueOnce({
            url: 'https://files.ijazah.test/chat/1?s=1',
            expiresAt: at(23),
          })
          .mockRejectedValueOnce(apiError('NOT_FOUND'));
      },
    );
  });
});

describe('read-only once the enrollment has ended (FR-488)', () => {
  it.each(['completed', 'terminated_no_show', 'cancelled'] as const)(
    'draws the messages and no composer once %s, and says why',
    async (status) => {
      await inEach(
        async (direction) => {
          await renderIn(direction, ui(status));
          expect(await screen.findByText('رسالة 11')).toBeTruthy();
          expect(screen.getByText(said(direction, 'chat.thread.readOnly'))).toBeTruthy();
          expect(screen.queryByLabelText(said(direction, 'chat.message'))).toBeNull();
          expect(screen.queryByText(said(direction, 'common.action.send'))).toBeNull();
          expect(screen.queryByLabelText(said(direction, 'chat.thread.attach'))).toBeNull();
          expect(screen.queryByLabelText(said(direction, 'chat.thread.openFile'))).toBeTruthy();
        },
        () =>
          chat.list.query.mockResolvedValue(
            page([message(11, { attachment: { filename: 'notes.txt', mime: 'text/plain' } })]),
          ),
      );
    },
  );

  it('says an ended chat with no messages has none, and invites no message', async () => {
    await inEach(async (direction) => {
      await renderIn(direction, ui('completed'));
      expect(await screen.findByText(said(direction, 'chat.empty.title'))).toBeTruthy();
      expect(screen.queryByText(said(direction, 'chat.empty.text', { name: TEACHER }))).toBeNull();
    });
  });
});

describe('the live channel’s `chat` events (T045, FR-427)', () => {
  const event = (enrollmentId: string, merged: ChatMessage) =>
    act(async () => {
      handChatEvent({ type: 'chat', enrollmentId, message: merged });
    });

  it('merges an event into the first page once, a duplicate not added twice', async () => {
    await inEach(
      async (direction) => {
        await renderIn(direction, ui());
        await screen.findByText('رسالة 11');
        await event(ENROLLMENT_ID, message(13));
        await waitFor(() => expect(bodies()).toEqual(['رسالة 13', 'رسالة 11']));
        await event(ENROLLMENT_ID, message(13));
        // The next event is drawn once the duplicate has had its chance to be.
        await event(ENROLLMENT_ID, message(14));
        await waitFor(() => expect(bodies()).toContain('رسالة 14'));
        expect(bodies()).toEqual(['رسالة 14', 'رسالة 13', 'رسالة 11']);
        expect(chat.list.query).toHaveBeenCalledTimes(1);
      },
      () => chat.list.query.mockResolvedValue(page([message(11)])),
    );
  });

  it('places an event that arrives out of order by its time', async () => {
    await inEach(
      async (direction) => {
        await renderIn(direction, ui());
        await screen.findByText('رسالة 14');
        await event(ENROLLMENT_ID, message(12));
        await waitFor(() => expect(bodies()).toEqual(['رسالة 14', 'رسالة 12', 'رسالة 11']));
      },
      () => chat.list.query.mockResolvedValue(page([message(14), message(11)])),
    );
  });

  it('passes by an event of another enrollment’s chat', async () => {
    await inEach(
      async (direction) => {
        await renderIn(direction, ui());
        await screen.findByText('رسالة 11');
        await event(OTHER_ENROLLMENT_ID, message(13));
        await event(ENROLLMENT_ID, message(12));
        await waitFor(() => expect(bodies()).toContain('رسالة 12'));
        expect(bodies()).toEqual(['رسالة 12', 'رسالة 11']);
      },
      () => chat.list.query.mockResolvedValue(page([message(11)])),
    );
  });

  it('reads the first page again for an event that comes while the page is being read (PR #136, Saif r1)', async () => {
    await inEach(
      async (direction) => {
        await renderIn(direction, ui());
        await screen.findByText('رسالة 11');
        void queries.refetchQueries({ queryKey: ['chat', 'first'] });
        await waitFor(() => expect(chat.list.query).toHaveBeenCalledTimes(2));
        await event(ENROLLMENT_ID, message(13));
        await waitFor(() => expect(chat.list.query).toHaveBeenCalledTimes(3));
        expect(await screen.findByText('رسالة 13')).toBeTruthy();
      },
      () =>
        chat.list.query
          .mockResolvedValueOnce(page([message(11)]))
          .mockReturnValueOnce(new Promise(() => undefined))
          .mockResolvedValue(page([message(13), message(11)])),
    );
  });

  it('reads the first page again on a (re)start of the channel, and not on a signal of the enrollment', async () => {
    await inEach(
      async (direction) => {
        await renderIn(direction, ui());
        await screen.findByText('رسالة 11');
        const rereads = new Rereads(queries);
        rereads.signal({ type: 'enrollment', enrollmentId: ENROLLMENT_ID });
        await act(async () => undefined);
        expect(chat.list.query).toHaveBeenCalledTimes(1);
        rereads.readOpenLiveScreens();
        expect(await screen.findByText('رسالة 12')).toBeTruthy();
        expect(chat.list.query).toHaveBeenCalledTimes(2);
        rereads.dispose();
      },
      () =>
        chat.list.query
          .mockResolvedValueOnce(page([message(11)]))
          .mockResolvedValue(page([message(12), message(11)])),
    );
  });
});
