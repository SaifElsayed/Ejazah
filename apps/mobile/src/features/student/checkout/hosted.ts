// T046 (FR-PAYG-17, the B30 route handoff): the gateway's hosted checkout opens in an auth session
// that the app's return address closes. Whatever the session ends with, the caller goes on to
// Processing, which reads the outcome from the server and never from the return (R-HONEST-1).
import { openAuthSessionAsync } from 'expo-web-browser';

/** The address the hosted checkout returns to, on the app's own scheme (`app.json`). */
export const CHECKOUT_RETURN_URL = 'ijazah://checkout/return';

export async function openHostedCheckout(checkoutUrl: string): Promise<void> {
  await openAuthSessionAsync(checkoutUrl, CHECKOUT_RETURN_URL);
}
