import { observeRequests, summarize, type ObservedRequest } from "@page-load-anatomy/observe";
import type { PhaseName } from "@page-load-anatomy/core";
import { loadState, resolveDrop, saveState, clamp, type PanelState } from "./position";

/**
 * <pipe-anatomy> — a live dissection of every request the host page makes.
 *
 * A custom element rather than a framework component so it drops into Next.js,
 * Astro, Vite, or a bare script tag unchanged. Shadow DOM keeps the host page's
 * CSS out, which matters when the point of the panel is to be embedded in six
 * different apps.
 *
 *   <pipe-anatomy></pipe-anatomy>
 *   <pipe-anatomy open limit="40"></pipe-anatomy>
 */

const PHASE_COLORS: Record<PhaseName, string> = {
  queued: "#8b8f98",
  dns: "#c084fc",
  tcp: "#60a5fa",
  tls: "#34d399",
  request: "#fbbf24",
  "ttfb-wait": "#fbbf24",
  download: "#f472b6",
  parse: "#a3a3a3",
  render: "#f87171",
};

const PHASE_LABELS: Record<PhaseName, string> = {
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

const STYLES = `
  :host {
    --bg: #12141a;
    --panel: #1a1d26;
    --ink: #e8eaf0;
    --muted: #9aa0ad;
    --rule: #2a2f3a;
    all: initial;
    position: fixed;
    z-index: 2147483000;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    color: var(--ink);
  }
  * { box-sizing: border-box; }
  .panel {
    width: min(460px, calc(100vw - 32px));
    background: var(--bg);
    border: 1px solid var(--rule);
    border-radius: 8px;
    box-shadow: 0 12px 40px rgba(0,0,0,.45);
    overflow: hidden;
  }
  header {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px;
    background: var(--panel);
    border-bottom: 1px solid var(--rule);
    cursor: grab;
    user-select: none;
    touch-action: none;
  }
  header:active { cursor: grabbing; }
  .grip { color: var(--muted); letter-spacing: -2px; font-size: 14px; }
  .icon-btn {
    display: grid; place-items: center;
    width: 22px; height: 22px; padding: 0;
    border: 0; border-radius: 4px;
    background: transparent; color: var(--muted);
    font-size: 15px; line-height: 1; cursor: pointer;
  }
  .icon-btn:hover { background: rgba(127,127,127,.18); color: var(--ink); }

  /* Docked tab — the panel tucked against an edge. */
  .tab {
    display: flex; align-items: center; justify-content: center;
    width: 34px; height: 46px;
    background: var(--panel);
    border: 1px solid var(--rule);
    color: var(--muted);
    cursor: grab;
    touch-action: none;
    box-shadow: 0 6px 20px rgba(0,0,0,.3);
  }
  .tab:hover { color: var(--ink); }
  .tab:active { cursor: grabbing; }
  :host([data-edge="right"]) .tab { border-radius: 8px 0 0 8px; border-right: 0; }
  :host([data-edge="left"]) .tab { border-radius: 0 8px 8px 0; border-left: 0; }
  .tab svg { display: block; }
  header h2 { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: .02em; }
  .stats { margin-left: auto; color: var(--muted); font-size: 11px; }
  .body { max-height: 320px; overflow-y: auto; }
  .body[hidden] { display: none; }
  .row { display: grid; grid-template-columns: 120px 1fr; gap: 8px; align-items: center; padding: 3px 10px; }
  .row:hover { background: rgba(255,255,255,.04); }
  .name { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .track { position: relative; height: 12px; background: rgba(255,255,255,.05); border-radius: 2px; }
  .bar { position: absolute; top: 0; height: 100%; min-width: 2px; border-radius: 2px; }
  .opaque { color: #f59e0b; font-size: 10px; padding: 0 10px 4px 138px; }
  .legend { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 10px; border-top: 1px solid var(--rule); background: var(--panel); }
  .legend span { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); font-size: 10px; }
  .swatch { width: 8px; height: 8px; border-radius: 2px; }
  .empty { padding: 16px 10px; color: var(--muted); }
  @media (prefers-color-scheme: light) {
    :host { --bg: #ffffff; --panel: #f4f5f8; --ink: #14161c; --muted: #5b6270; --rule: #d9dde5; }
  }
`;

export class PipeAnatomy extends HTMLElement {
  static observedAttributes = ["open", "limit"];

  #requests: ObservedRequest[] = [];
  #observation: { stop: () => void } | null = null;
  #frame = 0;
  #root: ShadowRoot;
  #state: PanelState;
  #drag: { pointerId: number; offsetX: number; offsetY: number; moved: boolean } | null = null;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
    this.#state = loadState();
    // An explicit `open` attribute is a deliberate request to show the panel,
    // so it overrides whatever was stored from a previous visit.
    if (this.hasAttribute("open")) {
      this.#state.minimized = false;
      this.#state.open = true;
    }
  }

  get limit(): number {
    return Number(this.getAttribute("limit") ?? "30");
  }

  get open(): boolean {
    return !this.#state.minimized && this.#state.open;
  }

  get minimized(): boolean {
    return this.#state.minimized;
  }

  connectedCallback(): void {
    this.#render();

    this.#observation = observeRequests((request) => {
      this.#requests.push(request);
      // Coalesce bursts — a page load can fire dozens of entries in one tick.
      if (this.#frame) return;
      this.#frame = requestAnimationFrame(() => {
        this.#frame = 0;
        this.#render();
      });
    });
  }

  disconnectedCallback(): void {
    this.#observation?.stop();
    if (this.#frame) cancelAnimationFrame(this.#frame);
  }

  attributeChangedCallback(name: string): void {
    if (name === "open" && this.hasAttribute("open")) {
      this.#state.minimized = false;
      this.#state.open = true;
    }
    this.#render();
  }

  /** Tuck the panel against its current edge. */
  minimize(): void {
    this.#update({ minimized: true });
  }

  /** Pull it back into view. */
  restore(): void {
    this.#update({ minimized: false, open: true });
  }

  #update(patch: Partial<PanelState>): void {
    this.#state = { ...this.#state, ...patch };
    saveState(this.#state);
    this.#render();
  }

  /** Position the host itself, so the panel and the docked tab share one anchor. */
  #applyPosition(): void {
    const { edge, y, minimized } = this.#state;
    const height = minimized ? 46 : 260;
    const top = clamp(y * window.innerHeight, 8, Math.max(8, window.innerHeight - height - 8));

    this.setAttribute("data-edge", edge);
    this.style.top = `${top}px`;
    if (edge === "left") {
      this.style.left = minimized ? "0px" : "16px";
      this.style.right = "auto";
    } else {
      this.style.right = minimized ? "0px" : "16px";
      this.style.left = "auto";
    }
  }

  #beginDrag(event: PointerEvent, handle: HTMLElement): void {
    const rect = this.getBoundingClientRect();
    this.#drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  #onDragMove = (event: PointerEvent): void => {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const left = event.clientX - drag.offsetX;
    const top = event.clientY - drag.offsetY;
    if (Math.abs(event.movementX) + Math.abs(event.movementY) > 0) drag.moved = true;

    // Follow the pointer exactly while dragging; snapping happens on release.
    this.style.left = `${left}px`;
    this.style.right = "auto";
    this.style.top = `${top}px`;
  };

  #onDragEnd = (event: PointerEvent): void => {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.#drag = null;

    const rect = this.getBoundingClientRect();
    const drop = resolveDrop(rect.left, rect.top, rect.width, window.innerWidth, window.innerHeight);

    // A click that never moved is a click, not a drag — let it toggle instead.
    if (!drag.moved) {
      this.#update(this.#state.minimized ? { minimized: false, open: true } : { open: !this.#state.open });
      return;
    }

    this.#update(drop);
  };

  #render(): void {
    this.#applyPosition();
    this.#root.innerHTML = this.#state.minimized ? this.#tabMarkup() : this.#panelMarkup();
    this.#wire();
  }

  #tabMarkup(): string {
    const count = this.#requests.length;
    return `
      <style>${STYLES}</style>
      <div class="tab" part="tab" role="button" tabindex="0"
           title="Pipe anatomy — ${count} request${count === 1 ? "" : "s"}. Click to open, drag to move.">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <rect x="1" y="3"  width="9"  height="2" rx="1" fill="currentColor" opacity=".55"/>
          <rect x="4" y="7"  width="10" height="2" rx="1" fill="currentColor"/>
          <rect x="2" y="11" width="7"  height="2" rx="1" fill="currentColor" opacity=".55"/>
        </svg>
        <span class="visually-hidden" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Open pipe anatomy</span>
      </div>`;
  }

  #panelMarkup(): string {
    const shown = this.#requests.slice(-this.limit);
    const summary = summarize(this.#requests);

    // Scale every bar against the same window so rows are comparable.
    const start = shown.length ? Math.min(...shown.map((r) => r.startMs)) : 0;
    const end = shown.length ? Math.max(...shown.map((r) => r.startMs + r.durationMs)) : 1;
    const span = Math.max(end - start, 1);

    const bytes =
      summary.totalTransferBytes > 1024 * 1024
        ? `${(summary.totalTransferBytes / 1024 / 1024).toFixed(1)}MB`
        : `${Math.round(summary.totalTransferBytes / 1024)}KB`;

    const protocols = Object.entries(summary.protocols)
      .map(([name, count]) => `${name}×${count}`)
      .join(" ");

    const rows = shown
      .map((request) => {
        const bars = request.spans
          .map((s) => {
            const left = ((s.startMs - start) / span) * 100;
            const width = ((s.endMs - s.startMs) / span) * 100;
            const title = `${PHASE_LABELS[s.phase]} — ${(s.endMs - s.startMs).toFixed(1)}ms\n${s.note}`;
            return `<div class="bar" style="left:${left}%;width:${width}%;background:${PHASE_COLORS[s.phase]}" title="${escapeAttr(title)}"></div>`;
          })
          .join("");

        const opaqueNote = request.timingsVisible
          ? ""
          : `<div class="opaque">no Timing-Allow-Origin — phases withheld by the browser</div>`;

        return `
          <div class="row" title="${escapeAttr(request.url)}">
            <span class="name">${escapeHtml(request.name)}</span>
            <div class="track">${bars}</div>
          </div>${opaqueNote}`;
      })
      .join("");

    const legend = (["dns", "tcp", "tls", "ttfb-wait", "download", "queued"] as PhaseName[])
      .map(
        (phase) =>
          `<span><i class="swatch" style="background:${PHASE_COLORS[phase]}"></i>${PHASE_LABELS[phase]}</span>`,
      )
      .join("");

    return `
      <style>${STYLES}</style>
      <div class="panel">
        <header part="header">
          <span class="grip" aria-hidden="true">⋮⋮</span>
          <h2>Pipe anatomy</h2>
          <span class="stats">${summary.requests} req · ${bytes}${protocols ? ` · ${protocols}` : ""}</span>
          <button class="icon-btn" data-minimize type="button" title="Tuck away" aria-label="Minimise panel">–</button>
        </header>
        <div class="body" ${this.#state.open ? "" : "hidden"}>
          ${shown.length ? rows : `<div class="empty">Waiting for requests…</div>`}
          <div class="legend">${legend}</div>
        </div>
      </div>`;
  }

  #wire(): void {
    const handle = this.#root.querySelector<HTMLElement>("header, .tab");
    if (!handle) return;

    handle.addEventListener("pointerdown", (event) => this.#beginDrag(event as PointerEvent, handle));
    handle.addEventListener("pointermove", this.#onDragMove);
    handle.addEventListener("pointerup", this.#onDragEnd);
    handle.addEventListener("pointercancel", this.#onDragEnd);

    handle.addEventListener("keydown", (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === "Enter" || key === " ") {
        event.preventDefault();
        this.#state.minimized ? this.restore() : this.minimize();
      }
    });

    this.#root.querySelector<HTMLButtonElement>("[data-minimize]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      this.minimize();
    });
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

export function definePipeAnatomy(tagName = "pipe-anatomy"): void {
  if (typeof customElements !== "undefined" && !customElements.get(tagName)) {
    customElements.define(tagName, PipeAnatomy);
  }
}
