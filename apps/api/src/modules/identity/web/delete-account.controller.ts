// T083 (FR-141, FR-143 to FR-145, ADR 0015 D2; public-pages.md "The pages"; research R-111): the
// web deletion pages, `GET /delete-account`, `POST /delete-account` and `POST
// /delete-account/confirm`, over T019's helper, which sends the strict policy and the header set,
// strips any cookie, counts `rate_limit_public_page` per client address, reads `?lang=en` and hands
// a POST's URL-encoded fields to the handler. The pages are the boards `DeleteAccountWeb`,
// `DeleteAccountWebCode` and `DeleteAccountWebDone` (docs/design/screens.md), without the phone
// frame they are drawn in, and their words are the phone catalogue's, copied by
// `scripts/build-web-copy.ts` (the B16 check's decision 7).
//
// THE EMAIL STEP answers one page for every well-formed address: the deletion's `requestWebCode`
// does the same work for an unknown address as for an account (the decoy hash) and writes an
// `account_deletion` code only for an account, its mail dispatched after the commit (T082). The
// page counts the platform's one-time-code budget and then the address, in lower case as it is
// stored, before asking anything, as every code-issuing path does (auth.router.ts). A malformed
// address is told so on the email step and asks nothing; that says nothing of any account.
//
// THE CONFIRM STEP runs the same deletion as `account.delete` (FR-141) when the code is right and
// renders the done page, naming the address and the support address of the configuration
// (FR-145); a wrong, expired or spent code, or one that is not six digits, renders the code step
// again with the one generic line. A code is counted under the one-time-code limit by the address,
// as `auth.email.verifySignUpCode` counts it.
//
// THE ADDRESS NEVER TRAVELS IN A URL: both steps are form POSTs, the code step carries it in a
// hidden field, and the only link, «change email», goes back to the first step bare.
//
// HONEST COPY (the B16 check's decision 4). Sessions, payments and the verification page do not
// exist in this phase, so the email step's banner is `honest.info` and the done page's lede
// `honest.doneLede`, and the done page leaves out the ijazahs and records lines; the board's own
// lines stay in the catalogue for the phase that makes them true.
import { emailAddress, oneTimeCode } from '@ijazah/contracts';

import { errorCodes } from '../../../platform/errors/domain-error.js';
import { defaultRateLimits, type RateLimiter } from '../../../platform/guards/rate-limit.guard.js';
import type { Locale } from '../../../platform/http/locale.js';
import { copyOf, fill } from '../../../platform/web/copy.js';
import { html, type SafeHtml } from '../../../platform/web/html.js';
import { renderPage } from '../../../platform/web/page.js';
import type { WebRequest, WebResponse, WebRoute } from '../../../platform/web/route.js';
import type { DeletionService } from '../deletion.service.js';
import { normalizeEmail } from '../one-time-codes.js';

/** Where the email step is served (public-pages.md). */
export const DELETE_ACCOUNT_PATH = '/delete-account';

/** Where the code step posts (public-pages.md). */
export const DELETE_ACCOUNT_CONFIRM_PATH = '/delete-account/confirm';

/** What the pages are built over. */
export interface DeleteAccountRouteDependencies {
  readonly deletion: Pick<DeletionService, 'requestWebCode' | 'confirmWebDeletion'>;
  /** The support address the done page names, from the configuration (FR-145). */
  readonly supportEmail: string;
  /** The process's limiter, for the address-keyed one-time-code limits (public-pages.md). */
  readonly rateLimiter: Pick<RateLimiter, 'check'>;
}

const { oneTimeCode: ONE_TIME_CODE_LIMIT, oneTimeCodeBudget: ONE_TIME_CODE_BUDGET } =
  defaultRateLimits;

/** The status of a step rendered again because what was sent cannot be used. */
const UNUSABLE_FORM = errorCodes.VALIDATION_FAILED.status;

/** Where a form posts or a link points, keeping the page's language. */
function hrefOf(path: string, lang: Locale): string {
  return lang === 'en' ? `${path}?lang=en` : path;
}

const infoIcon = html`<svg
  class="icon icon--md"
  data-icon="info"
  viewBox="0 0 24 24"
  aria-hidden="true"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M12 16v-4" />
  <path d="M12 8h.01" />
</svg>`;
const alertIcon = html`<svg
  class="icon icon--md"
  data-icon="triangle-alert"
  viewBox="0 0 24 24"
  aria-hidden="true"
>
  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
  <path d="M12 9v4" />
  <path d="M12 17h.01" />
</svg>`;
const trashIcon = html`<svg
  class="icon icon--md"
  data-icon="trash"
  viewBox="0 0 24 24"
  aria-hidden="true"
>
  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
</svg>`;
const checkPath = html`<path d="m5 12 5 5 9-10" />`;

/** The page shell: the document, and the screen body the boards draw. */
function screen(lang: Locale, title: string, body: SafeHtml): SafeHtml {
  return renderPage({
    lang,
    title,
    body: html`<div class="screen">
      <main class="screen__body screen__body--bare gap-4">${body}</main>
    </div>`,
  });
}

/** The brand line of the first two steps: the mark, the name and the page's caption. */
function brandLine(lang: Locale): SafeHtml {
  const copy = copyOf(lang);
  return html`<span class="brand"
    ><span class="brand-mark" aria-hidden="true">${copy.web.deleteAccount.brandMark}</span
    ><span class="brand__name">${copy.web.deleteAccount.brandName}</span
    ><span class="text-caption tone-muted">${copy.web.deleteAccount.brandSuffix}</span></span
  >`;
}

/** The two-step timeline, the first step current or done. */
function timeline(lang: Locale, emailDone: boolean): SafeHtml {
  const steps = copyOf(lang).web.deleteAccount.steps;
  const firstRail = emailDone
    ? html`<span class="timeline__marker timeline__marker--done"
          ><svg
            class="icon icon--xs icon--heavy"
            data-icon="check"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            ${checkPath}
          </svg></span
        ><span class="timeline__line timeline__line--done"></span>`
    : html`<span class="timeline__marker timeline__marker--current">1</span
        ><span class="timeline__line"></span>`;
  const secondItem = emailDone ? 'timeline__item' : 'timeline__item timeline__item--pending';
  const secondMarker = emailDone ? 'timeline__marker--current' : 'timeline__marker--pending';
  return html`<ol class="timeline">
    <li class="timeline__item">
      <span class="timeline__rail">${firstRail}</span>
      <span class="timeline__body"
        ><span class="timeline__title">${steps.email.title}</span
        ><span class="timeline__meta"
          >${emailDone ? steps.email.done : steps.email.meta}</span
        ></span
      >
    </li>
    <li class="${secondItem}">
      <span class="timeline__rail"><span class="timeline__marker ${secondMarker}">2</span></span>
      <span class="timeline__body"
        ><span class="timeline__title">${steps.code.title}</span
        ><span class="timeline__meta">${steps.code.meta}</span></span
      >
    </li>
  </ol>`;
}

/** `DeleteAccountWeb`: the intro, the timeline, the email field; the field in error when told. */
function emailStep(lang: Locale, invalid?: { readonly email: string }): WebResponse {
  const copy = copyOf(lang);
  const text = copy.web.deleteAccount;
  const input =
    invalid === undefined
      ? html`<input
          id="email"
          name="email"
          type="email"
          class="input input--ltr"
          autocomplete="email"
          required
        />`
      : html`<input
            id="email"
            name="email"
            type="email"
            class="input input--ltr input--error"
            autocomplete="email"
            required
            value="${invalid.email}"
            aria-invalid="true"
            aria-describedby="email-error"
          />
          <p id="email-error" class="field__error" role="alert">
            ${copy.web.deleteAccount.emailInvalid}
          </p>`;
  return {
    ...(invalid === undefined ? {} : { status: UNUSABLE_FORM }),
    page: screen(
      lang,
      text.title,
      html`${brandLine(lang)}
        <div class="page-intro">
          <h1 class="page-intro__title">${text.title}</h1>
          <p class="page-intro__lede">${text.lede}</p>
        </div>
        ${timeline(lang, false)}
        <form
          id="delete-account"
          class="field"
          method="post"
          action="${hrefOf(DELETE_ACCOUNT_PATH, lang)}"
        >
          <label for="email" class="field__label">${text.email}</label>
          ${input}
        </form>
        <div class="banner banner--info">
          ${infoIcon}
          <p class="grow">${text.honest.info}</p>
        </div>
        <button type="submit" form="delete-account" class="btn btn--danger btn--block push">
          ${text.sendCode}
        </button>`,
    ),
  };
}

/** One cell of the code: a digit, its label the catalogue's; the first one named for the label. */
function codeCell(label: string, first: boolean, wrongCode: boolean): SafeHtml {
  const cellClass = wrongCode ? 'otp__cell otp__cell--error' : 'otp__cell';
  return first
    ? html`<input
        id="code"
        name="code"
        type="text"
        inputmode="numeric"
        pattern="[0-9]"
        maxlength="1"
        required
        autocomplete="one-time-code"
        class="${cellClass}"
        aria-label="${label}"
      />`
    : html`<input
        name="code"
        type="text"
        inputmode="numeric"
        pattern="[0-9]"
        maxlength="1"
        required
        class="${cellClass}"
        aria-label="${label}"
      />`;
}

/** `DeleteAccountWebCode`: the code step for `email`, with the generic error when told. */
function codeStep(lang: Locale, email: string, wrongCode: boolean): WebResponse {
  const copy = copyOf(lang);
  const text = copy.web.deleteAccount;
  const cells = Object.values(text.code.a11y).map((label, index) =>
    codeCell(label, index === 0, wrongCode),
  );
  const error = wrongCode
    ? html`<p class="field__error" role="alert">${copy.web.deleteAccount.codeInvalid}</p>`
    : null;
  return {
    ...(wrongCode ? { status: UNUSABLE_FORM } : {}),
    page: screen(
      lang,
      text.code.title,
      html`${brandLine(lang)}
        <div class="page-intro">
          <h1 class="page-intro__title">${text.code.title}</h1>
          <p class="page-intro__lede">
            ${fill(text.code.lede, {
              email: html`<span class="ltr tone-default">${email}</span>`,
            })}
          </p>
        </div>
        ${timeline(lang, true)}
        <form
          id="delete-account-code"
          class="field"
          method="post"
          action="${hrefOf(DELETE_ACCOUNT_CONFIRM_PATH, lang)}"
        >
          <input type="hidden" name="email" value="${email}" />
          <label for="code" class="field__label">${text.code.label}</label>
          <div class="otp">${cells}</div>
          ${error}
        </form>
        <div class="banner banner--danger" role="alert">
          ${alertIcon}
          <p class="grow">${text.code.irreversible}</p>
        </div>
        <div class="stack gap-2 push">
          <button type="submit" form="delete-account-code" class="btn btn--danger btn--block">
            ${trashIcon}${text.code.submit}
          </button>
          <a href="${hrefOf(DELETE_ACCOUNT_PATH, lang)}" class="btn btn--ghost btn--block"
            >${text.code.changeEmail}</a
          >
        </div>`,
    ),
  };
}

/** `DeleteAccountWebDone`: the account is gone; the address and the support address named. */
function doneStep(lang: Locale, email: string, supportEmail: string): WebResponse {
  const copy = copyOf(lang);
  const text = copy.web.deleteAccount;
  return {
    page: screen(
      lang,
      text.done.title,
      html`<span class="brand"
          ><span class="brand-mark" aria-hidden="true">${copy.web.deleteAccount.brandMark}</span
          ><span class="brand__name">${text.brandDone}</span></span
        >
        <div class="state-hero">
          <span class="icon-tile icon-tile--2xl"
            ><svg
              class="icon icon--xl icon--medium"
              data-icon="check"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              ${checkPath}
            </svg></span
          >
          <div class="page-intro text-center">
            <h1 class="page-intro__title">${text.done.title}</h1>
            <p class="page-intro__lede">${text.honest.doneLede}</p>
          </div>
        </div>
        <ul class="stack gap-2 text-callout">
          <li class="row row--top gap-2">
            <span class="tone-success"
              ><svg
                class="icon icon--sm icon--medium"
                data-icon="check"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                ${checkPath}
              </svg></span
            ><span class="grow">${text.honest.newAccount}</span>
          </li>
        </ul>
        <p class="text-caption tone-muted push">
          ${fill(text.done.confirmation, {
            email: html`<span class="ltr tone-default">${email}</span>`,
            supportEmail: html`<span class="ltr tone-default">${supportEmail}</span>`,
          })}
        </p>`,
    ),
  };
}

/** The address a form carries, as typed but for surrounding spaces. */
function emailOf(form: URLSearchParams): string {
  return (form.get('email') ?? '').trim();
}

/** The deletion pages by path, for `main.ts` to mount with the other public pages. */
export function deleteAccountRoutes({
  deletion,
  supportEmail,
  rateLimiter,
}: DeleteAccountRouteDependencies): Readonly<Record<string, WebRoute>> {
  const requestCode = async ({ lang, form }: WebRequest): Promise<WebResponse> => {
    const email = emailOf(form);
    if (!emailAddress.safeParse(email).success) return emailStep(lang, { email });
    // Each step's path is its fixed name in a refusal's record (T062); the address is an identifier.
    await rateLimiter.check(ONE_TIME_CODE_BUDGET, { kind: 'budget' }, DELETE_ACCOUNT_PATH);
    await rateLimiter.check(
      ONE_TIME_CODE_LIMIT,
      { kind: 'identifier', value: normalizeEmail(email) },
      DELETE_ACCOUNT_PATH,
    );
    await deletion.requestWebCode(email);
    return codeStep(lang, email, false);
  };

  const confirm = async ({ lang, form }: WebRequest): Promise<WebResponse> => {
    const email = emailOf(form);
    // The six cells post six `code` fields; one field holding the whole code reads the same.
    const code = form.getAll('code').join('');
    if (!emailAddress.safeParse(email).success || !oneTimeCode.safeParse(code).success) {
      return codeStep(lang, email, true);
    }
    await rateLimiter.check(
      ONE_TIME_CODE_LIMIT,
      { kind: 'identifier', value: normalizeEmail(email) },
      DELETE_ACCOUNT_CONFIRM_PATH,
    );
    const deleted = await deletion.confirmWebDeletion(email, code);
    return deleted ? doneStep(lang, email, supportEmail) : codeStep(lang, email, true);
  };

  return {
    [DELETE_ACCOUNT_PATH]: {
      methods: ['GET', 'POST'],
      handle: (request) =>
        request.method === 'POST' ? requestCode(request) : emailStep(request.lang),
    },
    [DELETE_ACCOUNT_CONFIRM_PATH]: { methods: ['POST'], handle: confirm },
  };
}
