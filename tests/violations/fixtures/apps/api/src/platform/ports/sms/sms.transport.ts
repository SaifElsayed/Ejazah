// T026 fixture — VIOLATION of R-SEC-11: transport security verification switched off. The
// constitution allows no environment for this, development included, because the setting added
// "temporarily" to make a sandbox certificate work is the setting that ships.
// The canonical spelling the constitution names is the one fixtured here; "and equivalents"
// (contracts/lint-rules.md) — a `NODE_TLS_REJECT_UNAUTHORIZED` assignment, a custom agent that
// accepts any certificate — is one prohibition expressed differently, and how wide the rule
// reaches is T040's to decide.
// No adapter is imported and no concrete provider is named, so R-API-4's two rules stay silent.
// Refused by sec/no-disabled-tls.
export interface TransportOptions {
  readonly host: string;
  readonly rejectUnauthorized: boolean;
}

export const smsTransportOptions: TransportOptions = {
  host: 'sms.example.invalid',
  rejectUnauthorized: false,
};
