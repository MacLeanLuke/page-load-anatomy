/** Every duration in this model is milliseconds; every size is bytes. */

export type HttpVersion = "http/1.1" | "h2" | "h3";

/** TLS 1.3 can skip round trips when it has seen this server before. */
export type TlsMode = "none" | "tls1.2-full" | "tls1.3-full" | "tls1.3-resumed" | "tls1.3-0rtt";

export type DnsState = "cold" | "resolver-cached" | "browser-cached";

export interface NetworkConditions {
  /** Round-trip time to the origin. */
  rttMs: number;
  /** Downlink throughput in megabits per second. */
  bandwidthMbps: number;
  /** 0–1. Drives the retransmit penalty and head-of-line blocking. */
  packetLoss: number;
  /** RTT to the recursive resolver, usually much lower than origin RTT. */
  resolverRttMs: number;
}

export interface ConnectionConfig {
  http: HttpVersion;
  tls: TlsMode;
  dns: DnsState;
  /** Serve from a nearby edge instead of the origin. Scales effective RTT. */
  cdn: boolean;
}

export type ResourceKind = "document" | "stylesheet" | "script" | "image" | "font";

export interface Resource {
  name: string;
  kind: ResourceKind;
  /** Bytes on the wire, after any compression. */
  bytes: number;
  /** Blocks first render until it has been downloaded and executed. */
  renderBlocking: boolean;
  /** Discovered only after the document has been parsed. */
  discoveredAfterDocument: boolean;
}

export type PhaseName =
  | "dns"
  | "tcp"
  | "tls"
  | "request"
  | "ttfb-wait"
  | "download"
  | "queued"
  | "parse"
  | "render";

export interface Span {
  resource: string;
  phase: PhaseName;
  startMs: number;
  endMs: number;
  /** Explains where this number came from, shown on hover. */
  note: string;
}

export interface Simulation {
  spans: Span[];
  /** First byte of the HTML document. */
  ttfbMs: number;
  /** Nothing can paint before this. */
  firstRenderMs: number;
  /** Largest Contentful Paint proxy — when the biggest image has landed. */
  lcpMs: number;
  /** Everything finished. */
  loadMs: number;
  /** Round trips spent before a single byte of the response arrives. */
  handshakeRoundTrips: number;
  totalBytes: number;
}
