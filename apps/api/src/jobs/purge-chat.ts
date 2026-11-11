// T039 of specs/004-sessions/tasks.md (FR-492; SRS FR-SESS-13; ERD §15 rule 8; research R-314;
// contracts/kernel.md, "Jobs", the `purge-chat` row): the chat purge, daily, registered by
// `worker.ts` through `scheduleSweeps` under its name, as every sweep is.
//
// Each run is chat's purge (`modules/chat/purge.service.ts`, whose head holds the rules): the files a
// previous run could not remove tried again, then each enrollment whose chat is due purged in its
// own transaction under the enrollment's lock, its files removed after the commit. Every read paged
// by `PURGE_CHAT_PAGE_SIZE`; each enrollment's failure caught on its own.
//
// Run twice, it leaves what one run leaves (R-API-14): a purged message is not purged again, a key
// cleared is not read again, and removing an absent file is not an error.
import { z } from 'zod';

import {
  type ChatPurge,
  type ChatPurgeDependencies,
  createChatPurge,
} from '../modules/chat/index.js';
import type { Database } from '../platform/db/prisma.repository.js';
import { type Transactions, transactionsOver } from '../platform/db/transaction.repository.js';
import { defineJob, type Job } from './job.js';

/** The job's name. */
export const PURGE_CHAT = 'purge-chat';

/** Daily, at 04:10 UTC, after the other daily sweeps (`purge-stale-push-tokens`, the re-resolution). */
export const PURGE_CHAT_SCHEDULE = '10 4 * * *';

/** How many enrollments, or held files, each of the purge's reads takes (as `ERASE_PAGE_SIZE`). */
export const PURGE_CHAT_PAGE_SIZE = 100;

/** What the job's purge is built over, in `worker.ts`: the process's database, or a spec's transactions. */
export type PurgeChatDependencies = Omit<ChatPurgeDependencies, 'transactions' | 'pageSize'> &
  ({ readonly database: Database } | { readonly transactions: Transactions }) & {
    readonly pageSize?: number;
  };

function purgeOver(options: PurgeChatDependencies): ChatPurge {
  const { pageSize = PURGE_CHAT_PAGE_SIZE, ...rest } = options;
  const transactions =
    'transactions' in options ? options.transactions : transactionsOver(options.database);
  return createChatPurge({ ...rest, transactions, pageSize });
}

export function purgeChat(options: PurgeChatDependencies): Job {
  const purge = purgeOver(options);
  return defineJob({
    name: PURGE_CHAT,
    payload: z.object({}),
    schedule: PURGE_CHAT_SCHEDULE,
    run: async () => {
      await purge.run();
    },
  });
}
