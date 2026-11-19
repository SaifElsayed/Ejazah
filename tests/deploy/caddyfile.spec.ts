// 002:T147 (W7; research R-18, SRS NFR-SEC-11; the owner's Q-T1 (a), 2026-11-19): the
// administrator panel's host is a committed Caddy site block, `deploy/Caddyfile`, serving the
// panel's build as static files with the browser security headers and a closed Content Security
// Policy. The panel's session token sits in `sessionStorage`, so a script injected into the page
// could read it: the policy runs only the panel's own scripts, and no other site may frame it.
//
// The file is read, never run: no Caddy binary is installed for the suite. The deploy days check
// the same file with `caddy validate` and the served headers with `curl -I` (docs/RUNBOOK.md,
// «Hosted deploy»). Only the panel's site block is read, its comments set aside.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const caddyfile = readFileSync(resolve(repositoryRoot, 'deploy/Caddyfile'), 'utf8');

/** The file's lines with comments and surrounding blanks removed, empty lines dropped. */
function significantLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '').trim())
    .filter((line) => line !== '');
}

/** The lines inside the block that `opener` opens, up to its own closing brace. */
function blockAfter(lines: readonly string[], opener: string): string[] {
  const start = lines.indexOf(opener);
  if (start === -1) return [];
  const inside: string[] = [];
  let depth = 1;
  for (const line of lines.slice(start + 1)) {
    if (line.endsWith('{')) depth += 1;
    if (line === '}') depth -= 1;
    if (depth === 0) return inside;
    inside.push(line);
  }
  return [];
}

const site = blockAfter(significantLines(caddyfile), '{$ADMIN_SITE} {');
const headerLines = blockAfter(site, 'header {');

/** The header block's fields: name to value, quotes removed; a `-Name` removal maps to ''. */
const headers = new Map(
  headerLines.map((line) => {
    const [name = '', ...rest] = line.split(/\s+/);
    return [name, rest.join(' ').replace(/^"(.*)"$/, '$1')] as const;
  }),
);

/** The policy's directives: name to its sources. */
const policy = new Map(
  (headers.get('Content-Security-Policy') ?? '')
    .split(';')
    .map((directive) => directive.trim().split(/\s+/))
    .filter(([name]) => name !== undefined && name !== '')
    .map(([name = '', ...sources]) => [name, sources] as const),
);

describe('the administrator panel’s host, deploy/Caddyfile (T147)', () => {
  it('serves the panel’s build as static files, every unknown path the panel’s page for its router', () => {
    expect(site).toContain('root * {$ADMIN_BUILD_ROOT}');
    expect(site).toContain('try_files {path} /index.html');
    expect(site).toContain('file_server');
  });

  it('sends the browser security headers and drops the Server header', () => {
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.has('-Server')).toBe(true);
  });

  it('sends a policy that allows only what the panel loads, the origins as environment placeholders', () => {
    expect(Object.fromEntries(policy)).toEqual({
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'"],
      'img-src': ["'self'", '{$STORAGE_ORIGIN}'],
      'font-src': ["'self'"],
      'connect-src': ["'self'", '{$API_ORIGIN}', '{$STORAGE_ORIGIN}'],
      'worker-src': ["'self'"],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
    });
  });

  it('allows no inline code, no evaluation, no wildcard and no origin written into the file', () => {
    const sources = [...policy.values()].flat();
    expect(sources).not.toContain("'unsafe-inline'");
    expect(sources).not.toContain("'unsafe-eval'");
    expect(sources.filter((source) => source.includes('*'))).toEqual([]);
    expect(caddyfile).not.toMatch(/'unsafe-(inline|eval|hashes)'/);
    expect(caddyfile).not.toMatch(/https?:\/\//);
  });
});
