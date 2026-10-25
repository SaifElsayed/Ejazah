// T095: `GET /files/<key>?expires=…&signature=…`, the route that serves local storage's signed links
// (note under T116; `local.adapter.ts`). It is mounted only over local storage: a remote store's
// links are its own presigned addresses, and this route never reads one.
//
// The files are uploaded by users and served from the API's own origin, so nothing in one may run
// there (B14b-2 check, the reviewer's conditions):
//   - only a PDF, a JPEG or a PNG is served inline, under its declared type; any other declared
//     type, or one that is not `type/subtype`, is handed over as `application/octet-stream`, an
//     attachment (the T116 note's m2);
//   - `X-Content-Type-Options: nosniff`, and the policy `default-src 'none'; frame-ancestors 'none';
//     sandbox` replaces the API's, so even a document the browser renders runs nothing;
//   - `Cache-Control: no-store`: a link lives minutes (`document_link_ttl_seconds`), its file no
//     longer than that in any cache.
// A forged, expired or unknown link is a bare 404 that says nothing of which. CORS stays the
// application's allowlist (T136), so the panel's reader may fetch a file and no other origin can.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NodeHandler } from '../../web/route.js';
import { LocalStorageAdapter } from './local.adapter.js';
import type { StoragePort } from './storage.port.js';

/** Where the files route is mounted; a link's path starts with it. */
export const FILES_PATH = '/files';

/** The declared types a browser may show in place; every other is downloaded. */
const INLINE_TYPES: ReadonlySet<string> = new Set(['application/pdf', 'image/jpeg', 'image/png']);

/** The policy of a served file: it loads nothing, runs nothing and is framed by nobody. */
const FILE_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox";

/** What the route reads of local storage. */
export type FileReader = Pick<LocalStorageAdapter, 'verifyLink' | 'read'>;

/** The files route under its path when `storage` is local, and nothing otherwise. */
export function filesRoutes(storage: StoragePort): Readonly<Record<string, NodeHandler>> {
  return storage instanceof LocalStorageAdapter ? { [FILES_PATH]: filesRoute(storage) } : {};
}

export function filesRoute(storage: FileReader): NodeHandler {
  return (incoming, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('content-security-policy', FILE_CSP);
    if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
      response.setHeader('allow', 'GET, HEAD');
      end(response, 405);
      return;
    }
    // Mounted under FILES_PATH, the request's own path is the rest of the link.
    const key = storage.verifyLink(`${FILES_PATH}${incoming.url ?? ''}`);
    if (key === undefined) {
      end(response, 404);
      return;
    }
    void serve(storage, key, incoming, response);
  };
}

async function serve(
  storage: FileReader,
  key: string,
  incoming: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  let file: Awaited<ReturnType<FileReader['read']>>;
  try {
    file = await storage.read(key);
  } catch (error: unknown) {
    end(response, (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500);
    return;
  }
  const declared = file.contentType.trim().toLowerCase();
  const inline = INLINE_TYPES.has(declared);
  response.statusCode = 200;
  response.setHeader('content-type', inline ? declared : 'application/octet-stream');
  response.setHeader('content-disposition', inline ? 'inline' : 'attachment');
  response.setHeader('content-length', file.body.byteLength);
  response.end(incoming.method === 'HEAD' ? undefined : file.body);
}

function end(response: ServerResponse, status: number): void {
  response.statusCode = status;
  response.setHeader('content-length', 0);
  response.end();
}
