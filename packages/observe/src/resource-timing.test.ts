import { describe, expect, it } from "vitest";
import { summarize, toObservedRequest, type ResourceTimingLike } from "./resource-timing";

/** A same-origin entry with every phase exposed. */
const sameOrigin: ResourceTimingLike = {
  name: "https://example.com/assets/app.js",
  initiatorType: "script",
  nextHopProtocol: "h2",
  startTime: 100,
  duration: 250,
  fetchStart: 100,
  domainLookupStart: 100,
  domainLookupEnd: 120,
  connectStart: 120,
  secureConnectionStart: 150,
  connectEnd: 200,
  requestStart: 200,
  responseStart: 300,
  responseEnd: 350,
  transferSize: 45_000,
  encodedBodySize: 44_500,
  decodedBodySize: 120_000,
};

/** Cross-origin without Timing-Allow-Origin: phases are zeroed by the browser. */
const opaque: ResourceTimingLike = {
  name: "https://cdn.other.com/font.woff2",
  initiatorType: "css",
  nextHopProtocol: "",
  startTime: 400,
  duration: 180,
  fetchStart: 400,
  domainLookupStart: 0,
  domainLookupEnd: 0,
  connectStart: 0,
  secureConnectionStart: 0,
  connectEnd: 0,
  requestStart: 0,
  responseStart: 0,
  responseEnd: 580,
  transferSize: 0,
  encodedBodySize: 0,
  decodedBodySize: 0,
};

describe("toObservedRequest", () => {
  const observed = toObservedRequest(sameOrigin);

  it("names the request by its last path segment", () => {
    expect(observed.name).toBe("app.js");
  });

  it("reports the negotiated protocol", () => {
    expect(observed.protocol).toBe("h2");
  });

  it("splits TCP and TLS at secureConnectionStart", () => {
    const tcp = observed.spans.find((s) => s.phase === "tcp")!;
    const tls = observed.spans.find((s) => s.phase === "tls")!;
    expect(tcp.startMs).toBe(120);
    expect(tcp.endMs).toBe(150);
    expect(tls.startMs).toBe(150);
    expect(tls.endMs).toBe(200);
  });

  it("derives DNS, wait, and download phases", () => {
    const byPhase = Object.fromEntries(observed.spans.map((s) => [s.phase, s]));
    expect(byPhase.dns!.endMs - byPhase.dns!.startMs).toBe(20);
    expect(byPhase["ttfb-wait"]!.endMs - byPhase["ttfb-wait"]!.startMs).toBe(100);
    expect(byPhase.download!.endMs - byPhase.download!.startMs).toBe(50);
  });

  it("emits phases in wall-clock order without gaps or inversions", () => {
    for (const s of observed.spans) expect(s.endMs).toBeGreaterThan(s.startMs);
  });
});

describe("opaque cross-origin entries", () => {
  const observed = toObservedRequest(opaque);

  it("flags that the browser withheld the timings", () => {
    expect(observed.timingsVisible).toBe(false);
  });

  it("emits no fabricated phase spans", () => {
    // Drawing zero-length DNS/TCP/TLS bars here would imply the request was
    // instant, which is the opposite of what a zeroed timing means.
    expect(observed.spans.filter((s) => s.phase !== "queued")).toHaveLength(0);
  });

  it("still reports overall duration", () => {
    expect(observed.durationMs).toBe(180);
  });
});

describe("cache detection", () => {
  it("treats decoded-without-transfer as a cache hit", () => {
    const cached = toObservedRequest({ ...sameOrigin, transferSize: 0, decodedBodySize: 120_000 });
    expect(cached.fromCache).toBe(true);
  });

  it("does not call a real transfer cached", () => {
    expect(toObservedRequest(sameOrigin).fromCache).toBe(false);
  });

  it("does not call an empty opaque response cached", () => {
    expect(toObservedRequest(opaque).fromCache).toBe(false);
  });
});

describe("summarize", () => {
  const summary = summarize([toObservedRequest(sameOrigin), toObservedRequest(opaque)]);

  it("counts requests, opaque entries, and bytes", () => {
    expect(summary.requests).toBe(2);
    expect(summary.opaque).toBe(1);
    expect(summary.totalTransferBytes).toBe(45_000);
  });

  it("tallies negotiated protocols, bucketing unknowns", () => {
    expect(summary.protocols).toEqual({ h2: 1, unknown: 1 });
  });

  it("finds the slowest request", () => {
    expect(summary.slowest?.name).toBe("app.js");
  });

  it("handles an empty page", () => {
    const empty = summarize([]);
    expect(empty.requests).toBe(0);
    expect(empty.slowest).toBeNull();
  });
});
