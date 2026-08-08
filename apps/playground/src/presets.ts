import type { ConnectionConfig, NetworkConditions, Resource } from "@page-load-anatomy/core";
import type { PageConfig } from "@page-load-anatomy/core";

export interface Preset {
  id: string;
  label: string;
  /** One line on why this preset is worth looking at. */
  hint: string;
  network: NetworkConditions;
  connection: ConnectionConfig;
}

/**
 * Nobody explores a blank slider panel. Presets exist to put a dramatic
 * difference one click away, and each is chosen to isolate one lesson.
 */
export const PRESETS: Preset[] = [
  {
    id: "returning",
    label: "Returning visitor",
    hint: "Warm DNS, resumed TLS, HTTP/3, CDN. Everything the platform can do for you is already done.",
    network: { rttMs: 40, bandwidthMbps: 100, packetLoss: 0, resolverRttMs: 10 },
    connection: { http: "h3", tls: "tls1.3-0rtt", dns: "browser-cached", cdn: true },
  },
  {
    id: "first-visit",
    label: "First visit",
    hint: "Nothing cached. Watch how much time disappears before the request even goes out.",
    network: { rttMs: 60, bandwidthMbps: 100, packetLoss: 0, resolverRttMs: 20 },
    connection: { http: "h2", tls: "tls1.3-full", dns: "cold", cdn: true },
  },
  {
    id: "coffee-shop",
    label: "Coffee shop wifi",
    hint: "Decent bandwidth, ugly latency, some loss. The common case nobody tests on.",
    network: { rttMs: 180, bandwidthMbps: 20, packetLoss: 0.02, resolverRttMs: 60 },
    connection: { http: "h2", tls: "tls1.3-full", dns: "resolver-cached", cdn: false },
  },
  {
    id: "far-away",
    label: "Other side of the world",
    hint: "300ms RTT to the origin. Every round trip you didn't eliminate now costs a third of a second.",
    network: { rttMs: 300, bandwidthMbps: 50, packetLoss: 0.01, resolverRttMs: 90 },
    connection: { http: "http/1.1", tls: "tls1.2-full", dns: "cold", cdn: false },
  },
  {
    id: "datacenter",
    label: "Same datacenter",
    hint: "1ms RTT. Now — and only now — bandwidth and payload size are what matter.",
    network: { rttMs: 1, bandwidthMbps: 1000, packetLoss: 0, resolverRttMs: 1 },
    connection: { http: "h2", tls: "tls1.3-resumed", dns: "browser-cached", cdn: false },
  },
];

function asset(name: string, over: Partial<Resource> = {}): Resource {
  return {
    name,
    kind: "image",
    bytes: 28_000,
    renderBlocking: false,
    discoveredAfterDocument: true,
    ...over,
  };
}

/** A believable small marketing page: two blockers, a hero, and a grid of thumbs. */
export const DEFAULT_PAGE: PageConfig = {
  documentBytes: 12_000,
  serverThinkMs: 40,
  resources: [
    asset("main.css", { kind: "stylesheet", bytes: 22_000, renderBlocking: true }),
    asset("app.js", { kind: "script", bytes: 96_000, renderBlocking: true }),
    asset("hero.jpg", { bytes: 190_000 }),
    asset("logo.svg", { bytes: 4_000 }),
    ...Array.from({ length: 8 }, (_, i) => asset(`thumb-${i + 1}.jpg`, { bytes: 26_000 })),
  ],
};
