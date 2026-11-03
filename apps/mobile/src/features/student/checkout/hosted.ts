// T045 (R-217, FR-PAYG-17, R-HONEST-1): the gateway's hosted checkout. The page opens in the
// system's browser sheet through `openAuthSessionAsync`, which comes back on the app's return link;
// whatever the session answers (returned, cancelled or dismissed), the phone then goes to
// `processing`, which reads the enrollment from the server and never takes the browser's word for
// the payment. A browser that cannot open at all rejects, and the screen that asked says so and
// stays, where a new press asks again. T046's Retry opens the page the same way.
import { router } from 'expo-router';
import { openAuthSessionAsync } from 'expo-web-browser';

/** The link the hosted page returns to (contracts/gateway.md, the stand-in's page). */
export const CHECKOUT_RETURN_URL = 'ijazah://checkout/return';

/** T046's `Processing`, which takes the enrollment's id. */
export const CHECKOUT_PROCESSING_ROUTE = '/(student)/checkout/processing';

/** Opens `checkoutUrl`, then goes to `processing` for `enrollmentId` once the session ends. */
export async function openHostedCheckout(checkoutUrl: string, enrollmentId: string): Promise<void> {
  await openAuthSessionAsync(checkoutUrl, CHECKOUT_RETURN_URL);
  router.replace({ pathname: CHECKOUT_PROCESSING_ROUTE, params: { enrollmentId } });
}
