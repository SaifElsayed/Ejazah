// T045: `checkout.current`'s query key, in a file of its own so the booking sheet (T044) can mark the
// checkout's summary stale without loading the checkout's screens (PR #121's review, round 1).
export const CHECKOUT_CURRENT_QUERY_KEY = ['student', 'checkout', 'current'] as const;
