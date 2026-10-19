// T104: upload content sniffing (FR-044, R-SEC-4; research R-16; contracts/kernel.md "Guards
// applied by default"). Every upload's type is decided by its leading bytes, before the file is
// written anywhere.
//
// THE DECLARATION IS DISCARDED, NOT COMPARED (research R-16). Neither function below takes a
// filename, an extension or a declared content type, so there is no code path where a client's
// claim decides anything, not even when it happens to agree with the content. An upload whose
// bytes match no known signature has no type, and a path that accepts only known types refuses it.
//
// THE SIGNATURES are the WHATWG MIME Sniffing Standard's (https://mimesniff.spec.whatwg.org/, §6.1
// "Matching an image type pattern" and the PDF pattern of §7.1), plus two image families it does
// not list and phones produce: TIFF, and the HEIF family (HEIC, AVIF), read from the brands of an
// ISO base media file's first `ftyp` box (ISO/IEC 14496-12, 23008-12). Recognising every image a
// phone can send is what lets a path refuse images by content (R-SEC-5, chat in Phase 3).
//
// THE BODY IS STREAMED. `sniffUpload` reads only the leading bytes it needs from the stream and
// hands back a body that replays them, then the rest, unchanged, so the file is never held whole
// here.
//
// THE UPLOAD KINDS (T020, FR-151, research R-109; specs/002-identity/contracts/public-pages.md
// "The uploads route"). A route names the kind of what it takes, and the kind decides the types:
// `identity` and `credential` are PDF only, `photo` JPEG and PNG. `acceptUploadOfKind` is what the
// uploads route puts in front of storage: it counts the uploader under `rate_limit_upload` first,
// reads `upload_max_bytes` through the settings reader (FR-034: never a constant, and a missing
// setting fails closed), decides the type by content as above, and hands back a body that refuses
// the file as it streams past the limit, with the kernel's one error shape (413
// `PAYLOAD_TOO_LARGE`), so an oversized file is never held or stored whole either.
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { DomainError } from '../errors/domain-error.js';
import type { RateLimiter, RateLimitKey } from './rate-limit.guard.js';
import type { SettingsReader } from '../settings/settings-reader.js';

/** The types content sniffing can recognise. */
export type SniffedType =
  | 'application/pdf'
  | 'image/avif'
  | 'image/bmp'
  | 'image/gif'
  | 'image/heic'
  | 'image/heif'
  | 'image/jpeg'
  | 'image/png'
  | 'image/tiff'
  | 'image/webp'
  | 'image/x-icon';

/** An upload once its leading bytes are read: its type, or none, and the whole body to store. */
export interface SniffedUpload<TType extends SniffedType | undefined = SniffedType | undefined> {
  readonly type: TType;
  readonly body: AsyncIterable<Uint8Array>;
}

// Enough for every signature below, the longest being an `ftyp` box with its compatible brands.
const HEAD_BYTES = 64;

/** A pattern at offset 0; `undefined` matches any byte (the WHATWG pattern mask). */
type Pattern = ReadonlyArray<number | undefined>;

const ascii = (text: string): Pattern => [...Buffer.from(text, 'latin1')];
const any = (count: number): Pattern => Array.from({ length: count }, () => undefined);

const signatures: ReadonlyArray<readonly [Pattern, SniffedType]> = [
  [ascii('%PDF-'), 'application/pdf'],
  [[0x00, 0x00, 0x01, 0x00], 'image/x-icon'],
  [[0x00, 0x00, 0x02, 0x00], 'image/x-icon'],
  [ascii('BM'), 'image/bmp'],
  [ascii('GIF87a'), 'image/gif'],
  [ascii('GIF89a'), 'image/gif'],
  [[...ascii('RIFF'), ...any(4), ...ascii('WEBPVP')], 'image/webp'],
  [[0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a], 'image/png'],
  [[0xff, 0xd8, 0xff], 'image/jpeg'],
  [[...ascii('II'), 0x2a, 0x00], 'image/tiff'],
  [[...ascii('MM'), 0x00, 0x2a], 'image/tiff'],
];

function matches(head: Uint8Array, pattern: Pattern): boolean {
  return (
    head.byteLength >= pattern.length &&
    pattern.every((expected, index) => expected === undefined || head[index] === expected)
  );
}

const avifBrands = new Set(['avif', 'avis']);
const heicBrands = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);
const heifBrands = new Set(['mif1', 'msf1']);

/** The image type an ISO base media file's `ftyp` brands name, if any. */
function isoImageType(head: Uint8Array): SniffedType | undefined {
  const bytes = Buffer.from(head.buffer, head.byteOffset, head.byteLength);
  if (bytes.byteLength < 12 || bytes.toString('latin1', 4, 8) !== 'ftyp') return undefined;
  const boxEnd = Math.min(bytes.readUInt32BE(0), bytes.byteLength);
  // The major brand, then the compatible brands after the four-byte minor version.
  const brands = [bytes.toString('latin1', 8, 12)];
  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
    brands.push(bytes.toString('latin1', offset, offset + 4));
  }
  if (brands.some((brand) => avifBrands.has(brand))) return 'image/avif';
  if (brands.some((brand) => heicBrands.has(brand))) return 'image/heic';
  if (brands.some((brand) => heifBrands.has(brand))) return 'image/heif';
  return undefined;
}

/** The type the leading bytes of a file show, or `undefined` when they match no signature. */
export function sniffContentType(head: Uint8Array): SniffedType | undefined {
  for (const [pattern, type] of signatures) {
    if (matches(head, pattern)) return type;
  }
  return isoImageType(head);
}

async function* replay(
  head: readonly Uint8Array[],
  rest: AsyncIterator<Uint8Array> | undefined,
): AsyncIterable<Uint8Array> {
  yield* head;
  if (rest === undefined) return;
  for (let next = await rest.next(); next.done !== true; next = await rest.next()) {
    yield next.value;
  }
}

/** Reads the leading bytes of `body` and decides its type; the body handed back is the whole file. */
export async function sniffUpload(body: AsyncIterable<Uint8Array>): Promise<SniffedUpload> {
  const source = body[Symbol.asyncIterator]();
  const head: Uint8Array[] = [];
  let length = 0;
  let ended = false;
  while (length < HEAD_BYTES) {
    const next = await source.next();
    if (next.done === true) {
      ended = true;
      break;
    }
    head.push(next.value);
    length += next.value.byteLength;
  }
  const leading = Buffer.concat(head).subarray(0, HEAD_BYTES);
  return { type: sniffContentType(leading), body: replay(head, ended ? undefined : source) };
}

/** The kinds of upload this phase takes, and the types each admits (FR-151). */
export type UploadKind = 'identity' | 'credential' | 'photo';

export const uploadKinds: Readonly<Record<UploadKind, readonly SniffedType[]>> = {
  identity: ['application/pdf'],
  credential: ['application/pdf'],
  photo: ['image/jpeg', 'image/png'],
};

/** The settings key of the largest file accepted (SRS §3.14, NFR-SEC-9). */
export const UPLOAD_MAX_BYTES_SETTING = 'upload_max_bytes';

/** The settings key of the per-user upload limit (contracts/README.md "Rate limits"). */
export const UPLOAD_RATE_LIMIT = 'rate_limit_upload' satisfies RateLimitKey;

/** The `upload_max_bytes` setting's schema: whole bytes, at least one. */
export const uploadMaxBytes = z.int().positive();

/** What the kinds' guard reads its limits from. */
export interface UploadGuard {
  readonly settings: SettingsReader;
  readonly rateLimiter: RateLimiter;
}

export interface UploadOfKind {
  readonly kind: UploadKind;
  /** The uploader, as the server resolved it; the subject of the per-user limit. */
  readonly uploaderId: string;
  readonly body: AsyncIterable<Uint8Array>;
  /** The request's declared length, when it has one: refused before a byte is read if over. */
  readonly declaredLength?: number;
}

function tooLarge(): DomainError {
  return new DomainError('PAYLOAD_TOO_LARGE', 'The file is larger than allowed.');
}

/** `body` up to `limit` bytes; the chunk that crosses it is refused and nothing after it is read. */
async function* within(body: AsyncIterable<Uint8Array>, limit: number): AsyncIterable<Uint8Array> {
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > limit) throw tooLarge();
    yield chunk;
  }
}

/**
 * The upload a route of `kind` accepts: counted, bounded by the setting, typed by content. The
 * body handed back is the whole file, refused as it streams once it passes the limit.
 */
export async function acceptUploadOfKind(
  { settings, rateLimiter }: UploadGuard,
  { kind, uploaderId, body, declaredLength }: UploadOfKind,
): Promise<SniffedUpload<SniffedType>> {
  await rateLimiter.check(UPLOAD_RATE_LIMIT, uploaderId);
  const limit = await settings.read(UPLOAD_MAX_BYTES_SETTING, uploadMaxBytes);
  if (declaredLength !== undefined && declaredLength > limit) throw tooLarge();
  const upload = await acceptUpload(body, uploadKinds[kind]);
  return { type: upload.type, body: within(upload.body, limit) };
}

/** The upload, when its content is one of `accepted`; otherwise refused as a validation failure. */
export async function acceptUpload<TType extends SniffedType>(
  body: AsyncIterable<Uint8Array>,
  accepted: readonly TType[],
): Promise<SniffedUpload<TType>> {
  const upload = await sniffUpload(body);
  const type = upload.type;
  if (type === undefined || !(accepted as readonly SniffedType[]).includes(type)) {
    throw new DomainError('VALIDATION_FAILED', 'This type of file is not accepted.');
  }
  return { type: type as TType, body: upload.body };
}
