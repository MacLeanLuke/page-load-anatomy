/**
 * Where the panel sits, and whether it is tucked away.
 *
 * Persisted because a panel you dismissed should stay dismissed across
 * navigations. Nothing here touches the network; it is all localStorage.
 */

export type Edge = "left" | "right";

export interface PanelState {
  /** Docked to an edge as a small tab. */
  minimized: boolean;
  /** Which side it lives on. */
  edge: Edge;
  /** Vertical position as a fraction of the viewport, 0 = top. */
  y: number;
  /** Body expanded when not minimized. */
  open: boolean;
}

export const DEFAULT_STATE: PanelState = {
  // Starts docked. A diagnostic panel should not cover the host app's content
  // the first time someone loads the page — it should be available, not present.
  minimized: true,
  edge: "right",
  y: 0.72,
  open: false,
};

const KEY = "pipe-anatomy:panel:v1";

export function loadState(): PanelState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<PanelState>;
    return {
      minimized: typeof parsed.minimized === "boolean" ? parsed.minimized : DEFAULT_STATE.minimized,
      edge: parsed.edge === "left" || parsed.edge === "right" ? parsed.edge : DEFAULT_STATE.edge,
      y: typeof parsed.y === "number" && parsed.y >= 0 && parsed.y <= 1 ? parsed.y : DEFAULT_STATE.y,
      open: typeof parsed.open === "boolean" ? parsed.open : DEFAULT_STATE.open,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveState(state: PanelState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage disabled or full. The panel still works for this session.
  }
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Decides where a drag ends up.
 *
 * Panels always settle against the nearer side rather than floating mid-screen,
 * which keeps them out of the reading column. Dragging far enough toward an edge
 * tucks the panel away entirely — the gesture people already know from dragging
 * a video call's self-view off to the side.
 */
export function resolveDrop(
  left: number,
  top: number,
  width: number,
  viewportWidth: number,
  viewportHeight: number,
): { edge: Edge; y: number; minimized: boolean } {
  const centre = left + width / 2;
  const edge: Edge = centre < viewportWidth / 2 ? "left" : "right";

  // How much of the panel has been pushed past the edge it is nearest to.
  const offscreen = edge === "left" ? Math.max(0, -left) : Math.max(0, left + width - viewportWidth);
  const minimized = offscreen > width * 0.35;

  return {
    edge,
    y: clamp(top / Math.max(viewportHeight, 1), 0, 1),
    minimized,
  };
}
