// T053 fixture — VIOLATION of R-MONEY-6, confinement half, in `modules/chat` (FR-498, SC-409): a
// chat notice carrying the gateway's gross and net, read from a module that is not `payments`.
// A chat between a teacher and a student names no amount; money-carrying records live only in
// `payments` (FR-016, ADR 0007). The sessions twin is `modules/sessions/gateway-settlement.ts`.
// The amounts carry the brand and the suffix and nothing is computed from them, so R-MONEY-1,
// R-MONEY-2 and R-MONEY-5 all stay silent; the only thing wrong here is where the file lives.
// Refused by boundaries/no-money-vocabulary.
import type { Piasters } from '@ijazah/money';

export interface PaidAmountNotice {
  readonly enrollment_id: string;
  readonly gross_piasters: Piasters;
  readonly net_piasters: Piasters;
}

export declare function paidAmountNoticeFor(enrollmentId: string): Promise<PaidAmountNotice>;
