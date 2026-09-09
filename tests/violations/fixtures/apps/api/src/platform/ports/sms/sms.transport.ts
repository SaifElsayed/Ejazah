// T026 fixture — VIOLATION of R-SEC-11: transport security verification switched off, which the
// constitution allows in no environment. This is the canonical spelling it names; how far "and
// equivalents" reaches is T040's to decide.
// Refused by sec/no-disabled-tls.
export interface TransportOptions {
  readonly host: string;
  readonly rejectUnauthorized: boolean;
}

export const smsTransportOptions: TransportOptions = {
  host: 'sms.example.invalid',
  rejectUnauthorized: false,
};
