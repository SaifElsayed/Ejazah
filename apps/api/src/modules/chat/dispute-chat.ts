// T040 of specs/004-sessions/tasks.md (FR-475, FR-480; research R-301, R-314; contracts/kernel.md, "The
// composition root"): the binding of sessions' `DisputeChat` port, which `main.ts` hands the
// administrator's services, so sessions reads an enrollment's chat without importing chat (the
// cycle chat → booking → sessions; the owner's decision of 2026-11-05 on the analysis, C5).
//
// Sessions checks the dispute open first and asks with its enrollment; this answers the page
// `chat.list` answers (`chat_page_size` messages newest first, keyset on the message id, a purged
// message with neither body nor attachment), each sender named by its role in the enrollment, read
// through the same `ChatEnrollments` binding, in place of `mine`. The administrator is no party, so
// no gender is compared; nothing is locked (the note under T037, Q3 (a)); the page selects no
// storage key (R-SEC-3).
import { z } from 'zod';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { DisputeChat, DisputeChatMessage } from '../sessions/index.js';
import { messagePage } from './chat.repository.js';
import {
  CHAT_PAGE_SIZE_SETTING,
  type ChatEnrollments,
  type ChatStore,
  chatMessageOf,
} from './chat.service.js';

const positiveWhole = z.int().positive();

export interface DisputeChatDependencies {
  readonly enrollments: Pick<ChatEnrollments, 'enrollmentFor'>;
  readonly settings: SettingsReader;
  readonly store?: Pick<ChatStore, 'messagePage'>;
}

export function createDisputeChat({
  enrollments,
  settings,
  store = { messagePage },
}: DisputeChatDependencies): DisputeChat {
  return {
    chatPage: async (tx: Transaction, enrollmentId, cursor) => {
      const terms = await enrollments.enrollmentFor(tx, enrollmentId);
      if (terms === null) return null;
      const pageSize = await settings.read(CHAT_PAGE_SIZE_SETTING, positiveWhole);
      const rows = await store.messagePage(tx, {
        enrollmentId,
        before: cursor,
        take: pageSize + 1,
      });
      const page = rows.slice(0, pageSize);
      const messages = page.map((row): DisputeChatMessage => {
        // `mine` is read from the student's side: a message is the student's or the teacher's.
        const { mine, ...message } = chatMessageOf(row, terms.studentUserId);
        return { ...message, senderRole: mine ? 'student' : 'teacher' };
      });
      const last = page.at(-1);
      return rows.length > pageSize && last !== undefined
        ? { messages, nextCursor: last.id }
        : { messages };
    },
  };
}
