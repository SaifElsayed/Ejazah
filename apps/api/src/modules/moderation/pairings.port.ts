// T011 of specs/005-certification (research R-408, «`Pairings`»; R-API-3, R-API-4, R-API-6; the
// note under T011): what moderation asks of who is paired with whom. Booking and sessions import
// moderation, so moderation never imports them; it reads their rows only through this port, which
// `main.ts` binds to sessions' entry (`partyOfSession`) and booking's (`partyOfEnrollment`,
// `paired`), as identity's `OngoingEnrollments` is bound to booking.
//
// Each read is on the caller's transaction and takes no lock: an enrollment's and a session's two
// parties never change, so the caller reads them first and then takes its locks in the one order
// (`platform/db/row-lock.ts`). A soft-deleted session or enrollment is absent from every answer
// (the client's extension, R-DB-3), and a session or enrollment of which `userId` is not a party
// answers null, as one that does not exist (R-GENDER-2). No answer compares genders: the parties
// are compared, not their declared genders (the note under T011, Q-R5 (a)).
import type { Transaction } from '../../platform/db/prisma.repository.js';

/** The caller's place in a session or an enrollment: the enrollment and the other party. */
export interface PairingParty {
  readonly enrollmentId: string;
  readonly counterpartUserId: string;
}

export interface Pairings {
  /** The session's enrollment and the other party when `userId` is one of its two; else null. */
  partyOfSession(tx: Transaction, sessionId: string, userId: string): Promise<PairingParty | null>;
  /** The enrollment and the other party when `userId` is one of its two; else null. */
  partyOfEnrollment(
    tx: Transaction,
    enrollmentId: string,
    userId: string,
  ): Promise<PairingParty | null>;
  /**
   * Whether an enrollment, whatever its status, joins the two people, either as the student; a
   * soft-deleted enrollment does not count (ADR 0006).
   */
  paired(tx: Transaction, userId: string, otherUserId: string): Promise<boolean>;
}
