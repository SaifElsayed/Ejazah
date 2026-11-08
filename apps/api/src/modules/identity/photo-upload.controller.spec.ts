// T024 — `POST /uploads/photos` (public-pages.md "The uploads route"; decision 46): behind the user
// bearer, a JPEG or PNG is stored through the storage port under a minted key, `users.photo_key`
// is written through the identity module's own repository (R-API-6), the previous photo is removed
// from storage, and the answer is a signed link. Over real HTTP with the in-memory storage stand-in
// and a recorded users writer.
//
// T145: the photo is stored without its metadata. The fixtures are built here with `sharp` (EXIF
// is written onto the INPUT only) or by hand (a PNG's text chunks, a forged header), never
// committed as binary files.
//
// T073: at most one photo is processed at a time, and `sharp`'s cache is off. `sharp` is wrapped
// here so the spec reads, apart from the route, how many of the route's decodes run together: the
// route's decode is the one pipeline built with `limitInputPixels`, and its `toBuffer` is counted
// while it runs, after a pause the spec sets so that uploads sent together would overlap without
// the turns. The order and the release on each path are `photo-turns.spec.ts`'s.
import { setTimeout as sleep } from 'node:timers/promises';
import { crc32, deflateSync } from 'node:zlib';
import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApplication } from '../../app.module.js';
import { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import {
  PHOTO_MAX_INPUT_PIXELS,
  PHOTO_TURN_WAIT_MS,
  PHOTOS_PROCESSED_AT_ONCE,
} from '../../platform/guards/upload.middleware.js';
import { createLogger } from '../../platform/logging/logger.js';
import { SettingError, type SettingsReader } from '../../platform/settings/settings-reader.js';
import type { UserSession } from '../../surfaces/context.js';
import { multipart, pdfBytes, storageStub } from '../../surfaces/upload-fixtures.js';
import { PHOTOS_UPLOAD_PATH, photoUploadRoute } from './photo-upload.controller.js';
import { PhotoTurns } from './photo-turns.js';
import {
  unusedAdminServices,
  unusedBookingServices,
  unusedCatalogServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';

/** The route's decodes: how many run now, the most that ran together, and how many ever began. */
const decodes = vi.hoisted(() => ({ running: 0, most: 0, began: 0, pauseMs: 0 }));

vi.mock('sharp', async (importOriginal) => {
  const real = (await importOriginal<typeof import('sharp')>()).default;
  const counted = (...args: Parameters<typeof real>) => {
    const instance = real(...args);
    const [, options] = args;
    if (typeof options === 'object' && options !== null && 'limitInputPixels' in options) {
      const toBuffer = instance.toBuffer.bind(instance) as () => Promise<Buffer>;
      Object.assign(instance, {
        toBuffer: async () => {
          decodes.running += 1;
          decodes.began += 1;
          decodes.most = Math.max(decodes.most, decodes.running);
          try {
            await new Promise((resolve) => setTimeout(resolve, decodes.pauseMs));
            return await toBuffer();
          } finally {
            decodes.running -= 1;
          }
        },
      });
    }
    return instance;
  };
  return { default: Object.assign(counted, real) };
});

const settings: SettingsReader = {
  read: async (key, schema) => {
    if (key === 'upload_max_bytes') return schema.parse(65_536);
    if (key === 'rate_limit_upload') return schema.parse({ limit: 100, window_seconds: 60 });
    if (key === 'document_link_ttl_seconds') return schema.parse(300);
    throw new SettingError(key, 'missing');
  },
};
const rateLimiter = new RateLimiter({
  settings,
  counter: { hit: async () => 1 },
  subjectKey: Buffer.alloc(32, 4),
});
function session(userId: string, accountStatus: UserSession['accountStatus']): UserSession {
  return {
    userId,
    sessionId: `s-${userId}`,
    role: 'student',
    gender: 'male',
    preferredLanguage: 'ar',
    accountStatus,
  };
}
const sessionsByBearer: Readonly<Record<string, UserSession>> = {
  't-a': session('0199d0a0-0000-7000-8000-00000000000a', 'active'),
  't-s': session('0199d0a0-0000-7000-8000-00000000000c', 'suspended'),
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
};
const log = createLogger({ level: 'info', destination: { write: () => undefined } });
const storage = storageStub();

const photoKeys = new Map<string, string>();
const users = {
  replacePhotoKey: async (userId: string, key: string) => {
    const previous = photoKeys.get(userId) ?? null;
    photoKeys.set(userId, key);
    return previous;
  },
};

let application: INestApplication;
let origin: string;

/** The application with the photos route over `turns`, or over the route's own when none is given. */
async function start(
  turns?: PhotoTurns,
): Promise<{ application: INestApplication; origin: string }> {
  const started = await createApplication({
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
      [PHOTOS_UPLOAD_PATH]: photoUploadRoute({
        sessions: sessions.user,
        guard: { settings, rateLimiter },
        log,
        storage,
        settings,
        users,
        ...(turns === undefined ? {} : { turns }),
      }),
    },
  });
  await started.listen(0, '127.0.0.1');
  return {
    application: started,
    origin: (await started.getUrl()).replace('[::1]', '127.0.0.1'),
  };
}

beforeAll(async () => {
  ({ application, origin } = await start());
});

afterAll(async () => {
  await application.close();
});

beforeEach(() => {
  photoKeys.clear();
});

const WIDTH = 40;
const HEIGHT = 20;
const RED = [220, 20, 20] as const;
const BLUE = [20, 20, 220] as const;

/** A 40×20 picture whose left half is red and right half blue, as raw RGB. */
function halves(): Buffer {
  const raw = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) raw.set(x < WIDTH / 2 ? RED : BLUE, (y * WIDTH + x) * 3);
  }
  return raw;
}
const picture = () => sharp(halves(), { raw: { width: WIDTH, height: HEIGHT, channels: 3 } });

const jpeg = () => picture().jpeg().toBuffer();
const png = () => picture().png().toBuffer();

/** A JPEG carrying the camera's make and model and a GPS position. */
const jpegWithExif = () =>
  picture()
    .jpeg()
    .withExif({
      IFD0: { Make: 'SecretCam', Model: 'SecretModel' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '30/1 2/1 0/1', GPSMapDatum: 'SecretDatum' },
    })
    .toBuffer();

/** A JPEG stored sideways whose EXIF says to turn it a quarter clockwise (Orientation 6). */
const jpegTurned = () => picture().jpeg().withMetadata({ orientation: 6 }).toBuffer();

/** One PNG chunk: length, type, data, and the CRC of type and data. */
function pngChunk(type: string, data: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

const TEXT_CHUNKS = ['tEXt', 'iTXt', 'zTXt', 'eXIf'];

/** A PNG with a tEXt, an iTXt, a zTXt and an eXIf chunk before its IEND. */
async function pngWithText(): Promise<Buffer> {
  const plain = await png();
  const { exif } = await sharp(await jpegWithExif()).metadata();
  return Buffer.concat([
    plain.subarray(0, plain.byteLength - 12),
    pngChunk('tEXt', Buffer.from('Author\0SecretAuthor', 'latin1')),
    pngChunk('iTXt', Buffer.from('Comment\0\0\0\0\0SecretComment', 'utf8')),
    pngChunk(
      'zTXt',
      Buffer.concat([Buffer.from('Location\0\0', 'latin1'), deflateSync('SecretPlace')]),
    ),
    // The eXIf chunk holds the TIFF structure without the JPEG APP1 segment's `Exif\0\0`.
    pngChunk('eXIf', (exif ?? Buffer.alloc(0)).subarray(6)),
    plain.subarray(plain.byteLength - 12),
  ]);
}

/** The chunk types of a PNG, in order. */
function pngChunkTypes(bytes: Uint8Array): string[] {
  const buffer = Buffer.from(bytes);
  const types: string[] = [];
  for (let offset = 8; offset + 8 <= buffer.byteLength;) {
    const length = buffer.readUInt32BE(offset);
    types.push(buffer.toString('latin1', offset + 4, offset + 8));
    offset += 12 + length;
  }
  return types;
}

/** A real PNG whose header claims one row more than the bound allows: a decompression bomb's shape. */
async function pngOverTheBound(): Promise<Buffer> {
  const forged = Buffer.from(await png());
  const width = 8192;
  const height = Math.floor(PHOTO_MAX_INPUT_PIXELS / width) + 1;
  forged.writeUInt32BE(width, 16);
  forged.writeUInt32BE(height, 20);
  forged.writeUInt32BE(crc32(forged.subarray(12, 29)), 29);
  return forged;
}

/** The pixel at (x, y) of an image, as RGB. */
async function pixelAt(bytes: Uint8Array, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [...data.subarray(at, at + 3)];
}

/** Within a JPEG's loss of `expected`. */
function near(actual: readonly number[], expected: readonly number[]): boolean {
  return actual.every((value, index) => Math.abs(value - (expected[index] ?? 0)) <= 40);
}

const ACTIVE = '0199d0a0-0000-7000-8000-00000000000a';

/** What the stub holds under the user's current photo key. */
function storedPhoto(): { key: string; body: Uint8Array; contentType: string } {
  const key = photoKeys.get(ACTIVE) ?? '';
  const stored = storage.stored(key);
  if (stored === undefined) throw new Error(`nothing is stored under "${key}"`);
  return { key, ...stored };
}

function upload(
  bytes: Buffer,
  bearer = 't-a',
  filename = 'me.jpg',
  at = origin,
): Promise<Response> {
  const payload = multipart([{ name: 'file', filename, type: 'image/jpeg', bytes }]);
  return fetch(`${at}${PHOTOS_UPLOAD_PATH}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': payload.contentType },
    body: new Uint8Array(payload.body),
  });
}

describe('POST /uploads/photos (T024)', () => {
  it('stores the image, writes users.photo_key through identity, and answers a signed link', async () => {
    const response = await upload(await jpeg());
    expect(response.status).toBe(201);
    const { photoUrl } = (await response.json()) as { photoUrl: string };
    const key = photoKeys.get('0199d0a0-0000-7000-8000-00000000000a');
    expect(key).toMatch(/^photos\/[0-9a-f-]+\/[0-9a-f-]+\.jpg$/);
    expect(storage.verifyLink(photoUrl)).toBe(key);
    expect(storage.stored(key ?? '')).toMatchObject({ contentType: 'image/jpeg' });
  });

  it('replaces the previous photo, removing it from storage, and names a PNG as one', async () => {
    await upload(await jpeg());
    const first = photoKeys.get('0199d0a0-0000-7000-8000-00000000000a') ?? '';
    await upload(await png());
    const second = photoKeys.get('0199d0a0-0000-7000-8000-00000000000a') ?? '';
    expect(second).toMatch(/\.png$/);
    expect(storage.stored(first)).toBeUndefined();
    expect(storage.stored(second)).toBeDefined();
  });

  it('admits JPEG and PNG only, decided by content', async () => {
    const response = await upload(pdfBytes());
    expect(response.status).toBe(400);
    expect(photoKeys.size).toBe(0);
  });

  it('refuses a suspended account, as the profile editor does (FR-137)', async () => {
    const response = await upload(await jpeg(), 't-s');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'ACCOUNT_RESTRICTED' } });
  });
});

describe('POST /uploads/photos stores the photo without its metadata (T145)', () => {
  it('stores a JPEG carrying GPS and the camera with no EXIF at all', async () => {
    const sent = await jpegWithExif();
    // The fixture does carry what the store must not.
    expect((await sharp(sent).metadata()).exif).toBeDefined();
    expect(sent.includes('SecretCam') && sent.includes('SecretDatum')).toBe(true);

    expect((await upload(sent)).status).toBe(201);
    const { body, contentType } = storedPhoto();
    const stored = Buffer.from(body);
    const metadata = await sharp(stored).metadata();
    expect(contentType).toBe('image/jpeg');
    expect(metadata.format).toBe('jpeg');
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.iptc).toBeUndefined();
    for (const marker of ['Exif\0\0', 'SecretCam', 'SecretModel', 'SecretDatum']) {
      expect(stored.includes(marker)).toBe(false);
    }
  });

  it('stores a JPEG with Orientation 6 turned upright, with no Orientation left', async () => {
    const sent = await jpegTurned();
    expect(await sharp(sent).metadata()).toMatchObject({
      width: WIDTH,
      height: HEIGHT,
      orientation: 6,
    });

    expect((await upload(sent)).status).toBe(201);
    const { body } = storedPhoto();
    const metadata = await sharp(body).metadata();
    expect(metadata).toMatchObject({ width: HEIGHT, height: WIDTH });
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    // Turned a quarter clockwise: the left half (red) is now the top, the right (blue) the bottom.
    expect(near(await pixelAt(body, HEIGHT / 2, 2), RED)).toBe(true);
    expect(near(await pixelAt(body, HEIGHT / 2, WIDTH - 3), BLUE)).toBe(true);
  });

  it('stores a PNG without its text chunks and its EXIF chunk, still a PNG', async () => {
    const sent = await pngWithText();
    expect(pngChunkTypes(sent)).toEqual(expect.arrayContaining(TEXT_CHUNKS));

    const response = await upload(sent, 't-a', 'me.png');
    expect(response.status).toBe(201);
    const { key, body, contentType } = storedPhoto();
    expect(key).toMatch(/\.png$/);
    expect(contentType).toBe('image/png');
    expect((await sharp(body).metadata()).format).toBe('png');
    expect(pngChunkTypes(body).filter((type) => TEXT_CHUNKS.includes(type))).toEqual([]);
    const stored = Buffer.from(body);
    for (const marker of ['SecretAuthor', 'SecretComment', 'SecretCam']) {
      expect(stored.includes(marker)).toBe(false);
    }
    expect(near(await pixelAt(body, 2, 2), RED)).toBe(true);
  });

  it('refuses a file named .jpg that is not an image, storing nothing and keeping the photo', async () => {
    await upload(await jpeg());
    const previous = storedPhoto().key;
    const puts = () => storage.calls.filter(({ operation }) => operation === 'put').length;
    const before = puts();

    const text = await upload(Buffer.from('not an image, only a name ending in .jpg'));
    expect(text.status).toBe(400);
    await expect(text.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    // A JPEG's leading bytes pass the sniffing; what follows them is not a JPEG.
    const pretender = await upload(
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256, 1)]),
    );
    expect(pretender.status).toBe(400);
    await expect(pretender.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_FAILED', message: 'The image cannot be read.' },
    });

    expect(puts()).toBe(before);
    expect(photoKeys.get(ACTIVE)).toBe(previous);
    expect(storage.stored(previous)).toBeDefined();
  });

  it('refuses an image with more pixels than the bound, storing nothing', async () => {
    const puts = () => storage.calls.filter(({ operation }) => operation === 'put').length;
    const before = puts();
    const forged = await pngOverTheBound();
    const { width = 0, height = 0 } = await sharp(forged).metadata();
    expect(width * height).toBeGreaterThan(PHOTO_MAX_INPUT_PIXELS);

    const response = await upload(forged, 't-a', 'me.png');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_FAILED', message: 'The image has more pixels than allowed.' },
    });
    expect(puts()).toBe(before);
    expect(photoKeys.size).toBe(0);
  });
});

describe('POST /uploads/photos processes one photo at a time (T073)', () => {
  const PAUSE_MS = 250;
  const SHORT_WAIT_MS = 40;
  let timed: { application: INestApplication; origin: string };

  beforeAll(async () => {
    // Turns whose wait is far shorter than one decode, so the second of two uploads times out.
    timed = await start(
      new PhotoTurns({ atOnce: PHOTOS_PROCESSED_AT_ONCE, waitMs: SHORT_WAIT_MS }),
    );
  });

  afterAll(async () => {
    decodes.pauseMs = 0;
    await timed.application.close();
  });

  beforeEach(() => {
    Object.assign(decodes, { running: 0, most: 0, began: 0, pauseMs: PAUSE_MS });
  });

  it("is one at once in a process, with a set wait (the owner's decision of 2026-11-02)", () => {
    expect(PHOTOS_PROCESSED_AT_ONCE).toBe(1);
    expect(PHOTO_TURN_WAIT_MS).toBeGreaterThan(0);
  });

  it("turns off sharp's cache", () => {
    expect(sharp.cache()).toMatchObject({
      memory: { max: 0 },
      files: { max: 0 },
      items: { max: 0 },
    });
  });

  it('never decodes more than one photo together when several are uploaded at once', async () => {
    const photos = await Promise.all([jpeg(), png(), jpegTurned(), jpeg(), png()]);
    const responses = await Promise.all(
      photos.map((photo, index) => upload(photo, 't-a', index % 2 === 1 ? 'me.png' : 'me.jpg')),
    );
    expect(responses.map(({ status }) => status)).toEqual([201, 201, 201, 201, 201]);
    expect(decodes.began).toBe(photos.length);
    expect(decodes.most).toBe(1);
  });

  it('refuses one that waits past the set time with RATE_LIMITED, storing nothing, and never decodes it', async () => {
    const puts = () => storage.calls.filter(({ operation }) => operation === 'put').length;
    const before = puts();
    const [first, second] = await Promise.all([jpeg(), jpeg()]);
    const responses = await Promise.all([
      upload(first, 't-a', 'me.jpg', timed.origin),
      upload(second, 't-a', 'me.jpg', timed.origin),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 429]);
    const refused = responses.find(({ status }) => status === 429);
    await expect(refused?.json()).resolves.toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(puts()).toBe(before + 1);

    // The refused one never takes the turn later.
    await sleep(PAUSE_MS * 2);
    expect(decodes.began).toBe(1);
  });

  it('gives the turn back after a refusal and an unreadable file, so the next is not kept waiting', async () => {
    const refused = await upload(await pngOverTheBound(), 't-a', 'me.png', timed.origin);
    expect(refused.status).toBe(400);
    const unreadable = await upload(
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256, 1)]),
      't-a',
      'me.jpg',
      timed.origin,
    );
    expect(unreadable.status).toBe(400);
    expect((await upload(await jpeg(), 't-a', 'me.jpg', timed.origin)).status).toBe(201);
  });
});
