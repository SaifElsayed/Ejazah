// T104: upload content sniffing (FR-044, R-SEC-4; research R-16; contracts/kernel.md "Guards
// applied by default"). Every upload's type is decided by its leading bytes, before the file is
// written anywhere.
//
// THE DECLARATION IS DISCARDED, NOT COMPARED (research R-16). Neither function below takes a
// filename, an extension or a declared content type, so there is no code path where a client's
// claim decides anything, not even when it happens to agree with the content. An upload whose
// bytes match no known signature has no type, and a path that accepts only known types refuses it.
// T038 of specs/004-sessions adds one function that reads a name, `refuseImageFilename`: it can only
// refuse a file the content already admitted (FR-490 «by its extension»), never admit one.
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

/**
 * The types an upload kind may accept: what sniffing recognises, and the `chat` kind's `text/plain`,
 * which no signature names and the whole stream decides (T038 of specs/004-sessions).
 */
export type AcceptedType = SniffedType | 'text/plain';

/** An upload once its leading bytes are read: its type, or none, and the whole body to store. */
export interface SniffedUpload<TType extends AcceptedType | undefined = SniffedType | undefined> {
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

/**
 * The kinds of upload, and the sniffed types each admits (FR-151). T038 of specs/004-sessions adds
 * `chat`, decided by `acceptChatUpload` below: a PDF by its signature, or text by its whole stream.
 * T003 of specs/005-certification adds `signature`, the teacher's signature (FR-601, R-411): a PNG or a
 * JPEG by its content, as the photo is, whatever its name (R-SEC-4).
 */
export type UploadKind = 'identity' | 'credential' | 'photo' | 'chat' | 'signature';

export const uploadKinds: Readonly<Record<UploadKind, readonly SniffedType[]>> = {
  identity: ['application/pdf'],
  credential: ['application/pdf'],
  photo: ['image/jpeg', 'image/png'],
  chat: ['application/pdf'],
  signature: ['image/jpeg', 'image/png'],
};

// ---------------------------------------------------------------------------------------------
// T038 of specs/004-sessions: the `chat` kind (FR-489, FR-490; R-SEC-4, R-SEC-5; research R-314;
// plan.md decision 12; the notes under T038).
//
// Refused whenever the sniffer names an image, whatever the name (R-SEC-5); accepted as
// `application/pdf` by `%PDF-`; accepted as `text/plain` when no signature matches and the whole
// stream, checked as it streams, decodes as UTF-8 with no WHATWG binary data byte (0x00–0x08, 0x0B,
// 0x0E–0x1A, 0x1C–0x1F; https://mimesniff.spec.whatwg.org/#binary-data-byte); anything else refused.
// An SVG is an image written as text, so the text path refuses a stream whose text begins, after a
// byte-order mark, white space, an XML declaration or processing instruction, comments or a
// doctype, with an `<svg` element, or whose doctype names `svg` (the owner's Q1 (a) of 2026-11-11).
// A name whose extension is an image's, `.svg` and `.svgz` among them, is refused by
// `refuseImageFilename`, which the route calls after the content check (FR-490 «by its extension»).
// Office files are not admitted (decision 12). Every refusal is `ATTACHMENT_REFUSED` with no field;
// its cause stays on the error (`refusal`) for the route's one log line, never on the wire.
// ---------------------------------------------------------------------------------------------

/** Why a chat document was refused: an image by its content or its name, or not text. */
export type AttachmentRefusal = 'image_content' | 'image_extension' | 'not_text';

/** `ATTACHMENT_REFUSED`, with the cause the route logs; the client sees the code and message only. */
export class AttachmentRefusedError extends DomainError {
  readonly refusal: AttachmentRefusal;

  constructor(refusal: AttachmentRefusal) {
    super('ATTACHMENT_REFUSED');
    this.refusal = refusal;
  }
}

/** The extensions of an image, compared without case: the sniffer's types', and SVG's. */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'apng',
  'avif',
  'bmp',
  'cur',
  'gif',
  'heic',
  'heics',
  'heif',
  'heifs',
  'ico',
  'jfif',
  'jpe',
  'jpeg',
  'jpg',
  'pjp',
  'pjpeg',
  'png',
  'svg',
  'svgz',
  'tif',
  'tiff',
  'webp',
]);

/**
 * Refuses a name whose extension is an image's (`image_extension`). Trailing dots and blanks are
 * dropped first, as a file system drops them, so `photo.png.` is a PNG's name.
 */
export function refuseImageFilename(filename: string): void {
  const name = filename.replace(/[.\s]+$/u, '');
  const dot = name.lastIndexOf('.');
  if (dot === -1) return;
  if (IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())) {
    throw new AttachmentRefusedError('image_extension');
  }
}

/** Whether `byte` is a WHATWG binary data byte. */
function isBinaryDataByte(byte: number): boolean {
  return (
    byte <= 0x08 ||
    byte === 0x0b ||
    (byte >= 0x0e && byte <= 0x1a) ||
    (byte >= 0x1c && byte <= 0x1f)
  );
}

/** What the start of a text shows: an SVG, plain text, or not yet known. */
type TextStart = 'svg' | 'text' | 'undecided';

// Blanks, the byte-order mark among them (ECMAScript's `\s` holds U+FEFF), which the decoder leaves
// at the head of the text (`ignoreBOM`).
const LEADING_BLANKS = /^\s+/u;
const SVG_ELEMENT = /^<svg(?:[\s/>]|$)/iu;
const SVG_DOCTYPE = /^<!doctype\s+svg(?:[\s>[]|$)/iu;
const SVG_DOCTYPE_SO_FAR = /^<!doctype\s+svg$/iu;
const DOCTYPE = /^<!doctype/iu;
/** What a text may open with before its first element and is not yet whole: wait for more. */
const OPENINGS = ['<svg', '<!--', '<!doctype', '<?'];

/**
 * Reads the start of a text as it streams, and answers whether it opens as an SVG: after any
 * byte-order mark, blanks, processing instructions (an XML declaration among them), comments and
 * doctypes, an `<svg` element; or a doctype naming `svg`. Each part is consumed once it closes,
 * and the search for an open part's close resumes where it stopped, so a long comment is read in
 * one pass, never again from its start.
 */
function textStartReader(): (text: string, ended: boolean) => TextStart {
  let rest = '';
  let searchedTo = 0;
  const consume = (length: number): void => {
    rest = rest.slice(length);
    searchedTo = 0;
  };
  return (text, ended) => {
    rest += text;
    for (;;) {
      const blanks = LEADING_BLANKS.exec(rest);
      if (blanks !== null) {
        consume(blanks[0].length);
        continue;
      }
      if (rest === '') return ended ? 'text' : 'undecided';
      const doctype = DOCTYPE.test(rest);
      if (doctype && SVG_DOCTYPE.test(rest)) {
        // `<!doctype svg` with nothing after it yet may still name `svgx`.
        return SVG_DOCTYPE_SO_FAR.test(rest) && !ended ? 'undecided' : 'svg';
      }
      const closer = rest.startsWith('<!--')
        ? '-->'
        : rest.startsWith('<?')
          ? '?>'
          : doctype
            ? '>'
            : undefined;
      if (closer === undefined) break;
      const end = rest.indexOf(closer, Math.max(searchedTo, 2));
      if (end === -1) {
        if (ended) return 'text';
        searchedTo = Math.max(0, rest.length - closer.length + 1);
        return 'undecided';
      }
      consume(end + closer.length);
    }
    if (SVG_ELEMENT.test(rest) && (rest.length > '<svg'.length || ended)) return 'svg';
    if (ended) return 'text';
    const begun = rest.toLowerCase();
    return OPENINGS.some((opening) => opening.startsWith(begun)) ? 'undecided' : 'text';
  };
}

/** `body` handed on as it streams, refused at the first chunk that shows it is not plain text. */
async function* plainText(body: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const readStart = textStartReader();
  let start: TextStart = 'undecided';
  const decide = (text: string, ended: boolean): void => {
    if (start !== 'undecided') return;
    start = readStart(text, ended);
    if (start === 'svg') throw new AttachmentRefusedError('image_content');
  };
  const decoded = (chunk?: Uint8Array): string => {
    try {
      return chunk === undefined ? decoder.decode() : decoder.decode(chunk, { stream: true });
    } catch {
      throw new AttachmentRefusedError('not_text');
    }
  };
  for await (const chunk of body) {
    if (chunk.some(isBinaryDataByte)) throw new AttachmentRefusedError('not_text');
    decide(decoded(chunk), false);
    yield chunk;
  }
  decide(decoded(), true);
}

/** The `chat` kind's decision on `body`: a PDF, text checked as it streams, or refused. */
async function acceptChatUpload(
  body: AsyncIterable<Uint8Array>,
): Promise<SniffedUpload<'application/pdf' | 'text/plain'>> {
  const upload = await sniffUpload(body);
  if (upload.type === 'application/pdf') return { type: upload.type, body: upload.body };
  // Every other type the sniffer names is an image (R-SEC-5).
  if (upload.type !== undefined) throw new AttachmentRefusedError('image_content');
  return { type: 'text/plain', body: plainText(upload.body) };
}

/**
 * The most pixels (width × height) a profile photo may declare before it is decoded (T145; the
 * owner's decision of 2026-11-02). The photos route turns and re-encodes the photo to drop its
 * metadata, and turning it a quarter holds the whole image decoded (3 bytes a pixel for a JPEG,
 * 4 for a PNG with alpha, 8 at 16 bits) beside the buffers `sharp` decodes and encodes through.
 * `upload_max_bytes` (10 MiB) does not bound that, since a small file can declare any size (a
 * one-colour PNG compresses a thousandfold), and `sharp`'s own default (0x3FFF², 268 million
 * pixels) would let one upload hold gigabytes. 8192 × 6144 is the largest 4:3 frame of the 50 MP
 * sensors phones ship and admits every default output (12 MP, 24 MP on recent iPhones) and the
 * full-resolution modes (48 MP iPhone, 50 MP Android). One photo at the bound, measured on PR
 * #117's review, takes about 318 MB to process as an upright JPEG, about 435 MB as a JPEG with
 * Orientation 6 and about 551 MB as a 16-bit PNG with Orientation 6; hence one at a time
 * (`PHOTOS_PROCESSED_AT_ONCE`, T073). A 108 or 200 MP original is refused, and its JPEG is
 * usually over 10 MiB already at a camera's quality. Here, in the kernel, as the kinds are: a
 * constant in module code is refused by the magic-number gate (FR-034).
 */
export const PHOTO_MAX_INPUT_PIXELS = 8192 * 6144;

/**
 * How many photos one process decodes together (T073; the owner's decision of 2026-11-02): one,
 * since one at the bound costs up to about 551 MB (above). The rest wait their turn in order.
 */
export const PHOTOS_PROCESSED_AT_ONCE = 1;

/**
 * How long a photo may wait for its turn before it is refused with `RATE_LIMITED` (T073). One at
 * the bound takes about a second to process on a developer's machine (measured at 0.5 to 1.1 s),
 * so 30 seconds lets a line of a dozen or more through on a slower server, and leaves the phone's
 * upload timeout (`UPLOAD_TIMEOUT_MS`, 120 s, with the upload itself in it) room to read the
 * refusal rather than abort. A constant beside the bound, as the bound is, not a `settings` row:
 * both are what one process can hold, set with the server's memory, not a rule of the platform.
 */
export const PHOTO_TURN_WAIT_MS = 30_000;

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
): Promise<SniffedUpload<AcceptedType>> {
  // The uploader the route authenticated, as a user (T062); the route's fixed name as the procedure.
  await rateLimiter.check(
    UPLOAD_RATE_LIMIT,
    { kind: 'user', userId: uploaderId },
    `uploads.${kind}`,
  );
  const limit = await settings.read(UPLOAD_MAX_BYTES_SETTING, uploadMaxBytes);
  if (declaredLength !== undefined && declaredLength > limit) throw tooLarge();
  // T038 of specs/004-sessions: the chat kind decides by its own rules (above); every other kind
  // admits the sniffed types its list names and nothing else.
  const upload =
    kind === 'chat' ? await acceptChatUpload(body) : await acceptUpload(body, uploadKinds[kind]);
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
