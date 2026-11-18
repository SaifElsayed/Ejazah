// T081 — the web deletion pages over real HTTP (FR-143, FR-144, ADR 0015 D2; public-pages.md "The
// pages"; the boards `DeleteAccountWeb`, `DeleteAccountWebCode`, `DeleteAccountWebDone`).
//
// The application is built as main.ts builds it (`createApplication`), with the pages mounted under
// their paths and listened on an ephemeral port; every case is a real request. The deletion itself
// is T082's: here it is a recording fake, so these cases hold what the pages do with its answers.
// The end-to-end case over the real identity services and a database of its own is
// `tests/identity/delete-account-web.spec.ts`.
//
// What the pages owe (public-pages.md): the email step answers one page for every address, the work
// done by the deletion's `requestWebCode` whatever the address, counted under the one-time-code
// limit by the address and the platform's budget; the confirm step renders the done page with the
// address and the support address when the code was right, and the code step with the generic error
// otherwise; the email and the code travel in form bodies only, the address in a hidden field on the
// code step and never in a URL; the strict policy and the header set on every response, no cookie,
// Arabic by default and English by `?lang=en`. The copy is the phone catalogue's, with the honest
// lines of the B16 check's decision 4: nothing about sessions, payments or the verification page.
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApplication } from '../../../app.module.js';
import { DomainError } from '../../../platform/errors/domain-error.js';
import {
  defaultRateLimits,
  RateLimiter,
  type RateLimitKey,
  type RateLimitSubject,
} from '../../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../../platform/logging/logger.js';
import { copyOf } from '../../../platform/web/copy.js';
import { PUBLIC_FORM_MAX_BYTES, PUBLIC_PAGE_CSP } from '../../../platform/web/route.js';
import {
  unusedAdminServices,
  unusedBookingServices,
  unusedCatalogServices,
  unusedCertificationServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../../surfaces/services.fixtures.js';
import {
  DELETE_ACCOUNT_CONFIRM_PATH,
  DELETE_ACCOUNT_PATH,
  deleteAccountRoutes,
} from './delete-account.controller.js';

const SUPPORT = 'support@ijazah.invalid';
const ar = copyOf('ar').web.deleteAccount;
const en = copyOf('en').web.deleteAccount;

const administration = {
  transactions: { run: () => Promise.reject(new Error('no administrative call is expected here')) },
  auditWriter: {
    write: () => Promise.reject(new Error('no administrative call is expected here')),
  },
};
const sessions = { user: async () => null, admin: async () => null };
const services = {
  settings: {
    read: async () => {
      throw new Error('no setting is read here');
    },
  },
  publicConfig: { supportEmail: SUPPORT },
  subjects: { listActive: async () => [] },
  identity: unusedIdentityServices,
  verification: unusedVerificationServices,
  catalog: unusedCatalogServices,
  teacherProfile: unusedTeacherProfileServices,
  discovery: unusedDiscoveryServices,
  booking: unusedBookingServices,
  checkout: unusedCheckoutServices,
  sessions: unusedSessionsServices,
  chat: unusedChatServices,
  certification: unusedCertificationServices,
};
const records: string[] = [];
const log = createLogger({ level: 'info', destination: { write: (line) => records.push(line) } });

/** The anonymous page limit admits every call here; it is T019's. */
const pageLimiter = new RateLimiter({
  settings: { read: async (_key, schema) => schema.parse({ limit: 1_000, window_seconds: 60 }) },
  counter: { hit: async () => 1 },
  subjectKey: Buffer.alloc(32, 1),
});

/**
 * What the pages counted, in order (the budget as `*`, an address as itself, T062's
 * `RateLimitSubject` read back), each step's procedure name, and the subjects to refuse.
 */
const counted: Array<readonly [RateLimitKey, string]> = [];
const procedures: string[] = [];
const refusedSubjects = new Set<string>();
const addressLimiter = {
  check: vi.fn(async (key: RateLimitKey, subject: RateLimitSubject, procedure: string) => {
    const text =
      subject.kind === 'identifier' ? subject.value : subject.kind === 'budget' ? '*' : '';
    counted.push([key, text]);
    procedures.push(procedure);
    if (refusedSubjects.has(text)) throw new DomainError('RATE_LIMITED');
  }),
};

/** The deletion's two web steps, recording each call; the answer of the confirm step per case. */
let confirmAnswer = true;
const deletion = {
  requestWebCode: vi.fn(async (_email: string): Promise<void> => {}),
  confirmWebDeletion: vi.fn(async (_email: string, _code: string) => confirmAnswer),
};

let application: INestApplication;
let origin: string;

beforeAll(async () => {
  application = await createApplication({
    log,
    readiness: { databaseReachable: async () => {} },
    securityHeaders: { allowedOrigins: [], mode: 'test' },
    maxRequestBodyBytes: 1024,
    administration,
    rateLimiter: pageLimiter,
    sessions,
    services,
    adminServices: unusedAdminServices,
    webRoutes: deleteAccountRoutes({
      deletion,
      supportEmail: SUPPORT,
      rateLimiter: addressLimiter,
    }),
  });
  await application.listen(0, '127.0.0.1');
  origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await application.close();
});

beforeEach(() => {
  counted.length = 0;
  refusedSubjects.clear();
  confirmAnswer = true;
  deletion.requestWebCode.mockClear();
  deletion.requestWebCode.mockImplementation(async () => {});
  deletion.confirmWebDeletion.mockClear();
});

/** A form POST, the fields in the body as a browser sends them. */
function submit(path: string, fields: Readonly<Record<string, string | readonly string[]>>) {
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    for (const each of typeof value === 'string' ? [value] : value) body.append(name, each);
  }
  return fetch(`${origin}${path}`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

const digits = (code: string): string[] => [...code];

/** Every URL the page carries: links, form actions and stylesheets. */
function urlsOf(page: string): string[] {
  return [...page.matchAll(/\s(?:href|action|src)="([^"]*)"/g)].map(([, url]) => url ?? '');
}

function expectPublicHeaders(response: Response): void {
  expect(response.headers.get('content-security-policy')).toBe(PUBLIC_PAGE_CSP);
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('set-cookie')).toBeNull();
}

describe('GET /delete-account: DeleteAccountWeb (FR-143)', () => {
  it('renders the intro, the two-step timeline and the email field, in Arabic right to left', async () => {
    const response = await fetch(`${origin}${DELETE_ACCOUNT_PATH}`);
    expect(response.status).toBe(200);
    expectPublicHeaders(response);
    const page = await response.text();
    expect(page).toContain('<html lang="ar" dir="rtl">');
    expect(page).toContain(`<title>${ar.title}</title>`);
    expect(page).toContain(`<h1 class="page-intro__title">${ar.title}</h1>`);
    expect(page).toContain(ar.lede);
    for (const line of [ar.steps.email.title, ar.steps.email.meta, ar.steps.code.title]) {
      expect(page).toContain(line);
    }
    expect(page).toContain('timeline__marker--current');
    expect(page).toContain(ar.email);
    expect(page).toMatch(/<input[^>]*name="email"[^>]*type="email"[^>]*required/);
    expect(page).toMatch(/<form[^>]*method="post"[^>]*action="\/delete-account"/);
    expect(page).toContain(ar.sendCode);
    expect(page).not.toContain('<script');
  });

  it('says only what this phase does: the honest line, never the sessions, payments or ijazahs (decision 4)', async () => {
    const page = await (await fetch(`${origin}${DELETE_ACCOUNT_PATH}`)).text();
    expect(page).toContain(ar.honest.info);
    expect(page).not.toContain(ar.info);
  });

  it('renders English left to right for ?lang=en, and its form keeps the language', async () => {
    const response = await fetch(`${origin}${DELETE_ACCOUNT_PATH}?lang=en`);
    expect(response.headers.get('content-language')).toBe('en');
    const page = await response.text();
    expect(page).toContain('<html lang="en" dir="ltr">');
    expect(page).toContain(en.title);
    expect(page).toContain(en.honest.info);
    expect(page).toContain('action="/delete-account?lang=en"');
  });
});

describe('POST /delete-account: the email step (FR-143, public-pages.md)', () => {
  it('asks the deletion for a code and renders DeleteAccountWebCode with the address in a hidden field', async () => {
    const response = await submit(DELETE_ACCOUNT_PATH, { email: 'Someone@Example.com' });
    expect(response.status).toBe(200);
    expectPublicHeaders(response);
    expect(deletion.requestWebCode).toHaveBeenCalledExactlyOnceWith('Someone@Example.com');
    const page = await response.text();
    expect(page).toContain(`<h1 class="page-intro__title">${ar.code.title}</h1>`);
    expect(page).toContain('<span class="ltr tone-default">Someone@Example.com</span>');
    expect(page).toMatch(/<input type="hidden" name="email" value="Someone@Example.com"/);
    expect(page).toMatch(/<form[^>]*method="post"[^>]*action="\/delete-account\/confirm"/);
    expect(page).toContain('timeline__marker--done');
    expect(page).toContain(ar.steps.email.done);
    const cells = [...page.matchAll(/<input[^>]*class="otp__cell"[^>]*>/g)];
    expect(cells).toHaveLength(Object.keys(ar.code.a11y).length);
    for (const label of Object.values(ar.code.a11y))
      expect(page).toContain(`aria-label="${label}"`);
    expect(cells.every(([cell]) => cell.includes('name="code"'))).toBe(true);
    expect(page).toContain(ar.code.irreversible);
    expect(page).toContain(ar.code.submit);
    expect(page).toContain(ar.code.changeEmail);
  });

  it('answers one page for every address: only the address differs, and the same work is asked', async () => {
    const first = await (await submit(DELETE_ACCOUNT_PATH, { email: 'one@example.com' })).text();
    const second = await (await submit(DELETE_ACCOUNT_PATH, { email: 'two@example.com' })).text();
    expect(first.replaceAll('one@example.com', 'X')).toBe(
      second.replaceAll('two@example.com', 'X'),
    );
    expect(deletion.requestWebCode.mock.calls).toEqual([['one@example.com'], ['two@example.com']]);
  });

  it('counts the one-time-code budget and the address, in lower case, before any work', async () => {
    await submit(DELETE_ACCOUNT_PATH, { email: 'Someone@Example.com' });
    expect(counted).toEqual([
      [defaultRateLimits.oneTimeCodeBudget, '*'],
      [defaultRateLimits.oneTimeCode, 'someone@example.com'],
    ]);
    // The step's path names it in a refusal's record (T062).
    expect(procedures.slice(-2)).toEqual([DELETE_ACCOUNT_PATH, DELETE_ACCOUNT_PATH]);
    refusedSubjects.add('limited@example.com');
    const refused = await submit(DELETE_ACCOUNT_PATH, { email: 'limited@example.com' });
    expect(refused.status).toBe(429);
    expectPublicHeaders(refused);
    expect(deletion.requestWebCode).toHaveBeenCalledTimes(1);
  });

  it('renders the email step again with the invalid-address line for a malformed address, asking nothing', async () => {
    for (const email of ['not an address', '']) {
      const response = await submit(DELETE_ACCOUNT_PATH, { email });
      expect(response.status).toBe(400);
      expectPublicHeaders(response);
      const page = await response.text();
      expect(page).toContain(copyOf('ar').web.deleteAccount.emailInvalid);
      expect(page).toContain('input--error');
      expect(page).toContain(`<h1 class="page-intro__title">${ar.title}</h1>`);
    }
    expect(deletion.requestWebCode).not.toHaveBeenCalled();
    expect(counted).toEqual([]);
  });

  it('escapes the address wherever the page writes it', async () => {
    const page = await (await submit(DELETE_ACCOUNT_PATH, { email: '"x"<b>@example.com' })).text();
    expect(page).not.toContain('<b>');
    expect(page).toContain('&quot;x&quot;&lt;b&gt;@example.com');
  });

  it('answers the error page when the deletion fails, never the code step', async () => {
    deletion.requestWebCode.mockRejectedValueOnce(new Error('the mail store is down'));
    const response = await submit(DELETE_ACCOUNT_PATH, { email: 'someone@example.com' });
    expect(response.status).toBe(500);
    const page = await response.text();
    expect(page).not.toContain(ar.code.title);
    expect(page).not.toContain('mail store');
  });
});

describe('POST /delete-account/confirm: the code step (FR-141, FR-143, FR-145)', () => {
  it('runs the deletion with the address and the six digits, and renders DeleteAccountWebDone', async () => {
    const response = await submit(DELETE_ACCOUNT_CONFIRM_PATH, {
      email: 'someone@example.com',
      code: digits('123456'),
    });
    expect(response.status).toBe(200);
    expectPublicHeaders(response);
    expect(deletion.confirmWebDeletion).toHaveBeenCalledExactlyOnceWith(
      'someone@example.com',
      '123456',
    );
    const page = await response.text();
    expect(page).toContain(`<title>${ar.done.title}</title>`);
    expect(page).toContain(ar.brandDone);
    expect(page).toContain(ar.done.title);
    // Not a promise a banned person's deletion would break (T097; B16 review, round 2, m1).
    expect(page).toContain(ar.honest.newAccount);
    expect(page).not.toContain(ar.done.newAccount);
    expect(page).toContain(
      ar.done.confirmation
        // Each address in its own left-to-right run, as the code step names it (B16 review, nit).
        .replace('{email}', '<span class="ltr tone-default">someone@example.com</span>')
        .replace('{supportEmail}', `<span class="ltr tone-default">${SUPPORT}</span>`),
    );
    expect(counted).toEqual([[defaultRateLimits.oneTimeCode, 'someone@example.com']]);
  });

  it('says only what this phase does: the honest lede, no ijazah or records line (decision 4)', async () => {
    const page = await (
      await submit(DELETE_ACCOUNT_CONFIRM_PATH, { email: 'a@example.com', code: '123456' })
    ).text();
    expect(page).toContain(ar.honest.doneLede);
    expect(page).not.toContain(ar.done.lede);
    expect(page).not.toContain(ar.done.ijazahs);
    expect(page).not.toContain(ar.done.records);
  });

  it('renders the code step again with the generic error for a wrong code, the address kept hidden', async () => {
    confirmAnswer = false;
    const response = await submit(DELETE_ACCOUNT_CONFIRM_PATH, {
      email: 'someone@example.com',
      code: digits('000000'),
    });
    expect(response.status).toBe(400);
    expectPublicHeaders(response);
    const page = await response.text();
    expect(page).toContain(`<h1 class="page-intro__title">${ar.code.title}</h1>`);
    expect(page).toContain(copyOf('ar').web.deleteAccount.codeInvalid);
    expect(page).toContain('otp__cell--error');
    expect(page).toMatch(/<input type="hidden" name="email" value="someone@example.com"/);
    expect(page).not.toContain(ar.done.title);
  });

  it('renders the same generic error for a code that is not six digits, asking nothing', async () => {
    for (const code of [digits('12345'), digits('12a456'), [], ['1234567']]) {
      const response = await submit(DELETE_ACCOUNT_CONFIRM_PATH, {
        email: 'someone@example.com',
        code,
      });
      expect(response.status).toBe(400);
      expect(await response.text()).toContain(copyOf('ar').web.deleteAccount.codeInvalid);
    }
    expect(deletion.confirmWebDeletion).not.toHaveBeenCalled();
  });

  it('refuses the code past the address’s one-time-code limit, before the deletion is asked', async () => {
    refusedSubjects.add('someone@example.com');
    const response = await submit(DELETE_ACCOUNT_CONFIRM_PATH, {
      email: 'Someone@example.com',
      code: '123456',
    });
    expect(response.status).toBe(429);
    expect(deletion.confirmWebDeletion).not.toHaveBeenCalled();
  });

  it('renders English for ?lang=en', async () => {
    const page = await (
      await submit(`${DELETE_ACCOUNT_CONFIRM_PATH}?lang=en`, {
        email: 'a@example.com',
        code: '123456',
      })
    ).text();
    expect(page).toContain('<html lang="en" dir="ltr">');
    expect(page).toContain(en.done.title);
    expect(page).toContain(en.honest.doneLede);
  });

  // T080 of specs/004-sessions (FR-511; the note under T080, N5): the deletion refused for an
  // ongoing enrollment, after the right code was spent, renders the refusal: the line's words and
  // the support address, no count, neither the done page nor the code step.
  const activeEnrollments = () =>
    new DomainError('CONFLICT', undefined, {
      details: [{ path: 'cause', code: 'active_enrollments' }],
    });

  it('renders the refusal of an ongoing enrollment: the words and the support address, no count (T080)', async () => {
    deletion.confirmWebDeletion.mockRejectedValueOnce(activeEnrollments());
    const response = await submit(DELETE_ACCOUNT_CONFIRM_PATH, {
      email: 'someone@example.com',
      code: digits('123456'),
    });
    expect(response.status).toBe(409);
    expectPublicHeaders(response);
    const page = await response.text();
    expect(page).toContain('<html lang="ar" dir="rtl">');
    expect(page).toContain(ar.refused.activeEnrollments);
    expect(page).toContain(`href="mailto:${SUPPORT}"`);
    expect(page).toContain(`<span class="ltr">${SUPPORT}</span>`);
    expect(page).not.toContain(ar.done.title);
    expect(page).not.toContain(ar.code.title);
    expect(page).not.toContain('otp__cell');
    expect(page).not.toContain('someone@example.com');
  });

  it('renders the refusal in English for ?lang=en (T080)', async () => {
    deletion.confirmWebDeletion.mockRejectedValueOnce(activeEnrollments());
    const response = await submit(`${DELETE_ACCOUNT_CONFIRM_PATH}?lang=en`, {
      email: 'a@example.com',
      code: '123456',
    });
    expect(response.status).toBe(409);
    const page = await response.text();
    expect(page).toContain('<html lang="en" dir="ltr">');
    expect(page).toContain(en.refused.activeEnrollments);
    expect(page).toContain(`href="mailto:${SUPPORT}"`);
  });

  // 005:T031 of specs/005-certification (FR-630; the note under T031): a teacher's deletion refused
  // for an undecided ijazah request, after the right code was spent, renders that cause's own words
  // and the support address, never the ongoing enrollment's.
  const pendingRequests = () =>
    new DomainError('CONFLICT', undefined, {
      details: [{ path: 'cause', code: 'pending_ijazah_requests' }],
    });

  it.each([
    ['ar', '', ar],
    ['en', '?lang=en', en],
  ] as const)(
    'renders the refusal of an undecided ijazah request in its own words (%s, 005:T031)',
    async (lang, query, text) => {
      deletion.confirmWebDeletion.mockRejectedValueOnce(pendingRequests());
      const response = await submit(`${DELETE_ACCOUNT_CONFIRM_PATH}${query}`, {
        email: 'someone@example.com',
        code: '123456',
      });
      expect(response.status).toBe(409);
      expectPublicHeaders(response);
      const page = await response.text();
      expect(page).toContain(`<html lang="${lang}"`);
      expect(page).toContain(text.refused.pendingIjazahRequests);
      expect(page).not.toContain(text.refused.activeEnrollments);
      expect(page).toContain(`href="mailto:${SUPPORT}"`);
      expect(page).not.toContain(text.done.title);
      expect(page).not.toContain('someone@example.com');
    },
  );

  it('answers the error page for any other conflict, never the refusal (T080)', async () => {
    deletion.confirmWebDeletion.mockRejectedValueOnce(new DomainError('CONFLICT'));
    const response = await submit(DELETE_ACCOUNT_CONFIRM_PATH, {
      email: 'a@example.com',
      code: '123456',
    });
    const page = await response.text();
    expect(response.status).not.toBe(200);
    expect(page).not.toContain(ar.refused.activeEnrollments);
    // 005:T031 (rule d): nor the request's refusal.
    expect(page).not.toContain(ar.refused.pendingIjazahRequests);
    expect(page).not.toContain(ar.done.title);
  });

  it('takes no GET: the confirm step is a form POST only', async () => {
    const response = await fetch(`${origin}${DELETE_ACCOUNT_CONFIRM_PATH}?email=a%40example.com`);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(deletion.confirmWebDeletion).not.toHaveBeenCalled();
  });
});

describe('every page (FR-144)', () => {
  it('never carries the address in a URL: forms post it, links and actions name none', async () => {
    const pages = [
      await (await fetch(`${origin}${DELETE_ACCOUNT_PATH}?lang=en`)).text(),
      await (await submit(DELETE_ACCOUNT_PATH, { email: 'someone@example.com' })).text(),
      await (
        await submit(DELETE_ACCOUNT_CONFIRM_PATH, { email: 'someone@example.com', code: '000000' })
      ).text(),
    ];
    confirmAnswer = true;
    pages.push(
      await (
        await submit(DELETE_ACCOUNT_CONFIRM_PATH, { email: 'someone@example.com', code: '123456' })
      ).text(),
    );
    for (const page of pages) {
      for (const url of urlsOf(page)) {
        expect(url).not.toContain('@');
        expect(url).not.toContain('email');
      }
      for (const [form] of page.matchAll(/<form[^>]*>/g)) expect(form).toContain('method="post"');
    }
  });

  it('refuses a form body over the limit with 413 as a page', async () => {
    const response = await submit(DELETE_ACCOUNT_PATH, {
      email: `${'a'.repeat(PUBLIC_FORM_MAX_BYTES)}@example.com`,
    });
    expect(response.status).toBe(413);
    expectPublicHeaders(response);
    expect(deletion.requestWebCode).not.toHaveBeenCalled();
  });
});
