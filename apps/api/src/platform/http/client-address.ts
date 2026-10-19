// T017 (PR #79 review, finding 1): the bearer token and the client's address are read from the
// request by the kernel, for the request context (`surfaces/context.ts`, which re-exports them) and
// for the public-page helper (`platform/web/route.ts`). `platform` depends on nothing above it
// (ARCHITECTURE §4), so neither lives in `surfaces/`.
//
// THE CLIENT'S ADDRESS (specs/002-identity/contracts/kernel.md "Session resolution"): the socket's
// peer, or, when `TRUSTED_PROXY` names the one proxy header to trust, that header's LAST hop — the
// one the trusted proxy appended, never the first, which the client writes itself (an appended
// `X-Forwarded-For` opens with whatever the caller sent). When the key is set and the header is
// absent, the socket's peer. It is the subject of the anonymous paths that have no better one, and
// reaches a log only reduced to its network (R-SEC-2; `platform/logging/logger.ts`).
import type { IncomingHttpHeaders } from 'node:http';

/** The bearer token of the `Authorization` header, or null when the header carries none. */
export function bearerOf(headers: IncomingHttpHeaders): string | null {
  const header = headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}

/** What the client's address is read from: the socket, and the request's headers. */
export interface PeerSource {
  readonly remoteAddress: string | undefined;
  readonly headers: IncomingHttpHeaders;
}

/** A socket that reports no peer: counted under one subject rather than refused. */
export const UNKNOWN_CLIENT_ADDRESS = 'unknown';

/**
 * The client's address: the socket's peer, or the last hop of the trusted proxy header when
 * `TRUSTED_PROXY` names one and the request carries it. The first hop is never read: an appended
 * `X-Forwarded-For` opens with whatever the caller sent (kernel.md "Session resolution").
 */
export function clientAddressOf(source: PeerSource, trustedProxyHeader?: string): string {
  const socket = source.remoteAddress ?? UNKNOWN_CLIENT_ADDRESS;
  if (trustedProxyHeader === undefined) return socket;
  const raw = source.headers[trustedProxyHeader.toLowerCase()];
  const header = Array.isArray(raw) ? raw.join(',') : raw;
  if (header === undefined) return socket;
  const hops = header
    .split(',')
    .map((hop) => hop.trim())
    .filter((hop) => hop !== '');
  return hops[hops.length - 1] ?? socket;
}
