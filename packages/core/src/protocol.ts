import type { ConnectionConfig, DnsState, HttpVersion, NetworkConditions, TlsMode } from "./types";

/**
 * Round-trip accounting for connection setup.
 *
 * This is the part of a page load people consistently underestimate: before a
 * single byte of HTML arrives, a cold connection has already spent four or more
 * round trips. On a 200ms link that is most of a second, and no amount of
 * shrinking the payload touches it.
 */

/** TCP's 3-way handshake costs one RTT before data can flow (data rides the final ACK). */
export const TCP_HANDSHAKE_RTT = 1;

/**
 * RFC 6928 raised TCP's initial congestion window to 10 segments. At a 1460-byte
 * MSS that is 14,600 bytes deliverable in the first round trip — the origin of
 * the "keep it under 14KB" rule.
 */
export const INITIAL_CWND_SEGMENTS = 10;
export const MSS_BYTES = 1460;
export const INITIAL_WINDOW_BYTES = INITIAL_CWND_SEGMENTS * MSS_BYTES;

/** Browsers cap concurrent connections per origin on HTTP/1.1. */
export const H1_MAX_PARALLEL = 6;

/** A CDN edge is typically far closer than the origin. */
export const CDN_RTT_FACTOR = 0.25;

export function dnsRoundTrips(state: DnsState): number {
  switch (state) {
    // Already resolved in-process; costs nothing.
    case "browser-cached":
      return 0;
    // One hop to the recursive resolver, which answers from its own cache.
    case "resolver-cached":
      return 1;
    // Resolver must walk root -> TLD -> authoritative before answering.
    case "cold":
      return 4;
  }
}

export function tlsRoundTrips(mode: TlsMode): number {
  switch (mode) {
    case "none":
      return 0;
    // ClientHello/ServerHello, then key exchange and Finished.
    case "tls1.2-full":
      return 2;
    // TLS 1.3 folds key share into the first flight.
    case "tls1.3-full":
      return 1;
    case "tls1.3-resumed":
      return 1;
    // Early data rides the first flight. Replay-unsafe, so requests must be idempotent.
    case "tls1.3-0rtt":
      return 0;
  }
}

/**
 * QUIC carries its own crypto handshake, so HTTP/3 does not pay TCP's RTT on top
 * of TLS — the two are combined into a single flight.
 */
export function transportRoundTrips(http: HttpVersion, tls: TlsMode): number {
  if (http === "h3") {
    return tls === "tls1.3-0rtt" ? 0 : 1;
  }
  return TCP_HANDSHAKE_RTT + tlsRoundTrips(tls);
}

export function effectiveRttMs(network: NetworkConditions, cdn: boolean): number {
  return cdn ? network.rttMs * CDN_RTT_FACTOR : network.rttMs;
}

export interface HandshakeBreakdown {
  dnsMs: number;
  transportMs: number;
  totalMs: number;
  roundTrips: number;
}

export function handshakeCost(network: NetworkConditions, config: ConnectionConfig): HandshakeBreakdown {
  const rtt = effectiveRttMs(network, config.cdn);
  const dnsMs = dnsRoundTrips(config.dns) * network.resolverRttMs;
  const transportRtts = transportRoundTrips(config.http, config.tls);
  const transportMs = transportRtts * rtt;

  return {
    dnsMs,
    transportMs,
    totalMs: dnsMs + transportMs,
    roundTrips: dnsRoundTrips(config.dns) + transportRtts,
  };
}

/**
 * Time to move `bytes` once the connection is open.
 *
 * Modelled as TCP slow start rather than bytes/bandwidth, because for small
 * responses the congestion window — not the link — is the constraint. The window
 * doubles each round trip, so a 100KB asset costs several RTTs even on a fast
 * connection. Once the window exceeds the bandwidth-delay product, bandwidth
 * takes over and the transfer becomes throughput-bound.
 */
export function transferTimeMs(bytes: number, rttMs: number, bandwidthMbps: number, packetLoss = 0): number {
  if (bytes <= 0) return 0;

  const bytesPerMs = (bandwidthMbps * 1_000_000) / 8 / 1000;
  let remaining = bytes;
  let window = INITIAL_WINDOW_BYTES;
  let elapsed = 0;

  while (remaining > 0) {
    const chunk = Math.min(remaining, window);
    // Within a round trip the link still bounds delivery.
    const linkMs = chunk / bytesPerMs;
    elapsed += Math.max(rttMs, linkMs);
    remaining -= chunk;
    window *= 2;

    // Guard against absurd inputs producing an unbounded loop.
    if (elapsed > 600_000) break;
  }

  // Each lost segment costs roughly a retransmit round trip.
  const expectedLosses = (bytes / MSS_BYTES) * packetLoss;
  return elapsed + expectedLosses * rttMs;
}

/**
 * How many requests can be in flight at once.
 *
 * HTTP/1.1 is limited to roughly six connections per origin, so a 50-asset page
 * queues. HTTP/2 and HTTP/3 multiplex over one connection and do not queue at
 * this layer.
 */
export function maxConcurrentRequests(http: HttpVersion): number {
  return http === "http/1.1" ? H1_MAX_PARALLEL : Number.POSITIVE_INFINITY;
}
