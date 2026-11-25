// T045 (R-217, FR-PAYG-17, R-HONEST-1): the gateway's hosted checkout. The page opens in the
// system's browser sheet through `openAuthSessionAsync`, which comes back on the app's return link;
// whatever the session answers (returned, cancelled or dismissed), the phone then goes to
// `processing`, which reads the enrollment from the server and never takes the browser's word for
// the payment. A browser that cannot open at all rejects, and the screen that asked says so and
// stays, where a new press asks again. T046's Retry opens the page the same way. 006:T019: a
// programme order's page returns to where it was opened (`openProgrammeCheckout`).
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

/**
 * 006:T019 (Q-A1 (a), the owner, 2026-11-25; R-HONEST-1): a programme order's hosted page
 * (`programme.pay`, `programme.renew`, `checkout.continue` on the programme's order). It opens the
 * same way, and once the session ends the caller stays where it is: the programme's enrollment is
 * already confirmed on its assessment, so `processing` would report it paid at once, with the
 * assessment's receipt. The programme's page says the month is paid when the server does.
 */
export async function openProgrammeCheckout(checkoutUrl: string): Promise<void> {
  await openAuthSessionAsync(checkoutUrl, CHECKOUT_RETURN_URL);
}
