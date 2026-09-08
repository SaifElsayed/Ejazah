// T023 fixture — VIOLATION of R-MONEY-6, vocabulary half: wallet, escrow and ledger concepts.
// The platform holds no funds and computes no balance (ADR 0007), so this vocabulary is refused
// anywhere in the applications, not merely outside `payments` (FR-016).
// No amount is named or typed here, so the money-position and arithmetic rules stay silent.
// Refused by boundaries/no-money-vocabulary.
export interface StudentWallet {
  readonly walletId: string;
}

export declare function creditWalletFromEscrowLedger(wallet: StudentWallet): Promise<void>;
