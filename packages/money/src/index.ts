// T030: branded money type. A `unique symbol` declared here and never exported makes
// plain numbers and piasters mutually unassignable (FR-012, research R-3).
// Money values are package prices and the gross/fee/net a gateway reports on a payment record (ADR 0007).
// There is no wallet, ledger, balance or share splitting; the platform never holds money. Every value was constructed here.
declare const piastersBrand: unique symbol;

export type Piasters = number & { readonly [piastersBrand]: true };
