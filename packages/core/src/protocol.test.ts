import { describe, expect, it } from "vitest";
import {
  INITIAL_WINDOW_BYTES,
  dnsRoundTrips,
  effectiveRttMs,
  handshakeCost,
  maxConcurrentRequests,
  tlsRoundTrips,
  transferTimeMs,
  transportRoundTrips,
} from "./protocol";
import type { NetworkConditions } from "./types";

const net: NetworkConditions = { rttMs: 100, bandwidthMbps: 50, packetLoss: 0, resolverRttMs: 20 };

describe("DNS", () => {
  it("costs nothing when the browser already has it", () => {
    expect(dnsRoundTrips("browser-cached")).toBe(0);
  });

  it("costs one round trip when the resolver has it cached", () => {
    expect(dnsRoundTrips("resolver-cached")).toBe(1);
  });

  it("costs four round trips cold — resolver walks root, TLD, then authoritative", () => {
    expect(dnsRoundTrips("cold")).toBe(4);
  });
});

describe("TLS", () => {
  it("TLS 1.2 needs two round trips", () => {
    expect(tlsRoundTrips("tls1.2-full")).toBe(2);
  });

  it("TLS 1.3 folds key share into the first flight, so one round trip", () => {
    expect(tlsRoundTrips("tls1.3-full")).toBe(1);
  });

  it("0-RTT resumption costs nothing", () => {
    expect(tlsRoundTrips("tls1.3-0rtt")).toBe(0);
  });

  it("TLS 1.3 is strictly cheaper than 1.2", () => {
    expect(tlsRoundTrips("tls1.3-full")).toBeLessThan(tlsRoundTrips("tls1.2-full"));
  });
});

describe("transport", () => {
  it("HTTP/2 pays TCP's handshake on top of TLS", () => {
    expect(transportRoundTrips("h2", "tls1.3-full")).toBe(2);
  });

  it("HTTP/3 combines transport and crypto into one flight", () => {
    expect(transportRoundTrips("h3", "tls1.3-full")).toBe(1);
  });

  it("HTTP/3 saves exactly the TCP round trip versus HTTP/2", () => {
    expect(transportRoundTrips("h2", "tls1.3-full") - transportRoundTrips("h3", "tls1.3-full")).toBe(1);
  });

  it("HTTP/3 with 0-RTT sends the request immediately", () => {
    expect(transportRoundTrips("h3", "tls1.3-0rtt")).toBe(0);
  });
});

describe("handshake cost", () => {
  it("a cold HTTP/1.1 + TLS 1.2 connection burns 7 round trips before the request", () => {
    const cost = handshakeCost(net, { http: "http/1.1", tls: "tls1.2-full", dns: "cold", cdn: false });
    // 4 DNS + 1 TCP + 2 TLS
    expect(cost.roundTrips).toBe(7);
    expect(cost.dnsMs).toBe(80);
    expect(cost.transportMs).toBe(300);
  });

  it("a warm HTTP/3 0-RTT connection spends nothing on setup", () => {
    const cost = handshakeCost(net, { http: "h3", tls: "tls1.3-0rtt", dns: "browser-cached", cdn: false });
    expect(cost.roundTrips).toBe(0);
    expect(cost.totalMs).toBe(0);
  });

  it("a CDN cuts the transport cost without touching DNS", () => {
    const config = { http: "h2", tls: "tls1.3-full", dns: "cold", cdn: true } as const;
    const cost = handshakeCost(net, config);
    expect(cost.transportMs).toBe(2 * effectiveRttMs(net, true));
    expect(cost.dnsMs).toBe(80);
  });
});

describe("transfer time (TCP slow start)", () => {
  it("anything inside the initial 14.6KB window arrives in one round trip", () => {
    expect(transferTimeMs(INITIAL_WINDOW_BYTES, 100, 1000)).toBe(100);
    expect(transferTimeMs(10_000, 100, 1000)).toBe(100);
  });

  it("one byte over the window costs a second round trip", () => {
    expect(transferTimeMs(INITIAL_WINDOW_BYTES + 1, 100, 1000)).toBe(200);
  });

  it("100KB needs three round trips as the window doubles 10 -> 20 -> 40 segments", () => {
    expect(transferTimeMs(100_000, 100, 1000)).toBe(300);
  });

  it("becomes bandwidth-bound once the payload is large", () => {
    const fast = transferTimeMs(5_000_000, 10, 100);
    const slow = transferTimeMs(5_000_000, 10, 10);
    expect(slow).toBeGreaterThan(fast * 5);
  });

  it("charges a retransmit round trip for lost segments", () => {
    const clean = transferTimeMs(146_000, 100, 1000, 0);
    const lossy = transferTimeMs(146_000, 100, 1000, 0.02);
    expect(lossy).toBeGreaterThan(clean);
  });

  it("returns zero for an empty resource", () => {
    expect(transferTimeMs(0, 100, 50)).toBe(0);
  });
});

describe("concurrency", () => {
  it("HTTP/1.1 is capped at six connections per origin", () => {
    expect(maxConcurrentRequests("http/1.1")).toBe(6);
  });

  it("HTTP/2 and HTTP/3 multiplex, so there is no per-request cap", () => {
    expect(maxConcurrentRequests("h2")).toBe(Number.POSITIVE_INFINITY);
    expect(maxConcurrentRequests("h3")).toBe(Number.POSITIVE_INFINITY);
  });
});
