// T083 (B16 check, decision 7): the pages' copy, generated from the phone catalogue, and the one
// way a value enters a line of it, through the escaping template.
import { describe, expect, it } from 'vitest';

import { copyOf, fill } from './copy.js';
import { html } from './html.js';

describe('the pages’ copy', () => {
  it('is the phone catalogue’s, in the request’s language', () => {
    expect(copyOf('ar').web.deleteAccount.brandName).toBe('إجازة');
    expect(copyOf('en').web.deleteAccount.brandName).toBe('Ijazah');
    expect(copyOf('ar').web.deleteAccount.title).toBe('حذف حسابك في إجازة');
    expect(copyOf('en').web.deleteAccount.honest.info).toContain('cannot be restored');
  });
});

describe('fill', () => {
  it('writes each value where its placeholder stands, escaped', () => {
    const line = fill('Sent to {email}. Write to {supportEmail}.', {
      email: '<b>a@example.com</b>',
      supportEmail: 'support@ijazah.invalid',
    });
    expect(line.toString()).toBe(
      'Sent to &lt;b&gt;a@example.com&lt;/b&gt;. Write to support@ijazah.invalid.',
    );
  });

  it('inserts a value the template built as markup, and escapes the line’s own text', () => {
    const line = fill('A & B to {email}', {
      email: html`<span class="ltr">${'x@example.com'}</span>`,
    });
    expect(line.toString()).toBe('A &amp; B to <span class="ltr">x@example.com</span>');
  });

  it('refuses a placeholder no value is given for, so a line never shows its braces', () => {
    expect(() => fill('Sent to {email}', {})).toThrow(/email/);
  });
});
