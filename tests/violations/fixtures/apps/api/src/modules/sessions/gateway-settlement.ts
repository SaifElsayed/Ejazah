// T023 fixture — VIOLATION of R-MONEY-6, confinement half: the gateway's gross, fee and net
// read from a module that is not `payments`. Money-carrying records live only in `payments`, and
// every other module speaks to the `PaymentPort` or to that module's public entry and never
// reads an amount (FR-016, ADR 0007).
// The amounts carry the brand and the suffix and nothing is computed from them, so R-MONEY-1,
// R-MONEY-2 and R-MONEY-5 all stay silent; the only thing wrong here is where the file lives.
// Refused by boundaries/no-money-vocabulary.
import type { Piasters } from '@ijazah/money';

export interface GatewaySettlement {
  readonly gross_piasters: Piasters;
  readonly fee_piasters: Piasters;
  readonly net_piasters: Piasters;
}

export declare function settlementForEnrollment(enrollmentId: string): Promise<GatewaySettlement>;
