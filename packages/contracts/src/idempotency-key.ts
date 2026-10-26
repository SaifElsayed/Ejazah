// The kernel's idempotency key (16 to 128 of `A–Z a–z 0–9 _ -`, FR-106), in a file of its own since
// B16 so `account.ts` can carry it without importing `teacher-application.ts`, which imports it.
import { z } from 'zod';

export const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
