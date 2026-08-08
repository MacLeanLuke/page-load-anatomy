import { effectiveRttMs, handshakeCost, maxConcurrentRequests, transferTimeMs } from "./protocol";
import type { ConnectionConfig, NetworkConditions, Resource, Simulation, Span } from "./types";

export interface PageConfig {
  /** The HTML document itself. */
  documentBytes: number;
  /** How long the origin spends generating the response before the first byte. */
  serverThinkMs: number;
  resources: Resource[];
}

/** Rough HTML parse throughput. Not the bottleneck, but not free either. */
const PARSE_BYTES_PER_MS = 50_000;
/** Layout plus paint once everything render-blocking has landed. */
const PAINT_MS = 16;

export function simulate(
  network: NetworkConditions,
  config: ConnectionConfig,
  page: PageConfig,
): Simulation {
  const rtt = effectiveRttMs(network, config.cdn);
  const spans: Span[] = [];
  let cursor = 0;

  const handshake = handshakeCost(network, config);

  if (handshake.dnsMs > 0) {
    spans.push({
      resource: "document",
      phase: "dns",
      startMs: cursor,
      endMs: cursor + handshake.dnsMs,
      note:
        config.dns === "cold"
          ? "Cold lookup: resolver walks root → TLD → authoritative, 4 round trips to the resolver."
          : "Resolver answered from its own cache: 1 round trip.",
    });
    cursor += handshake.dnsMs;
  }

  if (handshake.transportMs > 0) {
    const label =
      config.http === "h3"
        ? "QUIC carries its own crypto, so transport and TLS share one flight."
        : `TCP handshake (1 RTT) + TLS (${config.tls}).`;
    spans.push({
      resource: "document",
      phase: config.http === "h3" ? "tls" : "tcp",
      startMs: cursor,
      endMs: cursor + handshake.transportMs,
      note: `${label} ${handshake.roundTrips} round trips before any request goes out.`,
    });
    cursor += handshake.transportMs;
  }

  // Request out, first byte back: one more round trip plus whatever the server spends.
  const ttfbWait = rtt + page.serverThinkMs;
  spans.push({
    resource: "document",
    phase: "ttfb-wait",
    startMs: cursor,
    endMs: cursor + ttfbWait,
    note: `Request travels out and the first byte comes back: 1 RTT (${rtt.toFixed(0)}ms) plus ${page.serverThinkMs}ms of server time.`,
  });
  cursor += ttfbWait;
  const ttfbMs = cursor;

  const documentDownload = transferTimeMs(page.documentBytes, rtt, network.bandwidthMbps, network.packetLoss);
  spans.push({
    resource: "document",
    phase: "download",
    startMs: cursor,
    endMs: cursor + documentDownload,
    note:
      page.documentBytes <= 14_600
        ? "Fits in TCP's initial congestion window (14.6KB), so it arrives in a single round trip."
        : "Exceeds the initial 14.6KB window, so slow start needs extra round trips to ramp up.",
  });
  cursor += documentDownload;
  const documentDone = cursor;

  const parseMs = page.documentBytes / PARSE_BYTES_PER_MS;
  spans.push({
    resource: "document",
    phase: "parse",
    startMs: documentDone,
    endMs: documentDone + parseMs,
    note: "HTML is parsed into the DOM. Subresources referenced in the markup are only discovered here.",
  });
  const parseDone = documentDone + parseMs;

  // Schedule subresources against the concurrency limit for this protocol.
  const limit = maxConcurrentRequests(config.http);
  const slotFreeAt: number[] = Number.isFinite(limit) ? new Array(limit).fill(0) : [];

  const ordered = [...page.resources].sort(
    (a, b) => Number(a.discoveredAfterDocument) - Number(b.discoveredAfterDocument),
  );

  const finishedAt = new Map<string, number>();

  for (const resource of ordered) {
    // Preloaded assets can start as soon as the connection is up; everything else
    // waits for the parser to find it.
    const readyAt = resource.discoveredAfterDocument ? parseDone : ttfbMs;

    let startAt = readyAt;
    let slotIndex = -1;
    if (Number.isFinite(limit)) {
      slotIndex = slotFreeAt.reduce((best, value, index) => (value < slotFreeAt[best]! ? index : best), 0);
      startAt = Math.max(readyAt, slotFreeAt[slotIndex]!);

      if (startAt > readyAt) {
        spans.push({
          resource: resource.name,
          phase: "queued",
          startMs: readyAt,
          endMs: startAt,
          note: `HTTP/1.1 allows only 6 connections per origin, so this waited ${(startAt - readyAt).toFixed(0)}ms for a free one.`,
        });
      }
    }

    const waitMs = rtt;
    spans.push({
      resource: resource.name,
      phase: "ttfb-wait",
      startMs: startAt,
      endMs: startAt + waitMs,
      note: "Connection is already open, so this costs one round trip rather than a fresh handshake.",
    });

    const downloadMs = transferTimeMs(resource.bytes, rtt, network.bandwidthMbps, network.packetLoss);
    const downloadStart = startAt + waitMs;
    spans.push({
      resource: resource.name,
      phase: "download",
      startMs: downloadStart,
      endMs: downloadStart + downloadMs,
      note: `${(resource.bytes / 1024).toFixed(1)}KB${resource.renderBlocking ? " — blocks first render" : ""}`,
    });

    const endAt = downloadStart + downloadMs;
    finishedAt.set(resource.name, endAt);
    if (slotIndex >= 0) slotFreeAt[slotIndex] = endAt;
  }

  const renderBlockers = page.resources.filter((r) => r.renderBlocking);
  const blockersDone = renderBlockers.reduce((latest, r) => Math.max(latest, finishedAt.get(r.name) ?? 0), parseDone);

  const firstRenderMs = blockersDone + PAINT_MS;
  spans.push({
    resource: "document",
    phase: "render",
    startMs: blockersDone,
    endMs: firstRenderMs,
    note:
      renderBlockers.length > 0
        ? `Blocked by ${renderBlockers.length} render-blocking resource${renderBlockers.length === 1 ? "" : "s"}.`
        : "Nothing render-blocking, so paint happens as soon as the document is parsed.",
  });

  const images = page.resources.filter((r) => r.kind === "image");
  const largestImage = images.sort((a, b) => b.bytes - a.bytes)[0];
  const lcpMs = Math.max(firstRenderMs, largestImage ? (finishedAt.get(largestImage.name) ?? 0) : 0);

  const loadMs = Math.max(firstRenderMs, ...page.resources.map((r) => finishedAt.get(r.name) ?? 0));
  const totalBytes = page.documentBytes + page.resources.reduce((sum, r) => sum + r.bytes, 0);

  return {
    spans: spans.sort((a, b) => a.startMs - b.startMs),
    ttfbMs,
    firstRenderMs,
    lcpMs,
    loadMs,
    handshakeRoundTrips: handshake.roundTrips,
    totalBytes,
  };
}
