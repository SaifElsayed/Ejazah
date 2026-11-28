// R3 T185 (with `specs/004-sessions/tasks.md` T078) — `GET /privacy` over real HTTP (public-pages.md
// "The pages"; `terms/terms.controller.spec.ts` is the model). The policy is a pre-rendered HTML
// fragment per language, a server-built file inserted with `raw()`; the app's privacy modal is a
// WebView of this route and Play's listing links it, its deletion section by `#delete-account`. The
// helper's guarantees (the strict policy, no cookie, the anonymous limit, `?lang=en`) are T019's and
// are asserted here only as this page carries them.
//
// The text is the owner's decisions of 2026-11-28 (R3's ق1–ق5) over `r3\research\privacy.md` §4:
// eighteen sections, Arabic first and prevailing, the draft mark kept, no word on encryption (the
// owner's rule for every user-facing text), and T078's line with the five years of DEC-109.
//
// The last block reads `main.ts`, which starts a process when imported, parsed with TypeScript as
// `api-bind-address-binds.spec.ts` does: the route is mounted beside the Terms.
import { readFileSync } from 'node:fs';

import type { INestApplication } from '@nestjs/common';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../../app.module.js';
import { RateLimiter } from '../../guards/rate-limit.guard.js';
import { createLogger } from '../../logging/logger.js';
import type { SettingsReader } from '../../settings/settings-reader.js';
import { designAssets } from '../assets.js';
import { PUBLIC_PAGE_CSP } from '../route.js';
import { PRIVACY_PATH, privacyRoute } from './privacy.controller.js';
import {
  unusedAdminServices,
  unusedBookingServices,
  unusedCatalogServices,
  unusedCertificationServices,
  unusedModerationServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../../surfaces/services.fixtures.js';

const administration = {
  transactions: { run: () => Promise.reject(new Error('no administrative call is expected here')) },
  auditWriter: {
    write: () => Promise.reject(new Error('no administrative call is expected here')),
  },
};
const sessions = { user: async () => null, admin: async () => null };
const log = createLogger({ level: 'info', destination: { write: () => undefined } });

/** The limiter admits every call; the limit itself is T019's. */
const rateLimiter = new RateLimiter({
  settings: { read: async (_key, schema) => schema.parse({ limit: 1_000, window_seconds: 60 }) },
  counter: { hit: async () => 1 },
  subjectKey: Buffer.alloc(32, 1),
});

/** The page reads no setting: a read is a mistake. */
const settings: SettingsReader = {
  read: () => Promise.reject(new Error('the privacy page reads no setting')),
};
const services = {
  settings,
  publicConfig: { supportEmail: 'support@ijazah.invalid' },
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
  moderation: unusedModerationServices,
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
    rateLimiter,
    sessions,
    services,
    adminServices: unusedAdminServices,
    webRoutes: { [PRIVACY_PATH]: privacyRoute() },
  });
  await application.listen(0, '127.0.0.1');
  origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await application.close();
});

const page = async (query = ''): Promise<string> =>
  (await fetch(`${origin}${PRIVACY_PATH}${query}`)).text();

/** The page's words: the Arabic with its diacritics and tatweel removed, so a voweled word counts. */
const plain = (text: string): string => text.replace(/[ً-ْـ]/g, '');

describe('GET /privacy (R3 T185)', () => {
  it('renders the Arabic policy by default, under the page helper', async () => {
    const response = await fetch(`${origin}/privacy`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toBe(PUBLIC_PAGE_CSP);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    const arabic = await response.text();
    expect(arabic).toContain('<html lang="ar" dir="rtl">');
    expect(arabic).toContain('<title>سياسة الخصوصية</title>');
    expect(arabic).toContain('<h1>سياسة الخصوصية</h1>');
    // The eighteen sections of `privacy.md` §4.2, each a heading.
    expect(arabic.match(/<h2[\s>]/g)?.length).toBe(18);
    // A draft, said so as the Terms say it, with no counsel named (the owner, 2026-11-28).
    expect(arabic).toContain('هذا النص مسودة مؤقتة، ولا يُعدّ صيغة نهائية.');
    expect(arabic).not.toContain('المراجعة القانونية');
    expect(arabic).toContain('2026-11-28');
    // The controller (ق2), and the contact.
    expect(arabic).toContain('خالد ناصر');
    expect(arabic).toContain('دريم لاند، مدينة 6 أكتوبر، الجيزة');
    expect(arabic).toContain('support@ijazahapp.com');
    // English is the other page's.
    expect(arabic).not.toContain('Khaled Nasser');
    expect(arabic).not.toContain('<script');
    expect(arabic).not.toContain('style=');
  });

  it('renders the English policy for ?lang=en, left to right', async () => {
    const english = await page('?lang=en');
    expect(english).toContain('<html lang="en" dir="ltr">');
    expect(english).toContain('<title>Privacy Policy</title>');
    expect(english).toContain('<h1>Privacy Policy</h1>');
    expect(english.match(/<h2[\s>]/g)?.length).toBe(18);
    expect(english).toContain('This text is a provisional draft and is not a final version.');
    expect(english).not.toContain('legal review');
    expect(english).toContain('2026-11-28');
    expect(english).toContain('Khaled Nasser');
    expect(english).toContain('Dreamland, 6th of October City, Giza');
    expect(english).toContain('support@ijazahapp.com');
    expect(english).not.toContain('خالد ناصر');
    expect(english).not.toContain('<script');
    expect(english).not.toContain('style=');
  });

  it('anchors the deletion section as #delete-account, in both languages (Play)', async () => {
    for (const query of ['', '?lang=en']) {
      const text = await page(query);
      expect(text.match(/id="delete-account"/g)?.length).toBe(1);
      expect(text).toMatch(/<h2 id="delete-account">/);
    }
  });

  it('never mentions encryption, in either language (the owner’s rule)', async () => {
    const arabic = plain(await page());
    expect(arabic).not.toMatch(/تشفير|مشفر|شفر/);
    expect(arabic).not.toMatch(/encrypt|cipher/i);
    const english = await page('?lang=en');
    expect(english).not.toMatch(/encrypt|cipher/i);
    expect(plain(english)).not.toMatch(/تشفير|مشفر|شفر/);
  });

  // R3 (the owner's «موافق على كله», 2026-11-28, relayed by the review session): the server's logs
  // kept 90 days, with the address's network only (`logger.ts`'s `addressKeys`, T017).
  it('states the server logs’ 90 days and the address’s network only, in both languages', async () => {
    const arabic = await page();
    expect(arabic).toContain(
      'تحفظ سجلات الخادم جزء الشبكة من عنوان IP فقط، لا العنوان كاملًا، لمدة 90 يومًا.',
    );
    expect(arabic).toMatch(
      /سجلات الخادم \(جزء الشبكة من عنوان IP فقط\)<\/td>\s*<td class="table__wrap">90 يومًا<\/td>/,
    );
    const english = await page('?lang=en');
    expect(english).toContain(
      "The server's logs keep only the IP address's network, not the full address, for 90 days.",
    );
    expect(english).toMatch(
      /Server logs \(the IP address's network only\)<\/td>\s*<td class="table__wrap">90 days<\/td>/,
    );
  });

  it('carries T078’s line with the five years of DEC-109, in both languages', async () => {
    const arabic = await page();
    expect(arabic).toContain('إذا حذف معلّمٌ سبق اعتماده حسابه');
    expect(arabic).toContain('منع الاحتيال');
    expect(arabic).toContain('نحتفظ بها 5 سنوات من تاريخ حذف الحساب، ثم تُمحى');
    expect(arabic).not.toContain('ليس لها مدة انتهاء محددة');
    const english = await page('?lang=en');
    expect(english).toContain('If a teacher who was once approved deletes their account');
    expect(english).toContain('to prevent fraud');
    expect(english).toContain("for 5 years from the account's deletion, then erased");
    expect(english).not.toContain('no fixed end date');
  });

  it('states the owner’s decisions of 2026-11-28 as the app works, in both languages', async () => {
    const arabic = await page();
    // ق1 (a′): the guardian's agreement (T189).
    expect(arabic).toContain(
      'إذا كان عمرك أقل من 18 سنة، فاستخدامك للتطبيق يكون بموافقة وليّ أمرك',
    );
    expect(arabic).toContain('وليّ أمري موافق على تسجيلي');
    // ق3 (a″): the one checkbox, and the transfers said calmly.
    expect(arabic).toContain('أوافق على الشروط والأحكام وسياسة الخصوصية');
    expect(arabic).toContain(
      'خوادمنا في فرنسا (الاتحاد الأوروبي)، ونستعين بمزودي خدمة عالميين مثل Google، قد تُعالج بياناتهم في الولايات المتحدة',
    );
    // No licence is claimed before one exists.
    expect(arabic).not.toContain('بموجب ترخيص');
    const english = await page('?lang=en');
    expect(english).toContain(
      "If you are under 18, you use the app with your parent's or guardian's agreement",
    );
    expect(english).toContain('My parent or guardian agrees to my registration');
    expect(english).toContain('I agree to the Terms and Conditions and the Privacy Policy');
    expect(english).toContain('Our servers are in France (the European Union)');
    expect(english).not.toMatch(/under (a|the) licen[cs]e/i);
  });

  it('names the scheme ?theme= asks for and leaves any other out (T105)', async () => {
    expect(await page('?theme=dark')).toContain('<html lang="ar" dir="rtl" data-theme="dark">');
    expect(await page('?lang=en&theme=light')).toContain(
      '<html lang="en" dir="ltr" data-theme="light">',
    );
    for (const theme of ['"><script>alert(1)</script>', 'blue', 'DARK', '']) {
      const text = await page(`?theme=${encodeURIComponent(theme)}`);
      expect(text).toContain('<html lang="ar" dir="rtl">');
      expect(text).not.toContain('data-theme');
      expect(text).not.toContain('<script');
    }
  });

  it('draws on its own surface and uses only classes the served components.css defines', async () => {
    const components = designAssets().find((asset) => asset.name === 'components.css');
    const rules = (components?.body ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    const defined = new Set([...rules.matchAll(/\.([a-z][a-z0-9_-]*)/g)].map((match) => match[1]));
    for (const query of ['?theme=dark', '?lang=en&theme=light']) {
      const text = await page(query);
      expect(text).toContain('<main class="web-surface gutter">');
      const used = [...text.matchAll(/class="([^"]*)"/g)].flatMap((match) =>
        (match[1] ?? '').split(/\s+/).filter(Boolean),
      );
      expect(used.length).toBeGreaterThan(0);
      expect(used.filter((name) => !defined.has(name))).toEqual([]);
    }
  });
});

describe('main.ts mounts the privacy page beside the Terms (R3 T185)', () => {
  const file = new URL('../../../main.ts', import.meta.url);
  const source = ts.createSourceFile(
    'main.ts',
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );

  /** The entries of the object `webRoutes:` is given, as `name: initializer` texts. */
  function webRoutesEntries(): string[] {
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(source) === 'webRoutes' &&
        ts.isObjectLiteralExpression(node.initializer)
      ) {
        for (const entry of node.initializer.properties) {
          if (ts.isPropertyAssignment(entry)) {
            found.push(`${entry.name.getText(source)}: ${entry.initializer.getText(source)}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  }

  it('gives webRoutes the privacy route under PRIVACY_PATH, beside the Terms', () => {
    const entries = webRoutesEntries();
    expect(entries).toContain('[PRIVACY_PATH]: privacyRoute()');
    expect(entries).toContain('[TERMS_PATH]: termsRoute({ settings })');
  });

  it('loads the controller after the configuration, as every other part', () => {
    expect(source.getText()).toContain("import('./platform/web/privacy/privacy.controller.js')");
    expect(source.getText()).not.toMatch(/^import .*privacy\.controller/m);
  });
});
