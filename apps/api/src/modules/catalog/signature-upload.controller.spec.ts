// T003 of specs/005-certification — `POST /uploads/signature` over real HTTP (FR-601, SRS
// FR-IJAZAH-12; research R-411; R-SEC-3, R-SEC-4; contracts/app-surface.md): behind the user bearer
// of a teacher the kind admits as approved (R-106; a student and an applicant FORBIDDEN, a suspended
// or banned teacher ACCOUNT_RESTRICTED), one PNG or JPEG decided by its content through the kernel's
// guard, the kind `signature`. A renamed file is refused by its bytes, whatever its name and its
// declared type, and nothing is stored. The admitted file is handed to catalog's signature service
// with the uploader's own id and its sniffed type; the answer is `{ uploadedAt }`, never a key. Each
// refusal writes one line of ids and a code. The service's replace path is
// teacher-signature.service.spec.ts's.
//
// The owner's Q16 (b): the file is handed on without its metadata, through the photo's own strip
// (T145, identity's `imageWithoutMetadata`) in a turn of the `PhotoTurns` the route is given: a
// JPEG carrying GPS leaves with no EXIF, a PNG stays a PNG and a JPEG a JPEG, and a header declaring
// more than `PHOTO_MAX_INPUT_PIXELS` is refused before anything is stored. The fixtures are built
// here with `sharp`, the EXIF written onto the input only, or by hand (a forged header).
import { crc32 } from 'node:zlib';
import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../../app.module.js';
import { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import {
  PHOTO_MAX_INPUT_PIXELS,
  PHOTO_TURN_WAIT_MS,
  PHOTOS_PROCESSED_AT_ONCE,
  UPLOAD_RATE_LIMIT,
} from '../../platform/guards/upload.middleware.js';
import { createLogger } from '../../platform/logging/logger.js';
import { SettingError, type SettingsReader } from '../../platform/settings/settings-reader.js';
import type { UserSession } from '../../surfaces/context.js';
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
} from '../../surfaces/services.fixtures.js';
import { multipart, pdfBytes } from '../../surfaces/upload-fixtures.js';
import { PhotoTurns } from '../identity/index.js';
import {
  createSignatureUploadRoute,
  SIGNATURE_UPLOAD_PATH,
} from './signature-upload.controller.js';

// A real 1×1 PNG, and a real JPEG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
/** An 8×8 picture, ink on paper. */
const picture = () =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 20, b: 90 } } });
const JPEG = await picture().jpeg().toBuffer();
/** A JPEG carrying the camera and a GPS position, as a phone's photo of a signature would. */
const JPEG_WITH_GPS = await picture()
  .jpeg()
  .withExif({
    IFD0: { Make: 'SecretCam', Model: 'SecretModel' },
    IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '30/1 2/1 0/1', GPSMapDatum: 'SecretDatum' },
  })
  .toBuffer();

/** A real PNG whose header claims one row more than the bound allows: a decompression bomb's shape. */
async function pngOverTheBound(): Promise<Buffer> {
  const forged = Buffer.from(await picture().png().toBuffer());
  const width = 8192;
  const height = Math.floor(PHOTO_MAX_INPUT_PIXELS / width) + 1;
  forged.writeUInt32BE(width, 16);
  forged.writeUInt32BE(height, 20);
  forged.writeUInt32BE(crc32(forged.subarray(12, 29)), 29);
  return forged;
}
const UPLOADED_AT = '2026-11-17T09:30:00.000Z';

const settings: SettingsReader = {
  read: async (key, schema) => {
    if (key === 'upload_max_bytes') return schema.parse(65_536);
    if (key === UPLOAD_RATE_LIMIT) return schema.parse({ limit: 100, window_seconds: 60 });
    throw new SettingError(key, 'missing');
  },
};
const rateLimiter = new RateLimiter({
  settings,
  counter: { hit: async () => 1 },
  subjectKey: Buffer.alloc(32, 6),
});

const TEACHER = '0199d0a0-0000-7000-8000-0000000005a1';

function sessionOf(
  userId: string,
  standing: 'student' | 'applicant' | 'approved' | 'publishable',
  accountStatus: UserSession['accountStatus'] = 'active',
): UserSession {
  const base = {
    userId,
    sessionId: `s-${userId}`,
    gender: 'male' as const,
    preferredLanguage: 'ar' as const,
    accountStatus,
  };
  if (standing === 'student') return { ...base, role: 'student' };
  const approved = standing !== 'applicant';
  return {
    ...base,
    role: 'teacher',
    teacher: {
      verificationStatus: approved ? 'approved' : 'pending',
      payoutVerified: standing === 'publishable',
      applicationStatus: approved ? 'approved' : 'in_review',
    },
  };
}
const sessionsByBearer: Readonly<Record<string, UserSession>> = {
  't-approved': sessionOf(TEACHER, 'approved'),
  't-publishable': sessionOf('0199d0a0-0000-7000-8000-0000000005a2', 'publishable'),
  't-applicant': sessionOf('0199d0a0-0000-7000-8000-0000000005a3', 'applicant'),
  't-student': sessionOf('0199d0a0-0000-7000-8000-0000000005a4', 'student'),
  't-suspended': sessionOf('0199d0a0-0000-7000-8000-0000000005a5', 'approved', 'suspended'),
  't-banned': sessionOf('0199d0a0-0000-7000-8000-0000000005a6', 'approved', 'banned'),
};
const sessions = {
  user: async (bearer: string) => sessionsByBearer[bearer] ?? null,
  admin: async () => null,
};
const administration = {
  transactions: { run: () => Promise.reject(new Error('no administrative call is expected here')) },
  auditWriter: {
    write: () => Promise.reject(new Error('no administrative call is expected here')),
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
  certification: unusedCertificationServices,
  moderation: unusedModerationServices,
};
const records: string[] = [];
const log = createLogger({ level: 'info', destination: { write: (line) => records.push(line) } });

/** What the route handed catalog's service, in order. */
let replaced: { userId: string; type: string; bytes: Buffer }[] = [];
const signatures = {
  replace: async (userId: string, file: { readonly type: string; readonly bytes: Uint8Array }) => {
    replaced.push({ userId, type: file.type, bytes: Buffer.from(file.bytes) });
    return { uploadedAt: UPLOADED_AT };
  },
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
    routes: {
      [SIGNATURE_UPLOAD_PATH]: createSignatureUploadRoute({
        sessions: sessions.user,
        guard: { settings, rateLimiter },
        log,
        signatures,
        turns: new PhotoTurns({ atOnce: PHOTOS_PROCESSED_AT_ONCE, waitMs: PHOTO_TURN_WAIT_MS }),
      }),
    },
  });
  await application.listen(0, '127.0.0.1');
  origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await application.close();
});

beforeEach(() => {
  replaced = [];
  records.length = 0;
});

/** One file named `filename`, declared `type`, holding `bytes`. */
function upload(bearer: string, filename: string, type: string, bytes: Buffer): Promise<Response> {
  const { body, contentType } = multipart([{ name: 'file', filename, type, bytes }]);
  return fetch(`${origin}${SIGNATURE_UPLOAD_PATH}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': contentType },
    body: new Uint8Array(body),
  });
}

/** The logged lines that name `message`, parsed. */
function logged(message: string): Record<string, unknown>[] {
  return records
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line['msg'] === message);
}

describe('POST /uploads/signature (T003 of specs/005-certification)', () => {
  it('is served at /uploads/signature', () => {
    expect(SIGNATURE_UPLOAD_PATH).toBe('/uploads/signature');
  });

  it('hands an approved teacher’s PNG and JPEG to the service, typed by content, and answers { uploadedAt } alone', async () => {
    const png = await upload('t-approved', 'signature.png', 'image/png', PNG);
    expect(png.status).toBe(201);
    await expect(png.json()).resolves.toStrictEqual({ uploadedAt: UPLOADED_AT });
    // The declared type is not read: a JPEG declared a PNG is a JPEG.
    const jpeg = await upload('t-publishable', 'signature.png', 'image/png', JPEG);
    expect(jpeg.status).toBe(201);
    expect(replaced.map(({ userId, type }) => ({ userId, type }))).toEqual([
      { userId: TEACHER, type: 'image/png' },
      { userId: '0199d0a0-0000-7000-8000-0000000005a2', type: 'image/jpeg' },
    ]);
  });

  // The owner's Q16 (b): T145's strip, reused.
  it('hands on a JPEG carrying GPS with no EXIF at all', async () => {
    expect((await sharp(JPEG_WITH_GPS).metadata()).exif).toBeDefined();
    expect(JPEG_WITH_GPS.includes('SecretDatum')).toBe(true);
    const response = await upload('t-approved', 'signature.jpg', 'image/jpeg', JPEG_WITH_GPS);
    expect(response.status).toBe(201);
    expect(replaced).toHaveLength(1);
    const stored = replaced[0]?.bytes ?? Buffer.alloc(0);
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    for (const marker of ['Exif\0\0', 'SecretCam', 'SecretModel', 'SecretDatum']) {
      expect(stored.includes(marker), marker).toBe(false);
    }
  });

  it('keeps a PNG a PNG and a JPEG a JPEG', async () => {
    await upload('t-approved', 'signature.png', 'image/png', PNG);
    await upload('t-approved', 'signature.jpg', 'image/jpeg', JPEG_WITH_GPS);
    expect(replaced.map(({ type }) => type)).toEqual(['image/png', 'image/jpeg']);
    const formats = await Promise.all(
      replaced.map(async ({ bytes }) => (await sharp(bytes).metadata()).format),
    );
    expect(formats).toEqual(['png', 'jpeg']);
  });

  it('refuses a signature declaring more pixels than PHOTO_MAX_INPUT_PIXELS, VALIDATION_FAILED, nothing stored', async () => {
    const forged = await pngOverTheBound();
    const { width = 0, height = 0 } = await sharp(forged).metadata();
    expect(width * height).toBeGreaterThan(PHOTO_MAX_INPUT_PIXELS);
    const response = await upload('t-approved', 'signature.png', 'image/png', forged);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_FAILED', message: 'The image has more pixels than allowed.' },
    });
    expect(replaced).toEqual([]);
  });

  it('refuses a PDF named signature.png and declared image/png, VALIDATION_FAILED, nothing stored (R-SEC-4)', async () => {
    const response = await upload('t-approved', 'signature.png', 'image/png', pdfBytes());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(replaced).toEqual([]);
  });

  it('refuses text named signature.png and declared image/png, VALIDATION_FAILED, nothing stored (R-SEC-4)', async () => {
    const text = Buffer.from('توقيع\n', 'utf8');
    const response = await upload('t-approved', 'signature.png', 'image/png', text);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(replaced).toEqual([]);
  });

  it('refuses an applicant FORBIDDEN, nothing stored (R-106)', async () => {
    const response = await upload('t-applicant', 'signature.png', 'image/png', PNG);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(replaced).toEqual([]);
  });

  it('refuses a student FORBIDDEN, nothing stored', async () => {
    const response = await upload('t-student', 'signature.png', 'image/png', PNG);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(replaced).toEqual([]);
  });

  it('refuses a suspended or a banned teacher ACCOUNT_RESTRICTED, nothing stored', async () => {
    for (const [bearer, status] of [
      ['t-suspended', 'suspended'],
      ['t-banned', 'banned'],
    ] as const) {
      const response = await upload(bearer, 'signature.png', 'image/png', PNG);
      expect(response.status, bearer).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'ACCOUNT_RESTRICTED', details: [{ path: 'accountStatus', code: status }] },
      });
    }
    expect(replaced).toEqual([]);
  });

  it('logs a refused file by the uploader’s id and the code only, never its name', async () => {
    await upload('t-approved', 'secret-name.png', 'image/png', pdfBytes());
    const lines = logged('A signature upload was refused');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ userId: TEACHER, errorCode: 'VALIDATION_FAILED' });
    expect(records.join('\n')).not.toContain('secret-name');
  });
});
