// 006:T008 of specs/006-programme (R-510; FR-719; B-P2's conflict check, Q-2 (a)): payments' entry
// that deletes a programme's saved card, which booking's close hook calls on every close (R-API-6:
// booking sets its programme `closed`, payments deletes its own row). A STUB until T013: no
// `programme_cards` row is written before T013's saved-card flow, so there is nothing to delete; the
// close hook's specs assert the call. T013 replaces this body with the row's deletion
// (`programme-cards.*`) and binds it wherever booking's close hook is built.
import type { Transaction } from '../../platform/db/prisma.repository.js';

/** Deletes the programme's saved card, if any, on the close's transaction (a stub until T013). */
export const deleteProgrammeCard: (tx: Transaction, enrollmentId: string) => Promise<void> = () =>
  // T013: the `programme_cards` row deleted here.
  Promise.resolve();
