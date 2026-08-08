import type { PhaseName, Span } from "@page-load-anatomy/core";

/**
 * Draws a set of spans as a waterfall. Deliberately shared between the simulated
 * timeline and the observed one — if predicted and measured requests were drawn
 * by different code they would not be comparable, which is the whole point.
 */

export const PHASE_COLORS: Record<PhaseName, string> = {
  queued: "#7c8598",
  dns: "#a78bfa",
  tcp: "#60a5fa",
  tls: "#34d399",
  request: "#fbbf24",
  "ttfb-wait": "#fbbf24",
  download: "#f472b6",
  parse: "#94a3b8",
  render: "#fb7185",
};

export const PHASE_LABELS: Record<PhaseName, string> = {
  queued: "Queued",
  dns: "DNS",
  tcp: "TCP",
  tls: "TLS",
  request: "Request",
  "ttfb-wait": "Waiting (TTFB)",
  download: "Download",
  parse: "Parse",
  render: "Render",
};

/** Phases shown in the legend, in the order they occur on the wire. */
export const LEGEND_ORDER: PhaseName[] = ["queued", "dns", "tcp", "tls", "ttfb-wait", "download", "parse", "render"];

export interface Marker {
  label: string;
  atMs: number;
}

export interface WaterfallOptions {
  spans: Span[];
  markers?: Marker[];
  /** Fix the horizontal scale so two waterfalls can be compared honestly. */
  scaleMs?: number;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function renderWaterfall({ spans, markers = [], scaleMs }: WaterfallOptions): string {
  if (spans.length === 0) {
    return `<p class="empty">No spans to draw yet.</p>`;
  }

  const end = scaleMs ?? Math.max(...spans.map((s) => s.endMs));
  const scale = Math.max(end, 1);

  // Group by resource, preserving the order each first appears.
  const order: string[] = [];
  const byResource = new Map<string, Span[]>();
  for (const span of spans) {
    if (!byResource.has(span.resource)) {
      byResource.set(span.resource, []);
      order.push(span.resource);
    }
    byResource.get(span.resource)!.push(span);
  }

  const rows = order
    .map((resource) => {
      const bars = byResource
        .get(resource)!
        .map((span) => {
          const left = (span.startMs / scale) * 100;
          const width = Math.max(((span.endMs - span.startMs) / scale) * 100, 0.3);
          const tip = `${PHASE_LABELS[span.phase]} — ${(span.endMs - span.startMs).toFixed(0)}ms\n${span.note}`;
          return `<span class="bar" style="left:${left}%;width:${width}%;background:${PHASE_COLORS[span.phase]}" data-tip="${escapeHtml(tip)}" tabindex="0" role="img" aria-label="${escapeHtml(tip)}"></span>`;
        })
        .join("");

      return `
        <div class="wf-row">
          <span class="wf-name" title="${escapeHtml(resource)}">${escapeHtml(resource)}</span>
          <span class="wf-track">${bars}</span>
        </div>`;
    })
    .join("");

  const markerEls = markers
    .map((marker) => {
      const left = (marker.atMs / scale) * 100;
      if (left > 100) return "";
      return `<span class="wf-marker" style="left:${left}%"><span class="wf-marker-label">${escapeHtml(marker.label)} ${marker.atMs.toFixed(0)}ms</span></span>`;
    })
    .join("");

  return `
    <div class="wf">
      <div class="wf-rows">${rows}</div>
      <div class="wf-markers">${markerEls}</div>
      <div class="wf-axis"><span>0</span><span>${(scale / 2).toFixed(0)}ms</span><span>${scale.toFixed(0)}ms</span></div>
    </div>`;
}

export function renderLegend(): string {
  return LEGEND_ORDER.map(
    (phase) =>
      `<span class="legend-item"><i style="background:${PHASE_COLORS[phase]}"></i>${PHASE_LABELS[phase]}</span>`,
  ).join("");
}
