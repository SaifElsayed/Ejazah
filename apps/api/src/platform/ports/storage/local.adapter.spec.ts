// T116: what the local implementation adds to the contract of T115 — where its files land, the
// link verifier the serving route will call, and the key that signs links.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addSeconds } from '@ijazah/time';
import { afterAll, describe, expect, it } from 'vitest';
import { deriveLinkKey, LocalStorageAdapter } from './local.adapter.js';

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
const ISSUED = new Date('2026-10-07T10:00:00Z');

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function store(encryptionKey = ENCRYPTION_KEY): { storage: LocalStorageAdapter; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'ijazah-local-'));
  roots.push(root);
  const storage = new LocalStorageAdapter({
    root,
    linkKey: deriveLinkKey(encryptionKey),
    now: () => ISSUED,
  });
  return { storage, root };
}

describe('the local storage (T116, FR-055)', () => {
  it('keeps each object and its content type under the configured root', async () => {
    const { storage, root } = store();
    await storage.put('documents/u1/id.png', new Uint8Array([1, 2, 3]), 'image/png');

    expect(existsSync(join(root, 'objects', 'documents', 'u1', 'id.png'))).toBe(true);
    expect(await storage.read('documents/u1/id.png')).toEqual({
      body: Buffer.from([1, 2, 3]),
      contentType: 'image/png',
    });
  });

  it('replaces an object put twice under one key', async () => {
    const { storage } = store();
    await storage.put('a.txt', new TextEncoder().encode('one'), 'text/plain');
    await storage.put('a.txt', new TextEncoder().encode('two'), 'text/markdown');

    expect(await storage.read('a.txt')).toEqual({
      body: Buffer.from('two'),
      contentType: 'text/markdown',
    });
  });

  it('removes an absent key without error', async () => {
    const { storage } = store();
    await expect(storage.remove('never/stored.pdf')).resolves.toBeUndefined();
  });

  it('a link is relative and verifies to the key it was issued for', async () => {
    const { storage } = store();
    const link = await storage.temporaryLink('certificates/c-1.pdf', 60);

    expect(link.startsWith('/files/certificates/c-1.pdf?')).toBe(true);
    expect(storage.verifyLink(link)).toBe('certificates/c-1.pdf');
  });

  it('refuses a link whose key, expiry or signature was changed', async () => {
    const { storage } = store();
    const link = await storage.temporaryLink('documents/a.pdf', 60);
    const url = new URL(link, 'http://link.invalid');
    const later = addSeconds(ISSUED, 3600);

    const otherKey = link.replace('documents/a.pdf', 'documents/b.pdf');
    const longer = `${url.pathname}?${new URLSearchParams({
      expires: later,
      signature: url.searchParams.get('signature') ?? '',
    }).toString()}`;
    const forged = `${url.pathname}?${new URLSearchParams({
      expires: url.searchParams.get('expires') ?? '',
      signature: 'A'.repeat(43),
    }).toString()}`;
    const unsigned = `${url.pathname}?expires=${url.searchParams.get('expires') ?? ''}`;

    expect(storage.verifyLink(otherKey)).toBeUndefined();
    expect(storage.verifyLink(longer)).toBeUndefined();
    expect(storage.verifyLink(forged)).toBeUndefined();
    expect(storage.verifyLink(unsigned)).toBeUndefined();
  });

  it('refuses a link signed under another ENCRYPTION_KEY', async () => {
    const link = await store(OTHER_KEY).storage.temporaryLink('documents/a.pdf', 60);
    expect(store().storage.verifyLink(link)).toBeUndefined();
  });

  it.each([
    'not a link',
    'http://elsewhere.example/files/documents/a.pdf',
    '/other/documents/a.pdf',
    '/files/..%2f..%2fetc/passwd',
    '/files/%2e%2e/%2e%2e/etc/passwd',
    '/files/%E0%A4%A',
  ])('refuses %j, whatever it carries', async (candidate) => {
    const { storage } = store();
    const link = await storage.temporaryLink('documents/a.pdf', 60);
    const query = link.slice(link.indexOf('?'));
    expect(storage.verifyLink(candidate)).toBeUndefined();
    expect(storage.verifyLink(`${candidate}${query}`)).toBeUndefined();
  });

  it('signs with a key derived for links alone: 32 bytes, unlike the encryption key', () => {
    const linkKey = deriveLinkKey(ENCRYPTION_KEY);

    expect(linkKey).toHaveLength(32);
    expect(linkKey.equals(Buffer.from(ENCRYPTION_KEY, 'base64'))).toBe(false);
    expect(linkKey.equals(deriveLinkKey(ENCRYPTION_KEY))).toBe(true);
    expect(linkKey.equals(deriveLinkKey(OTHER_KEY))).toBe(false);
  });
});
