// T117: PaymentPort (ADR 0007). Direct gateway checkout, 0% commission, zero custody.
// createCheckout, verifyAndParseEvent (raw body — throws on bad signature, R-MONEY-9),
// registerPayoutRecipient, getRecipientStatus. No balance, transfer or refund operation exists by construction.
export {};
