// T038 of specs/004-sessions: `POST /uploads/chat`, the upload route's third use (FR-489, FR-490;
// R-SEC-3, R-SEC-4, R-SEC-5; research R-314; contracts/app-surface.md, "`chat`"; contracts/kernel.md,
// the row «`chat.send`, `POST /uploads/chat`»; the notes under T038).
//
// Behind the user bearer of an active account (a suspended or banned one `ACCOUNT_RESTRICTED`, as
// the participant kind refuses it), one file of the kind `chat`, its type decided by content through
// the kernel's guard (`upload_max_bytes`, `rate_limit_upload`; a PDF or UTF-8 text, never an image,
// an SVG included). Then, in this order:
//
//   1. the fields `enrollmentId` and `filename` validated against the contract, before any read;
//   2. the name refused when its extension is an image's (`refuseImageFilename`), after the content;
//   3. the enrollment and its two parties read with no lock (a stranger, a nonexistent enrollment
//      and the other gender `NOT_FOUND`; any status but `confirmed` `CHAT_CLOSED`), so a refused
//      upload stores nothing;
//   4. the file stored under a server-minted private key, `chat/<uuid>.pdf` or `.txt`, outside any
//      transaction, so no lock waits on the storage port;
//   5. in one transaction, the sender's `users` row then the enrollment locked and read again, the
//      same refusals, the message inserted with the key, the name and the type (the third
//      analysis, L-B);
//   6. a refusal or a failure after step 4 removes the stored file, so no key names a file nobody
//      owns (as the documents route does).
//
// The answer is the message, its attachment's name and type and its instant, never the key; the
// document is read through `chat.attachmentLink`'s signed link (R-SEC-3). Each `ATTACHMENT_REFUSED`
// writes one info line, `{ userId, enrollmentId, cause }` (the note under T038, §4), through the
// route's refusal hook: never the file's name or any of its content, and an enrollment id that is
// not one is left out rather than echoed.
//
// T066 of specs/004-sessions (FR-427; research R-324, items 4 to 6; the note under T066, Q3 (a)):
// inside step 5's transaction, one `chat` event for each of the enrollment's two parties as the
// locks read them, `mine` computed for each, added to the upload's own after-commit list
// (`AcceptedUpload.live`), which the route sends once this handler resolves and drops when it
// throws. No log line names the document (R-SEC-2).
import { randomUUID } from 'node:crypto';

import { chatUploadFields, type ChatUploadOutput, chatUploadOutput } from '@ijazah/contracts';
import { z } from 'zod';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import {
  AttachmentRefusedError,
  refuseImageFilename,
} from '../../platform/guards/upload.middleware.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import type { NodeHandler } from '../../platform/web/route.js';
import {
  type RefusedUpload,
  uploadRoute,
  type UploadRouteDependencies,
} from '../../surfaces/upload-route.js';
import type { ChatMessageRow } from './chat.repository.js';
import {
  type ChatEnrollments,
  type ChatStore,
  chatStore,
  createChatAccess,
  tellParties,
} from './chat.service.js';

/** Where the chat's documents are posted (contracts/app-surface.md, `POST /uploads/chat`). */
export const CHAT_UPLOAD_PATH = '/uploads/chat';

/** The two types a chat document may be, and its key's extension for each. */
const EXTENSION_OF = { 'application/pdf': 'pdf', 'text/plain': 'txt' } as const;
type ChatMime = keyof typeof EXTENSION_OF;

function isChatMime(type: string): type is ChatMime {
  return Object.hasOwn(EXTENSION_OF, type);
}

export interface ChatUploadDependencies extends UploadRouteDependencies {
  readonly storage: Pick<StoragePort, 'put' | 'remove'>;
  readonly transactions: Transactions;
  /** Booking's `EnrollmentSide`, bound by `main.ts` (R-301). */
  readonly enrollments: ChatEnrollments;
  readonly store?: Pick<ChatStore, 'partiesOf' | 'lockSender' | 'insertAttachment'>;
  /** The database's clock on the transaction (`clock_timestamp()`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
}

/** The validated fields; a refusal names the field and the issue, never the value. */
function fieldsOf(fields: ReadonlyMap<string, string>) {
  const parsed = chatUploadFields.safeParse({
    enrollmentId: fields.get('enrollmentId'),
    filename: fields.get('filename'),
  });
  if (parsed.success) return parsed.data;
  throw new DomainError('VALIDATION_FAILED', undefined, {
    details: parsed.error.issues.map(({ path, code }) => ({ path: String(path[0] ?? ''), code })),
  });
}

/** One line per refused document: the uploader, the enrollment when it is an id, and the cause. */
function logRefusal(error: unknown, { uploader, fields, log }: RefusedUpload): void {
  if (!(error instanceof AttachmentRefusedError)) return;
  const enrollmentId = z.uuid().safeParse(fields.get('enrollmentId'));
  log.info(
    {
      userId: uploader.userId,
      ...(enrollmentId.success ? { enrollmentId: enrollmentId.data } : {}),
      cause: error.refusal,
    },
    'A chat document was refused',
  );
}

export function createChatUploadRoute({
  storage,
  transactions,
  enrollments,
  store = chatStore,
  clock = clockTimestamp,
  ...dependencies
}: ChatUploadDependencies): NodeHandler {
  const { openParticipantOf, lockedParticipantOf } = createChatAccess({ enrollments, store });
  // The handler's refusal lines go to the route's logger: the request's is the hook's alone.
  const log: Logger = dependencies.log;

  return uploadRoute<'chat'>(dependencies, {
    kindOf: () => 'chat',
    refuses: ['suspended', 'banned'],
    refused: logRefusal,
    handle: async ({ uploader, type, bytes, fields, live }): Promise<ChatUploadOutput> => {
      const { enrollmentId, filename } = fieldsOf(fields);
      refuseImageFilename(filename);
      if (!isChatMime(type))
        throw new Error('chat: the chat kind admitted a type it does not take');
      const ids = { enrollmentId, userId: uploader.userId };
      await transactions.run((tx) => openParticipantOf(tx, ids, log));
      const key = `chat/${randomUUID()}.${EXTENSION_OF[type]}`;
      await storage.put(key, bytes, type);
      let row: ChatMessageRow;
      try {
        row = await transactions.run(async (tx) => {
          const terms = await lockedParticipantOf(tx, ids, log);
          const sentAt = await clock(tx);
          const inserted = await store.insertAttachment(tx, {
            enrollmentId,
            senderUserId: uploader.userId,
            attachmentKey: key,
            attachmentFilename: filename,
            attachmentMime: type,
            sentAt,
          });
          tellParties(live, terms, inserted);
          return inserted;
        });
      } catch (error: unknown) {
        await storage.remove(key).catch(() => {
          // An orphan file: named by the ids alone, never its key (R-SEC-2).
          log.warn(ids, 'A refused chat document could not be removed from storage');
        });
        throw error;
      }
      return chatUploadOutput.parse({
        messageId: row.id,
        attachment: { filename, mime: type },
        sentAt: row.sentAt.toISOString(),
      });
    },
  });
}
