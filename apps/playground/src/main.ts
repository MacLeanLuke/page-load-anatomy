import {
  simulate,
  type ConnectionConfig,
  type DnsState,
  type HttpVersion,
  type NetworkConditions,
  type PageConfig,
  type Resource,
  type Simulation,
  type TlsMode,
} from "@page-load-anatomy/core";
import { collectRequests, summarize } from "@page-load-anatomy/observe";
import { DEFAULT_PAGE, PRESETS } from "./presets";
import { renderLegend, renderWaterfall } from "./waterfall";
import "./style.css";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

interface State {
  network: NetworkConditions;
  connection: ConnectionConfig;
  documentKb: number;
  assetCount: number;
  blocking: boolean;
}

const state: State = {
  network: { ...PRESETS[1]!.network },
  connection: { ...PRESETS[1]!.connection },
  documentKb: 12,
  assetCount: 12,
  blocking: true,
};

let baseline: { label: string; result: Simulation } | null = null;

function buildPage(): PageConfig {
  const template = DEFAULT_PAGE.resources;
  const resources: Resource[] = [];

  for (let i = 0; i < state.assetCount; i++) {
    const source = template[i % template.length]!;
    resources.push({
      ...source,
      name: i < template.length ? source.name : `${source.name.replace(/\.\w+$/, "")}-${i}.jpg`,
      renderBlocking: state.blocking && source.renderBlocking,
    });
  }

  return {
    documentBytes: state.documentKb * 1024,
    serverThinkMs: 40,
    resources,
  };
}

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`;
}

function metricCard(label: string, value: string, hint: string, delta?: number): string {
  const deltaHtml =
    delta === undefined || Math.abs(delta) < 1
      ? ""
      : `<span class="delta ${delta < 0 ? "better" : "worse"}">${delta < 0 ? "−" : "+"}${fmt(Math.abs(delta))}</span>`;
  return `
    <div class="metric">
      <span class="metric-label">${label}</span>
      <span class="metric-value">${value}${deltaHtml}</span>
      <span class="metric-hint">${hint}</span>
    </div>`;
}

function render(): void {
  const page = buildPage();
  const result = simulate(state.network, state.connection, page);

  const handshakeMs = result.spans
    .filter((s) => ["dns", "tcp", "tls"].includes(s.phase))
    .reduce((total, s) => total + (s.endMs - s.startMs), 0);

  $("metrics").innerHTML = [
    metricCard(
      "Before the request",
      `${result.handshakeRoundTrips} RTT`,
      `${fmt(handshakeMs)} spent on DNS, TCP and TLS`,
    ),
    metricCard("First byte", fmt(result.ttfbMs), "TTFB", baseline ? result.ttfbMs - baseline.result.ttfbMs : undefined),
    metricCard(
      "First render",
      fmt(result.firstRenderMs),
      "Nothing is visible before this",
      baseline ? result.firstRenderMs - baseline.result.firstRenderMs : undefined,
    ),
    metricCard(
      "Fully loaded",
      fmt(result.loadMs),
      `${(result.totalBytes / 1024).toFixed(0)}KB total`,
      baseline ? result.loadMs - baseline.result.loadMs : undefined,
    ),
  ].join("");

  const scale = baseline ? Math.max(result.loadMs, baseline.result.loadMs) : result.loadMs;

  $("chart").innerHTML = renderWaterfall({
    spans: result.spans,
    scaleMs: scale,
    markers: [
      { label: "TTFB", atMs: result.ttfbMs },
      { label: "First render", atMs: result.firstRenderMs },
      { label: "LCP", atMs: result.lcpMs },
    ],
  });

  $("baseline").innerHTML = baseline
    ? `<h3>Baseline — ${baseline.label}</h3>${renderWaterfall({ spans: baseline.result.spans, scaleMs: scale })}`
    : "";

  $("unpin").hidden = baseline === null;
}

function describeConfig(): string {
  const { connection, network } = state;
  return `${connection.http}, ${connection.tls}, ${connection.dns} DNS, ${network.rttMs}ms RTT${connection.cdn ? ", CDN" : ""}`;
}

function syncInputsFromState(): void {
  ($("rtt") as HTMLInputElement).value = String(state.network.rttMs);
  ($("bandwidth") as HTMLInputElement).value = String(state.network.bandwidthMbps);
  ($("loss") as HTMLInputElement).value = String(state.network.packetLoss * 100);
  ($("dns") as HTMLSelectElement).value = state.connection.dns;
  ($("tls") as HTMLSelectElement).value = state.connection.tls;
  ($("http") as HTMLSelectElement).value = state.connection.http;
  ($("cdn") as HTMLInputElement).checked = state.connection.cdn;
  ($("doc") as HTMLInputElement).value = String(state.documentKb);
  ($("assets") as HTMLInputElement).value = String(state.assetCount);
  ($("blocking") as HTMLInputElement).checked = state.blocking;

  $("out-rtt").textContent = `${state.network.rttMs}ms`;
  $("out-bandwidth").textContent = `${state.network.bandwidthMbps}Mbps`;
  $("out-loss").textContent = `${(state.network.packetLoss * 100).toFixed(1)}%`;
  $("out-doc").textContent = `${state.documentKb}KB`;
  $("out-assets").textContent = String(state.assetCount);
}

function wireControls(): void {
  const onInput = () => {
    state.network.rttMs = Number(($("rtt") as HTMLInputElement).value);
    state.network.bandwidthMbps = Number(($("bandwidth") as HTMLInputElement).value);
    state.network.packetLoss = Number(($("loss") as HTMLInputElement).value) / 100;
    state.connection.dns = ($("dns") as HTMLSelectElement).value as DnsState;
    state.connection.tls = ($("tls") as HTMLSelectElement).value as TlsMode;
    state.connection.http = ($("http") as HTMLSelectElement).value as HttpVersion;
    state.connection.cdn = ($("cdn") as HTMLInputElement).checked;
    state.documentKb = Number(($("doc") as HTMLInputElement).value);
    state.assetCount = Number(($("assets") as HTMLInputElement).value);
    state.blocking = ($("blocking") as HTMLInputElement).checked;

    syncInputsFromState();
    render();
  };

  $("controls").addEventListener("input", onInput);
  $("controls").addEventListener("change", onInput);

  $("pin").addEventListener("click", () => {
    baseline = { label: describeConfig(), result: simulate(state.network, state.connection, buildPage()) };
    render();
  });

  $("unpin").addEventListener("click", () => {
    baseline = null;
    render();
  });
}

function wirePresets(): void {
  $("presets").innerHTML = PRESETS.map(
    (preset) => `<button type="button" data-preset="${preset.id}">${preset.label}</button>`,
  ).join("");

  $("presets").addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-preset]");
    if (!target) return;

    const preset = PRESETS.find((p) => p.id === target.dataset.preset);
    if (!preset) return;

    state.network = { ...preset.network };
    state.connection = { ...preset.connection };

    $("presets")
      .querySelectorAll("button")
      .forEach((button) => button.classList.toggle("active", button === target));
    $("preset-hint").textContent = preset.hint;

    syncInputsFromState();
    render();
  });
}

/** The mirror: the same renderer, fed by what the browser actually measured. */
function renderObserved(): void {
  const requests = collectRequests({ ignore: (url) => url.startsWith("data:") });
  const summary = summarize(requests);

  if (requests.length === 0) {
    $("observed-note").textContent = "No resource timings recorded yet.";
    return;
  }

  const spans = requests.flatMap((request) => request.spans);
  $("observed").innerHTML = renderWaterfall({ spans });

  const protocols = Object.entries(summary.protocols)
    .map(([name, count]) => `${name} ×${count}`)
    .join(", ");

  const opaqueNote =
    summary.opaque > 0
      ? ` ${summary.opaque} cross-origin ${summary.opaque === 1 ? "response" : "responses"} withheld phase timings — no Timing-Allow-Origin header, so the browser reports only a total.`
      : "";

  $("observed-note").textContent =
    `${summary.requests} requests, ${(summary.totalTransferBytes / 1024).toFixed(0)}KB transferred, ${summary.cached} from cache. Protocols: ${protocols}.${opaqueNote}`;
}

$("legend").innerHTML = renderLegend();
wireControls();
wirePresets();
syncInputsFromState();
$("preset-hint").textContent = PRESETS[1]!.hint;
render();

// Wait for the load event so the timing buffer holds the whole page.
if (document.readyState === "complete") renderObserved();
else window.addEventListener("load", () => setTimeout(renderObserved, 0));
