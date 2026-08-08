import type { PhaseName, Span } from "@page-load-anatomy/core";

/**
 * Turns the browser's own Resource Timing entries into the same span shape the
 * simulator produces, so a real request and a predicted one can be drawn by the
 * same component and compared directly.
 *
 * The browser already dissects every request for you — DNS, connect, TLS, TTFB,
 * download are all in `PerformanceResourceTiming`. Almost nobody looks.
 */

export interface ObservedRequest {
  name: string;
  url: string;
  /** "script", "img", "fetch", "xmlhttprequest", … */
  initiatorType: string;
  /** Negotiated protocol: "h2", "h3", "http/1.1". Empty when not exposed. */
  protocol: string;
  startMs: number;
  durationMs: number;
  transferBytes: number;
  decodedBytes: number;
  /** Served from cache — bytes decoded but nothing moved on the wire. */
  fromCache: boolean;
  /**
   * False for cross-origin responses without a `Timing-Allow-Origin` header.
   * The browser zeroes every phase timing in that case, leaving only start and
   * duration. Worth surfacing rather than drawing an empty waterfall and
   * letting someone conclude the request was instant.
   */
  timingsVisible: boolean;
  spans: Span[];
}

/** The subset of PerformanceResourceTiming this module reads. */
export interface ResourceTimingLike {
  name: string;
  initiatorType: string;
  nextHopProtocol?: string;
  startTime: number;
  duration: number;
  fetchStart: number;
  domainLookupStart: number;
  domainLookupEnd: number;
  connectStart: number;
  connectEnd: number;
  secureConnectionStart: number;
  requestStart: number;
  responseStart: number;
  responseEnd: number;
  transferSize?: number;
  encodedBodySize?: number;
  decodedBodySize?: number;
}

function span(resource: string, phase: PhaseName, startMs: number, endMs: number, note: string): Span | null {
  // Zeroed or inverted timings mean the phase is not observable, not instant.
  if (!(startMs > 0) || !(endMs > 0) || endMs <= startMs) return null;
  return { resource, phase, startMs, endMs, note };
}

function shortName(url: string): string {
  try {
    const parsed = new URL(url, "https://example.invalid");
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return last || parsed.hostname;
  } catch {
    return url;
  }
}

export function toObservedRequest(entry: ResourceTimingLike): ObservedRequest {
  const name = shortName(entry.name);

  // Cross-origin without Timing-Allow-Origin: the browser reports startTime,
  // duration and responseEnd but zeroes every intermediate phase.
  const timingsVisible = entry.requestStart > 0;

  const transferBytes = entry.transferSize ?? 0;
  const decodedBytes = entry.decodedBodySize ?? 0;
  const fromCache = transferBytes === 0 && decodedBytes > 0;

  const candidates: (Span | null)[] = [
    span(
      name,
      "queued",
      entry.startTime,
      entry.domainLookupStart || entry.fetchStart,
      "Queued by the browser before the request was dispatched.",
    ),
    span(
      name,
      "dns",
      entry.domainLookupStart,
      entry.domainLookupEnd,
      "DNS resolution. Zero when the hostname was already cached.",
    ),
    span(
      name,
      "tcp",
      entry.connectStart,
      entry.secureConnectionStart > 0 ? entry.secureConnectionStart : entry.connectEnd,
      "TCP handshake. Zero when an existing connection was reused.",
    ),
    span(
      name,
      "tls",
      entry.secureConnectionStart,
      entry.connectEnd,
      "TLS handshake, measured separately from the TCP connect.",
    ),
    span(
      name,
      "ttfb-wait",
      entry.requestStart,
      entry.responseStart,
      "Request sent; waiting for the first byte. Server time plus one round trip.",
    ),
    span(name, "download", entry.responseStart, entry.responseEnd, "Response body arriving."),
  ];

  const spans = candidates.filter((value): value is Span => value !== null);

  return {
    name,
    url: entry.name,
    initiatorType: entry.initiatorType,
    protocol: entry.nextHopProtocol ?? "",
    startMs: entry.startTime,
    durationMs: entry.duration,
    transferBytes,
    decodedBytes,
    fromCache,
    timingsVisible,
    spans,
  };
}

export interface ObservationSummary {
  requests: number;
  /** Requests whose phase timings the browser refused to expose. */
  opaque: number;
  cached: number;
  totalTransferBytes: number;
  /** Negotiated protocols seen, with counts. */
  protocols: Record<string, number>;
  slowest: ObservedRequest | null;
}

export function summarize(requests: ObservedRequest[]): ObservationSummary {
  const protocols: Record<string, number> = {};
  let totalTransferBytes = 0;
  let opaque = 0;
  let cached = 0;
  let slowest: ObservedRequest | null = null;

  for (const request of requests) {
    if (!request.timingsVisible) opaque += 1;
    if (request.fromCache) cached += 1;
    totalTransferBytes += request.transferBytes;

    const key = request.protocol || "unknown";
    protocols[key] = (protocols[key] ?? 0) + 1;

    if (!slowest || request.durationMs > slowest.durationMs) slowest = request;
  }

  return { requests: requests.length, opaque, cached, totalTransferBytes, protocols, slowest };
}
