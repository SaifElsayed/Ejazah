// T013: the gateway stand-in's test harness, the test tree's and the scripts' entry
// (contracts/gateway.md "The test harness", R-213, FR-372, SC-302, SC-311). The only way a spec
// produces a gateway event: it holds the stand-in's secret and the listening API's address, builds
// each event signed as the gateway would (`paid`, `failed`, `expired`, `recipientVerified`,
// `recipientRejected`; since 003:T102 `refunded`, with an amount or the whole order, and
// `refundReported`, the original payment's refund flag with no amount; since 006:T013 `cardSaved`,
// the card saved on an order whose checkout asked `saveCard`), delivers it over HTTP (`deliver`,
// `deliverTwice`, `deliverInOrder`, `deliverAfter`), forges it (`tamper`), and sets what the
// stand-in's `cancelCheckout` answers (`onCancel`).
//
// The building is `apps/api/src/platform/ports/payment/gateway-stand-in.fixtures.ts` (its header
// says why it lives there); this entry binds it to the payments module's own `PAYMENT_WEBHOOK_PATH`,
// so a delivery reaches the route the application mounts, wherever that constant points.
import { PAYMENT_WEBHOOK_PATH } from '../../apps/api/src/modules/payments/index';
import {
  createGatewayStandIn,
  type GatewayStandIn,
  type GatewayStandInOptions,
} from '../../apps/api/src/platform/ports/payment/gateway-stand-in.fixtures';

export {
  FORGERIES,
  type EventIdOption,
  type Forgery,
  type GatewayStandIn,
  type ReportedAmounts,
  type SavedCard,
  type StandInEvent,
  UNREPORTED_AMOUNTS,
} from '../../apps/api/src/platform/ports/payment/gateway-stand-in.fixtures';

/** The harness for the API listening on `origin`, its payment port built from `config`. */
export function gatewayStandIn(
  options: Omit<GatewayStandInOptions, 'webhookPath'>,
): GatewayStandIn {
  return createGatewayStandIn({ ...options, webhookPath: PAYMENT_WEBHOOK_PATH });
}
