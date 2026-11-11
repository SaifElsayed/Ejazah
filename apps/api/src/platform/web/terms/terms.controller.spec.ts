// T039 — `GET /terms` over real HTTP (FR-127, ADR 0021 D5, research R-111; public-pages.md "The
// pages"). The Terms body is a pre-rendered HTML fragment per language, a server-built file
// inserted with `raw()`, shown with the `terms_version` setting read on every request; the app's
// Terms modal is a WebView of this route. The helper's guarantees (the strict policy, no cookie,
// the anonymous limit, `?lang=en`) are T019's and are asserted here only as this page carries them.
//
// T105: `?theme=dark|light` names the app's scheme on `<html>`, any other value is left out of the
// page, and the page paints its own background (`.web-surface`) with classes the served
// `components.css` defines.
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication } from '../../../app.module.js';
import { RateLimiter } from '../../guards/rate-limit.guard.js';
import { createLogger } from '../../logging/logger.js';
import { SettingError, type SettingsReader } from '../../settings/settings-reader.js';
import { designAssets } from '../assets.js';
import { PUBLIC_PAGE_CSP } from '../route.js';
import { TERMS_PATH, termsRoute } from './terms.controller.js';
import {
  unusedAdminServices,
  unusedBookingServices,
  unusedCatalogServices,
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

/** The version the page reads, changed per case; `null` is a store without the key. */
let version: string | null = '2026-10';
const settings: SettingsReader = {
  read: async (key, schema) => {
    if (key !== 'terms_version' || version === null) throw new SettingError(key, 'missing');
    return schema.parse(version);
  },
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
    webRoutes: { [TERMS_PATH]: termsRoute({ settings }) },
  });
  await application.listen(0, '127.0.0.1');
  origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await application.close();
});

describe('GET /terms (T039, FR-127)', () => {
  it('renders the Arabic Terms with the version from the setting, under the page helper', async () => {
    version = '2026-10';
    const response = await fetch(`${origin}/terms`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toBe(PUBLIC_PAGE_CSP);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    const page = await response.text();
    expect(page).toContain('<html lang="ar" dir="rtl">');
    expect(page).toContain('<title>الشروط والأحكام</title>');
    expect(page).toContain('2026-10');
    // The fragment's sections, inserted as markup: the drawn board's five, with their headings.
    expect(page.match(/<h2/g)?.length).toBeGreaterThanOrEqual(5);
    expect(page).toContain('وسيط تقني');
    // A draft, said so until counsel writes the text.
    expect(page).toContain('المراجعة القانونية');
    expect(page).not.toContain('<script');
  });

  it('states what FR-AUTH-11 and FR-PAYG-9 require, in both languages (PR #80 review, 6)', async () => {
    version = '2026-10';
    const arabic = await (await fetch(`${origin}/terms`)).text();
    for (const statement of ['في أي وقت', 'حظر الحساب', 'إدارة المنصة']) {
      expect(arabic).toContain(statement);
    }
    const english = await (await fetch(`${origin}/terms?lang=en`)).text();
    for (const statement of ['at any time', 'grounds for banning', 'Platform Administration']) {
      expect(english).toContain(statement);
    }
  });

  it('renders the English fragment for ?lang=en, left to right', async () => {
    version = '2026-10';
    const page = await (await fetch(`${origin}/terms?lang=en`)).text();
    expect(page).toContain('<html lang="en" dir="ltr">');
    expect(page).toContain('<title>Terms and Conditions</title>');
    expect(page).toContain('2026-10');
    expect(page).toContain('technology intermediary');
    expect(page).toContain('legal review');
  });

  it('escapes the version it shows, whatever the setting holds', async () => {
    version = '2026-10<b>x</b>';
    const page = await (await fetch(`${origin}/terms`)).text();
    expect(page).toContain('2026-10&lt;b&gt;x&lt;/b&gt;');
    expect(page).not.toContain('<b>x</b>');
  });

  it('names the scheme ?theme= asks for, dark or light, on <html> (T105)', async () => {
    version = '2026-10';
    const dark = await (await fetch(`${origin}/terms?theme=dark`)).text();
    expect(dark).toContain('<html lang="ar" dir="rtl" data-theme="dark">');
    const light = await (await fetch(`${origin}/terms?lang=en&theme=light`)).text();
    expect(light).toContain('<html lang="en" dir="ltr" data-theme="light">');
  });

  it('leaves any other ?theme= out of the page, never written (T105)', async () => {
    version = '2026-10';
    const odd = ['"><script>alert(1)</script>', 'blue', 'system', 'DARK', ''];
    for (const theme of odd) {
      const response = await fetch(`${origin}/terms?theme=${encodeURIComponent(theme)}`);
      expect(response.status).toBe(200);
      const page = await response.text();
      expect(page).toContain('<html lang="ar" dir="rtl">');
      expect(page).not.toContain('data-theme');
      expect(page).not.toContain('<script');
      expect(page).not.toContain('blue');
    }
    const none = await (await fetch(`${origin}/terms`)).text();
    expect(none).not.toContain('data-theme');
  });

  it('draws the body on its own surface with the gutter, the muted lines in tone-muted (T105)', async () => {
    version = '2026-10';
    for (const query of ['', '?lang=en']) {
      const page = await (await fetch(`${origin}/terms${query}`)).text();
      expect(page).toContain('<main class="web-surface gutter">');
      expect(page).not.toContain('class="page"');
      expect(page).not.toContain('class="muted"');
      expect(page.match(/class="tone-muted"/g)?.length).toBe(2);
    }
  });

  it('uses only classes the served components.css defines, in both languages (T105)', async () => {
    version = '2026-10';
    const components = designAssets().find((asset) => asset.name === 'components.css');
    const rules = (components?.body ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    const defined = new Set([...rules.matchAll(/\.([a-z][a-z0-9_-]*)/g)].map((match) => match[1]));
    for (const query of ['?theme=dark', '?lang=en&theme=light']) {
      const page = await (await fetch(`${origin}/terms${query}`)).text();
      const used = [...page.matchAll(/class="([^"]*)"/g)].flatMap((match) =>
        (match[1] ?? '').split(/\s+/).filter(Boolean),
      );
      expect(used.length).toBeGreaterThan(0);
      expect(used.filter((name) => !defined.has(name))).toEqual([]);
    }
  });

  it('answers the error page, not the page, when the version is not stored (FR-034)', async () => {
    version = null;
    const response = await fetch(`${origin}/terms`);
    expect(response.status).toBe(500);
    const page = await response.text();
    expect(page).not.toContain('terms_version');
    expect(page).not.toContain('<h2');
    version = '2026-10';
  });
});
