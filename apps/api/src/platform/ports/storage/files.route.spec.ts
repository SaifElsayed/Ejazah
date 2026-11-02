// T095: `GET /files/<key>` over real HTTP, the route that serves a local link (note under T116):
// a verified link streams its object, no-store, under a policy that runs nothing; a PDF, a JPEG
// or a PNG inline, any other declared type as an attachment of bytes; a forged, expired or unknown
// link a bare 404. It is mounted only over local storage.
//
// The application is built as main.ts builds it (`createApplication`) and listened on an ephemeral
// port, so the security headers and the CORS allowlist are the application's own.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication } from '../../../app.module.js';
import { RateLimiter } from '../../guards/rate-limit.guard.js';
import { createLogger } from '../../logging/logger.js';
import {
  unusedAdminServices,
  unusedBookingServices,
  unusedCatalogServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../../surfaces/services.fixtures.js';
import { FILES_PATH, filesRoutes } from './files.route.js';
import { deriveLinkKey, LocalStorageAdapter } from './local.adapter.js';
import { S3StorageAdapter, createS3Client } from './s3.adapter.js';

const PANEL = 'http://localhost:5173';
const PDF = new TextEncoder().encode('%PDF-1.7\n%fixture\n');

const root = mkdtempSync(join(tmpdir(), 'ijazah-files-'));
let clock = new Date('2026-10-25T10:00:00Z');
const storage = new LocalStorageAdapter({
  root,
  linkKey: deriveLinkKey(Buffer.alloc(32, 7).toString('base64')),
  now: () => clock,
});

const unused = () => Promise.reject(new Error('nothing here is expected to call it'));
let application: INestApplication;
let origin: string;

beforeAll(async () => {
  await storage.put('documents/u1/id.pdf', PDF, 'application/pdf');
  await storage.put('photos/u1/p.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png');
  await storage.put(
    'documents/u1/page.html',
    new TextEncoder().encode('<script>1</script>'),
    'text/html',
  );
  await storage.put('documents/u1/odd.bin', new Uint8Array([1]), 'not a type; x=<y>');
  application = await createApplication({
    log: createLogger({ level: 'fatal', destination: { write: () => {} } }),
    readiness: { databaseReachable: async () => {} },
    securityHeaders: { allowedOrigins: [PANEL], mode: 'test' },
    maxRequestBodyBytes: 1024,
    administration: { transactions: { run: unused }, auditWriter: { write: unused } },
    rateLimiter: new RateLimiter({
      settings: { read: unused },
      counter: { hit: unused },
      subjectKey: Buffer.alloc(32, 1),
    }),
    sessions: { user: async () => null, admin: async () => null },
    services: {
      settings: { read: unused },
      publicConfig: { supportEmail: 'support@ijazah.invalid' },
      subjects: { listActive: async () => [] },
      identity: unusedIdentityServices,
      verification: unusedVerificationServices,
      catalog: unusedCatalogServices,
      teacherProfile: unusedTeacherProfileServices,
      discovery: unusedDiscoveryServices,
      booking: unusedBookingServices,
    },
    adminServices: unusedAdminServices,
    routes: filesRoutes(storage),
  });
  await application.listen(0, '127.0.0.1');
  origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await application?.close();
  rmSync(root, { recursive: true, force: true });
});

/** The link's path and query, asked of the running application. */
async function open(key: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${origin}${await storage.temporaryLink(key, 60)}`, init);
}

describe('the files route (T095, note under T116)', () => {
  it('streams a PDF inline, no-store, under a policy that runs nothing and is framed by nobody', async () => {
    const response = await open('documents/u1/id.pdf');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe('inline');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'; sandbox",
    );
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);
  });

  it('serves an image inline too', async () => {
    const response = await open('photos/u1/p.png');

    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-disposition')).toBe('inline');
  });

  it.each(['documents/u1/page.html', 'documents/u1/odd.bin'])(
    'hands any other declared type over as an attachment of bytes (%s)',
    async (key) => {
      const response = await open(key);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/octet-stream');
      expect(response.headers.get('content-disposition')).toBe('attachment');
      expect(response.headers.get('content-security-policy')).toContain('sandbox');
    },
  );

  it('answers the panel’s origin, so its reader may fetch the file', async () => {
    const response = await open('documents/u1/id.pdf', { headers: { origin: PANEL } });

    expect(response.headers.get('access-control-allow-origin')).toBe(PANEL);
  });

  it('answers a HEAD without the body', async () => {
    const response = await open('documents/u1/id.pdf', { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  it('refuses any other method', async () => {
    const response = await open('documents/u1/id.pdf', { method: 'POST' });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });

  it('answers a bare 404 to a forged, an expired or an unknown link, saying nothing of which', async () => {
    const link = await storage.temporaryLink('documents/u1/id.pdf', 60);
    const forged = link.replace(/signature=[^&]+/, `signature=${'A'.repeat(43)}`);
    const unknown = await storage.temporaryLink('documents/u1/gone.pdf', 60);
    const refused = async (path: string) => {
      const response = await fetch(`${origin}${path}`);
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toBe('');
    };
    for (const path of [forged, unknown, '/files/documents/u1/id.pdf']) await refused(path);
    clock = new Date('2026-10-25T10:02:00Z');
    try {
      await refused(link);
    } finally {
      clock = new Date('2026-10-25T10:00:00Z');
    }
  });

  it('is mounted over local storage alone', () => {
    expect(Object.keys(filesRoutes(storage))).toEqual([FILES_PATH]);
    const remote = new S3StorageAdapter(
      createS3Client({
        endpoint: 'http://127.0.0.1:9',
        region: 'eu-central-1',
        accessKeyId: 'files-test',
        secretAccessKey: 'files-test',
      }),
      'documents',
    );
    expect(filesRoutes(remote)).toEqual({});
  });
});
