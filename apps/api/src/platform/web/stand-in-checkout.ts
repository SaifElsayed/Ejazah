// T012: the stand-in's hosted page, `GET` and `POST /stand-in/checkout/:gatewayOrderId`
// (contracts/gateway.md "The stand-in's hosted page", R-213, FR-372, FR-374). Development and test
// only.
//
// MOUNTED ONLY WITH THE STAND-IN. `standInCheckoutRoutes` asks the payment port's entry for the
// stand-in's order operations (`standInCheckoutOf`), which exist only when the selected port is the
// stand-in, that is while `PAYMENT_GATEWAY=fake`, itself refused outside development and test
// (`env.schema.ts`, T146). With any other gateway it answers no route, so the path does not exist:
// the application answers it as any unknown path. The page names the port's entry, never the
// adapter (R-API-4).
//
// WHAT IT DOES. `GET` shows a payable order's amount and three buttons, «ادفع», «فشل الدفع» and
// «إلغاء»; an unknown order, or one cancelled, acted on or past its expiry, shows that it cannot be
// paid (404). Each button posts `action=pay|fail|cancel` back to the page, which has the stand-in sign
// the matching event (`paid`; `failed`; `failed` for a cancellation) under the secret the webhook
// verifies and send it over HTTP to `POST /webhooks/payment`, then shows a link back to the app,
// `ijazah://checkout/return`. A webhook that does not take the event is an unexpected error: logged
// with the request's correlation identifier and nothing of the event, and answered 500.
//
// THE PAGE HELPER (`route.ts`) is what serves it: the strict policy, no cookie, `no-store`, the
// anonymous limit per client address, `?lang=en`, the form read from the body only, and every
// value escaped by the template. The helper answers its page at its mount, so the order's id is
// taken from the path below the mount here and the request handed on at the mount itself. The page
// echoes the id, escaped like any value; it carries no secret, no signature and no event. Its words
// are written here, as the Terms' title is, since the page is not the product's and the phone's
// catalogue has none of them.
import { toPlainNumber } from '@ijazah/money';
import { DomainError } from '../errors/domain-error.js';
import type { Locale } from '../http/locale.js';
import {
  STAND_IN_ACTIONS,
  STAND_IN_CHECKOUT_PATH,
  standInCheckoutOf,
  type PayableOrder,
  type StandInAction,
  type StandInCheckout,
} from '../ports/payment/index.js';
import type { PaymentPort } from '../ports/payment/payment.port.js';
import { html, type SafeHtml } from './html.js';
import { renderPage } from './page.js';
import {
  notFound,
  type NodeHandler,
  type WebResponse,
  type WebRoute,
  type WebRouteDependencies,
  webRoute,
} from './route.js';

export { STAND_IN_CHECKOUT_PATH };

/** Where the page sends the student back to: the app's checkout return (contracts/gateway.md). */
const RETURN_LINK = 'ijazah://checkout/return';

interface Words {
  readonly title: string;
  readonly notice: string;
  readonly order: string;
  readonly amount: string;
  readonly piasters: string;
  readonly actions: Readonly<Record<StandInAction, string>>;
  readonly notPayable: string;
  readonly notPayableBody: string;
  readonly sent: string;
  readonly back: string;
}

const words: Readonly<Record<Locale, Words>> = {
  ar: {
    title: 'الدفع التجريبي',
    notice: 'صفحة دفع تجريبية للتطوير والاختبار، لا يُدفع فيها مال.',
    order: 'الطلب',
    amount: 'المبلغ',
    piasters: 'قرش',
    actions: { pay: 'ادفع', fail: 'فشل الدفع', cancel: 'إلغاء' },
    notPayable: 'لا يمكن دفع هذا الطلب',
    notPayableBody: 'الطلب غير معروف، أو انتهت مدته، أو أُلغي، أو تم التصرف فيه.',
    sent: 'أُرسلت النتيجة',
    back: 'العودة إلى التطبيق',
  },
  en: {
    title: 'Test payment',
    notice: 'A test payment page for development and testing; no money is paid here.',
    order: 'Order',
    amount: 'Amount',
    piasters: 'piasters',
    actions: { pay: 'Pay', fail: 'Fail the payment', cancel: 'Cancel' },
    notPayable: 'This order cannot be paid',
    notPayableBody: 'The order is unknown, expired, cancelled or already acted on.',
    sent: 'The result was sent',
    back: 'Return to the app',
  },
};

export interface StandInCheckoutDependencies extends WebRouteDependencies {
  readonly payment: PaymentPort;
}

/** The page under `STAND_IN_CHECKOUT_PATH` while the port is the stand-in; no route otherwise. */
export function standInCheckoutRoutes({
  payment,
  ...pages
}: StandInCheckoutDependencies): Readonly<Record<string, NodeHandler>> {
  const checkout = standInCheckoutOf(payment);
  return checkout === undefined
    ? {}
    : { [STAND_IN_CHECKOUT_PATH]: standInCheckoutHandler(pages, checkout) };
}

function standInCheckoutHandler(
  pages: WebRouteDependencies,
  checkout: StandInCheckout,
): NodeHandler {
  return (incoming, outgoing) => {
    const { pathname, search } = new URL(incoming.url ?? '/', 'http://local');
    const gatewayOrderId = orderIdOf(pathname);
    incoming.url = `/${search}`;
    webRoute(pages, checkoutPage(checkout, gatewayOrderId))(incoming, outgoing);
  };
}

/** The one segment below the mount, decoded; nothing for none, several, or a malformed one. */
function orderIdOf(pathname: string): string | undefined {
  const segment = /^\/([^/]+)$/.exec(pathname)?.[1];
  if (segment === undefined) return undefined;
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

function isAction(value: string | null): value is StandInAction {
  return (STAND_IN_ACTIONS as readonly (string | null)[]).includes(value);
}

function checkoutPage(checkout: StandInCheckout, gatewayOrderId: string | undefined): WebRoute {
  return {
    methods: ['GET', 'POST'],
    handle: async ({ method, lang, form }): Promise<WebResponse> => {
      if (gatewayOrderId === undefined) return notFound();
      if (method === 'GET') {
        const order = checkout.payableOrder(gatewayOrderId);
        return order === undefined
          ? notPayable(lang, gatewayOrderId)
          : { page: payable(lang, order) };
      }
      const action = form.get('action');
      if (!isAction(action)) throw new DomainError('VALIDATION_FAILED');
      const outcome = await checkout.submit(gatewayOrderId, action);
      return outcome === 'delivered' ? { page: sent(lang) } : notPayable(lang, gatewayOrderId);
    },
  };
}

function screen(lang: Locale, title: string, body: SafeHtml): SafeHtml {
  return renderPage({
    lang,
    title,
    body: html`<div class="screen">
      <main class="screen__body screen__body--bare gap-4">
        <h1>${title}</h1>
        <p class="text-caption tone-muted">${words[lang].notice}</p>
        ${body}
      </main>
    </div>`,
  });
}

function payable(lang: Locale, order: PayableOrder): SafeHtml {
  const text = words[lang];
  const buttons = STAND_IN_ACTIONS.map(
    (action) =>
      html`<form method="post">
        <input type="hidden" name="action" value="${action}" />
        <button
          type="submit"
          class="${action === 'pay' ? 'btn btn--block' : 'btn btn--ghost btn--block'}"
        >
          ${text.actions[action]}
        </button>
      </form>`,
  );
  return screen(
    lang,
    text.title,
    html`<p>${text.order} <span class="ltr">${order.gatewayOrderId}</span></p>
      <p>
        ${text.amount}:
        <span class="ltr">${toPlainNumber(order.amount_piasters)}</span> ${text.piasters} (<span
          class="ltr"
          >${order.currency}</span
        >)
      </p>
      ${buttons}`,
  );
}

function notPayable(lang: Locale, gatewayOrderId: string): WebResponse {
  const text = words[lang];
  return {
    status: 404,
    page: screen(
      lang,
      text.notPayable,
      html`<p>${text.notPayableBody}</p>
        <p>${text.order} <span class="ltr">${gatewayOrderId}</span></p>`,
    ),
  };
}

function sent(lang: Locale): SafeHtml {
  const text = words[lang];
  return screen(
    lang,
    text.sent,
    html`<a href="${RETURN_LINK}" class="btn btn--block">${text.back}</a>`,
  );
}
