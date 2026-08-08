import { describe, expect, it } from "vitest";
import { simulate, type PageConfig } from "./simulate";
import type { ConnectionConfig, NetworkConditions, Resource } from "./types";

const net: NetworkConditions = { rttMs: 100, bandwidthMbps: 50, packetLoss: 0, resolverRttMs: 20 };

const modern: ConnectionConfig = { http: "h2", tls: "tls1.3-full", dns: "resolver-cached", cdn: false };

function asset(name: string, overrides: Partial<Resource> = {}): Resource {
  return {
    name,
    kind: "image",
    bytes: 30_000,
    renderBlocking: false,
    discoveredAfterDocument: true,
    ...overrides,
  };
}

const page: PageConfig = {
  documentBytes: 12_000,
  serverThinkMs: 40,
  resources: [
    asset("main.css", { kind: "stylesheet", bytes: 20_000, renderBlocking: true }),
    asset("app.js", { kind: "script", bytes: 90_000, renderBlocking: true }),
    asset("hero.jpg", { bytes: 180_000 }),
    ...Array.from({ length: 10 }, (_, i) => asset(`thumb-${i}.jpg`, { bytes: 25_000 })),
  ],
};

describe("waterfall ordering", () => {
  const result = simulate(net, modern, page);

  it("produces a coherent timeline", () => {
    expect(result.ttfbMs).toBeGreaterThan(0);
    expect(result.firstRenderMs).toBeGreaterThan(result.ttfbMs);
    expect(result.lcpMs).toBeGreaterThanOrEqual(result.firstRenderMs);
    expect(result.loadMs).toBeGreaterThanOrEqual(result.lcpMs);
  });

  it("never emits a span that ends before it starts", () => {
    for (const span of result.spans) {
      expect(span.endMs, `${span.resource}/${span.phase}`).toBeGreaterThanOrEqual(span.startMs);
    }
  });

  it("counts every byte on the wire", () => {
    const expected = page.documentBytes + page.resources.reduce((sum, r) => sum + r.bytes, 0);
    expect(result.totalBytes).toBe(expected);
  });
});

describe("HTTP/1.1 head-of-line queueing", () => {
  const h1 = simulate(net, { ...modern, http: "http/1.1" }, page);
  const h2 = simulate(net, modern, page);

  it("queues requests past the six-connection limit", () => {
    const queued = h1.spans.filter((s) => s.phase === "queued");
    expect(queued.length).toBeGreaterThan(0);
  });

  it("does not queue on a multiplexed connection", () => {
    expect(h2.spans.filter((s) => s.phase === "queued")).toHaveLength(0);
  });

  it("finishes a 13-asset page faster over HTTP/2", () => {
    expect(h2.loadMs).toBeLessThan(h1.loadMs);
  });
});

describe("render blocking", () => {
  it("first render waits for blocking resources", () => {
    const blocked = simulate(net, modern, page);
    const unblocked = simulate(net, modern, {
      ...page,
      resources: page.resources.map((r) => ({ ...r, renderBlocking: false })),
    });
    expect(unblocked.firstRenderMs).toBeLessThan(blocked.firstRenderMs);
  });

  it("paints immediately after parse when nothing blocks", () => {
    const noBlockers = simulate(net, modern, { ...page, resources: [] });
    const parse = noBlockers.spans.find((s) => s.phase === "parse")!;
    const render = noBlockers.spans.find((s) => s.phase === "render")!;
    // Render starts the instant parsing ends — no waiting on anything else.
    expect(render.startMs).toBe(parse.endMs);
  });
});

describe("the levers that actually move the needle", () => {
  it("a CDN beats shrinking the document", () => {
    const withCdn = simulate(net, { ...modern, cdn: true }, page);
    const halfSizeDocument = simulate(net, modern, { ...page, documentBytes: 6_000 });
    expect(withCdn.ttfbMs).toBeLessThan(halfSizeDocument.ttfbMs);
  });

  it("a cold connection costs multiples of a warm one", () => {
    const cold = simulate(net, { http: "http/1.1", tls: "tls1.2-full", dns: "cold", cdn: false }, page);
    const warm = simulate(net, { http: "h3", tls: "tls1.3-0rtt", dns: "browser-cached", cdn: false }, page);
    // Cold: 80ms DNS + 300ms TCP/TLS + 100ms RTT + 40ms server = 520ms.
    // Warm: 0 setup + 100ms RTT + 40ms server = 140ms.
    expect(cold.ttfbMs).toBe(520);
    expect(warm.ttfbMs).toBe(140);
    expect(cold.ttfbMs - warm.ttfbMs).toBe(380);
    expect(cold.handshakeRoundTrips).toBe(7);
    expect(warm.handshakeRoundTrips).toBe(0);
  });

  it("latency dominates a small page, not bandwidth", () => {
    const smallPage: PageConfig = { documentBytes: 8_000, serverThinkMs: 10, resources: [] };
    const fatPipe = simulate({ ...net, bandwidthMbps: 1000 }, modern, smallPage);
    const thinPipe = simulate({ ...net, bandwidthMbps: 5 }, modern, smallPage);
    // Ten times less bandwidth barely registers when the payload fits the first window.
    expect(thinPipe.loadMs - fatPipe.loadMs).toBeLessThan(20);

    const highLatency = simulate({ ...net, rttMs: 300 }, modern, smallPage);
    expect(highLatency.loadMs).toBeGreaterThan(fatPipe.loadMs * 2);
  });

  it("packet loss hurts a big transfer more than a small one", () => {
    const lossy: NetworkConditions = { ...net, packetLoss: 0.02 };
    const smallDelta =
      simulate(lossy, modern, { ...page, resources: [asset("a.jpg", { bytes: 10_000 })] }).loadMs -
      simulate(net, modern, { ...page, resources: [asset("a.jpg", { bytes: 10_000 })] }).loadMs;
    const bigDelta =
      simulate(lossy, modern, { ...page, resources: [asset("a.jpg", { bytes: 2_000_000 })] }).loadMs -
      simulate(net, modern, { ...page, resources: [asset("a.jpg", { bytes: 2_000_000 })] }).loadMs;
    expect(bigDelta).toBeGreaterThan(smallDelta);
  });
});
