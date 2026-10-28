// T019 — every interpolation is escaped; only `raw()` inserts markup (FR-144, ADR 0021 D5,
// research R-111). T105: a page given a scheme names it on `<html>`; one given none is unchanged.
import { describe, expect, it } from 'vitest';
import { escapeHtml, html, raw, SafeHtml } from './html.js';
import { directionOf, renderPage } from './page.js';

const hostile = `<script>alert('x')</script><img src=x onerror="alert(1)">&amp;`;

// Prettier reflows the text of a template tagged `html`; the cases that compare exact strings tag
// through this alias, so their spacing is the case's own and the same function is under test.
const tag = html;

describe('the escaping template (T019)', () => {
  it('writes every interpolated value as text: the five markup characters become references', () => {
    const page = html`<p title="${hostile}">${hostile}</p>`.toString();
    expect(page).not.toContain('<script');
    expect(page).not.toContain('onerror="');
    expect(page).toContain('&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;');
    expect(page).toContain('&amp;amp;');
    // Inside the quoted attribute the quote is a reference, so the value cannot close it.
    expect(page).toMatch(/title="[^"]*"/);
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('inserts a nested template and a `raw()` string as they are, and nothing else unescaped', () => {
    const inner = tag`<em>${'a < b'}</em>`;
    const page = tag`<p>${inner} ${raw('<strong>built by the server</strong>')}</p>`.toString();
    expect(page).toBe('<p><em>a &lt; b</em> <strong>built by the server</strong></p>');
    // A string that merely looks like markup is text; only `raw()` makes markup.
    expect(tag`${'<strong>'}`.toString()).toBe('&lt;strong&gt;');
  });

  it('writes a list in order, nothing for null or undefined, and the text of a number or boolean', () => {
    const items = ['a', '<b>', 'c'].map((item) => tag`<li>${item}</li>`);
    expect(tag`<ul>${items}</ul>`.toString()).toBe(
      '<ul><li>a</li><li>&lt;b&gt;</li><li>c</li></ul>',
    );
    expect(tag`[${null}${undefined}]`.toString()).toBe('[]');
    expect(tag`${7} ${true}`.toString()).toBe('7 true');
  });

  it('a SafeHtml cannot be built around the factory: `raw()` is the one way', () => {
    // @ts-expect-error -- T019: the constructor is private; `raw()` is the only public factory.
    expect(() => new SafeHtml('<b>', Symbol('forged'))).toThrow(/raw\(\)/);
    expect(raw('<b>')).toBeInstanceOf(SafeHtml);
  });
});

describe('the page layout (T019)', () => {
  it('names the language and its direction, links the two stylesheets, and carries no inline script or style', () => {
    const arabic = renderPage({ lang: 'ar', title: 'الشروط', body: html`<p>نص</p>` }).toString();
    expect(arabic).toContain('<html lang="ar" dir="rtl">');
    // The links carry the content hash, so an immutable cache never serves a stale design.
    expect(arabic).toMatch(
      /<link rel="stylesheet" href="\/public\/design\/tokens\.[0-9a-f]{16}\.css" \/>/,
    );
    expect(arabic).toMatch(
      /<link rel="stylesheet" href="\/public\/design\/components\.[0-9a-f]{16}\.css" \/>/,
    );
    expect(arabic).not.toContain('href="/public/design/tokens.css"');
    expect(arabic).toContain('<title>الشروط</title>');
    expect(arabic).not.toMatch(/<script/i);
    expect(arabic).not.toMatch(/<style/i);
    expect(arabic).not.toMatch(/ style=/i);
    expect(arabic).not.toMatch(/ on[a-z]+=/i);

    const english = renderPage({ lang: 'en', title: 'Terms', body: html`<p>text</p>` }).toString();
    expect(english).toContain('<html lang="en" dir="ltr">');
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
  });

  it('escapes the title like any value', () => {
    const page = renderPage({ lang: 'en', title: hostile, body: html`` }).toString();
    expect(page).not.toContain('<script');
    expect(page).toContain('<title>&lt;script&gt;');
  });

  it('names the scheme it is given on <html>, and only adds that attribute (T105)', () => {
    const page = { lang: 'ar', title: 'الشروط', body: html`<p>نص</p>` } as const;
    const plain = renderPage(page).toString();
    const dark = renderPage({ ...page, theme: 'dark' }).toString();
    const light = renderPage({ ...page, theme: 'light' }).toString();
    expect(dark).toContain('<html lang="ar" dir="rtl" data-theme="dark">');
    expect(light).toContain('<html lang="ar" dir="rtl" data-theme="light">');
    // No scheme, no attribute: the deletion pages and the error page are byte for byte as before.
    expect(plain).toContain('<html lang="ar" dir="rtl">');
    expect(plain).not.toContain('data-theme');
    expect(dark.replace(' data-theme="dark"', '')).toBe(plain);
    expect(light.replace(' data-theme="light"', '')).toBe(plain);
  });
});
