// T017 (PR #79 review, finding 1): the bearer token and the client's address are read from the
// request by the kernel, for the request context (`surfaces/context.ts`, which re-exports them) and
// for the public-page helper (`platform/web/route.ts`). `platform` depends on nothing above it
// (ARCHITECTURE §4), so neither lives in `surfaces/`.
//
// THE CLIENT'S ADDRESS (specs/002-identity/contracts/kernel.md "Session resolution"): the socket's
// peer, or, when `TRUSTED_PROXY` names the one proxy header to trust, that header's LAST hop — the
// one the trusted proxy appended, never the first, which the client writes itself (an appended
// `X-Forwarded-For` opens with whatever the caller sent). When the key is set and the header is
// absent, the socket's peer. T147: the header is read only when the socket's peer is the proxy's
// own address (`TRUSTED_PROXY_ADDRESS`), and its last hop only when it is an IP address. It is the
// subject of the anonymous paths that have no better one, and reaches a log only reduced to its
// network (R-SEC-2; `platform/logging/logger.ts`).
import type { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';
import type { Logger } from '../logging/logger.js';

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

/** `TRUSTED_PROXY` and `TRUSTED_PROXY_ADDRESS`: the one proxy's header and its own address. */
export interface TrustedProxy {
  readonly header: string;
  readonly address: string;
}

/** Why the proxy's header was set aside for the socket's peer. */
export type ProxyFallback = 'peer_not_proxy' | 'hop_not_an_address';

/** The client's address, and why the proxy's header was set aside, when it was. */
export interface ClientAddress {
  readonly address: string;
  readonly fallback?: ProxyFallback;
}

/** A socket that reports no peer: counted under one subject rather than refused. */
export const UNKNOWN_CLIENT_ADDRESS = 'unknown';

/** An IPv4 address in its IPv4-mapped IPv6 form, as a dual-stack socket reports it. */
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** `address` lower-cased and, when IPv4-mapped, as the IPv4 address it maps. */
function canonicalAddress(address: string): string {
  const lowered = address.trim().toLowerCase();
  return IPV4_MAPPED.exec(lowered)?.[1] ?? lowered;
}

/**
 * The client's address, with the reason when the proxy's header was set aside (T147, W8): the
 * header is read only from the proxy's own address, so no other peer can choose the subject, and
 * its last hop only when it is an IP address; otherwise the socket's peer. A header that is absent
 * or empty is no reason: the socket's peer, as before.
 */
export function readClientAddress(source: PeerSource, proxy?: TrustedProxy): ClientAddress {
  const socket = source.remoteAddress ?? UNKNOWN_CLIENT_ADDRESS;
  if (proxy === undefined) return { address: socket };
  const raw = source.headers[proxy.header.toLowerCase()];
  const header = Array.isArray(raw) ? raw.join(',') : raw;
  if (header === undefined) return { address: socket };
  const hops = header
    .split(',')
    .map((hop) => hop.trim())
    .filter((hop) => hop !== '');
  const last = hops[hops.length - 1];
  if (last === undefined) return { address: socket };
  if (
    source.remoteAddress === undefined ||
    canonicalAddress(source.remoteAddress) !== canonicalAddress(proxy.address)
  ) {
    return { address: socket, fallback: 'peer_not_proxy' };
  }
  if (isIP(last) === 0) return { address: socket, fallback: 'hop_not_an_address' };
  return { address: last };
}

/**
 * The client's address: the socket's peer, or the last hop of the trusted proxy header when
 * `TRUSTED_PROXY` names one and the proxy sent it (`readClientAddress`). The first hop is never
 * read: an appended `X-Forwarded-For` opens with whatever the caller sent (kernel.md "Session
 * resolution").
 */
export function clientAddressOf(source: PeerSource, proxy?: TrustedProxy): string {
  return readClientAddress(source, proxy).address;
}

/**
 * Logs that the proxy's header was set aside, once for the request, on its request logger: the
 * reason only, never the header or a hop, which the caller wrote (R-SEC-2).
 */
export function logProxyFallback(log: Logger, fallback: ProxyFallback | undefined): void {
  if (fallback === undefined) return;
  log.warn({ reason: fallback }, "The trusted proxy's header was set aside for the socket's peer");
}
