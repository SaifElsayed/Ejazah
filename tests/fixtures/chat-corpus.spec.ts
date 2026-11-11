// T038 of specs/004-sessions — R-SEC-5's CI test over the chat corpus (SC-408; FR-489, FR-490;
// R-SEC-4; research R-314; the notes under T038): every image is refused, by its content or by its
// name, and every allowed document is accepted, each file taken through the `chat` kind as the
// route takes it: the content decided as it streams, then the name.
//
// The corpus is `tests/fixtures/chat-corpus/`, its expected outcome per file in `corpus.json`: every
// image type the sniffer names, an image renamed `.pdf` or `.txt`, a PDF renamed `.png`, a text file
// with a binary byte, an SVG renamed `.txt` and one named `.svg` (the owner's Q1 (a)), and a PDF and
// two UTF-8 text files. A file not in the manifest, or a manifest line with no file, fails the spec;
// so does an image type the sniffer names that no corpus file is (checked at compile time too).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  acceptUploadOfKind,
  type AttachmentRefusal,
  AttachmentRefusedError,
  refuseImageFilename,
  type SniffedType,
  sniffContentType,
  type UploadGuard,
} from '../../apps/api/src/platform/guards/upload.middleware.js';
import type { RateLimiter } from '../../apps/api/src/platform/guards/rate-limit.guard.js';

const CORPUS = join(__dirname, 'chat-corpus');
const MANIFEST = 'corpus.json';
const NOT_FILES = new Set([MANIFEST, '.gitattributes']);

type Expected =
  { readonly refused: AttachmentRefusal } | { readonly accepted: 'application/pdf' | 'text/plain' };

const manifest = JSON.parse(readFileSync(join(CORPUS, MANIFEST), 'utf8')) as Record<
  string,
  Expected
>;

/** Every image type the sniffer names; a type it gains and this list lacks fails the typecheck. */
const IMAGE_TYPES = [
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
  'image/x-icon',
] as const satisfies readonly Exclude<SniffedType, 'application/pdf'>[];
type Unlisted = Exclude<Exclude<SniffedType, 'application/pdf'>, (typeof IMAGE_TYPES)[number]>;
const everyImageListed: [Unlisted] extends [never] ? true : never = true;

const guard: UploadGuard = {
  settings: {
    read: async (_key, schema) => schema.parse(1_048_576),
  },
  rateLimiter: { check: async () => undefined } as unknown as RateLimiter,
};

/** The file as the route decides it: the content as it streams, then the name. */
async function outcomeOf(name: string, data: Buffer): Promise<Expected> {
  try {
    const upload = await acceptUploadOfKind(guard, {
      kind: 'chat',
      uploaderId: '0199d0a0-0000-7000-8000-000000000001',
      body: (async function* () {
        for (let start = 0; start < data.byteLength; start += 16) {
          yield data.subarray(start, start + 16);
        }
      })(),
    });
    for await (const _chunk of upload.body) {
      // Read to the end: the text check runs as the stream passes.
    }
    refuseImageFilename(name);
    if (upload.type !== 'application/pdf' && upload.type !== 'text/plain') {
      throw new Error(`the chat kind admitted ${upload.type}`);
    }
    return { accepted: upload.type };
  } catch (error: unknown) {
    if (error instanceof AttachmentRefusedError) return { refused: error.refusal };
    throw error;
  }
}

const files = readdirSync(CORPUS).filter((name) => !NOT_FILES.has(name));

describe('the chat corpus (T038, R-SEC-5, SC-408)', () => {
  it('lists every file of the corpus, and nothing else', () => {
    expect(everyImageListed).toBe(true);
    expect([...files].sort()).toEqual(Object.keys(manifest).sort());
  });

  it('holds a file of every image type the sniffer names', () => {
    const sniffed = new Set(
      files.map((name) => sniffContentType(readFileSync(join(CORPUS, name)).subarray(0, 64))),
    );
    for (const type of IMAGE_TYPES) expect(sniffed, type).toContain(type);
  });

  it('refuses every image by its content or its name, and accepts every allowed document', async () => {
    const outcomes: Record<string, Expected> = {};
    for (const name of files) {
      outcomes[name] = await outcomeOf(name, readFileSync(join(CORPUS, name)));
    }
    expect(outcomes).toEqual(manifest);
    const images = files.filter((name) => {
      const head = readFileSync(join(CORPUS, name)).subarray(0, 64);
      return (IMAGE_TYPES as readonly (SniffedType | undefined)[]).includes(sniffContentType(head));
    });
    for (const name of images) expect(outcomes[name], name).toHaveProperty('refused');
  });
});
