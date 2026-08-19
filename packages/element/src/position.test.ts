// @vitest-environment node
import { describe, expect, it } from "vitest";
import { clamp, resolveDrop } from "./position";

const W = 400;
const VW = 1000;
const VH = 800;

describe("clamp", () => {
  it("bounds a value", () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
  });
});

describe("resolveDrop", () => {
  it("settles against the left edge when dropped on the left half", () => {
    expect(resolveDrop(40, 100, W, VW, VH).edge).toBe("left");
  });

  it("settles against the right edge when dropped on the right half", () => {
    expect(resolveDrop(560, 100, W, VW, VH).edge).toBe("right");
  });

  it("stays open when dropped fully on screen", () => {
    expect(resolveDrop(40, 100, W, VW, VH).minimized).toBe(false);
    expect(resolveDrop(560, 100, W, VW, VH).minimized).toBe(false);
  });

  it("tucks away when dragged far enough off the left", () => {
    // 200 of 400 pushed past the edge — more than the 35% threshold.
    expect(resolveDrop(-200, 100, W, VW, VH).minimized).toBe(true);
  });

  it("tucks away when dragged far enough off the right", () => {
    expect(resolveDrop(VW - 200, 100, W, VW, VH).minimized).toBe(true);
  });

  it("does not tuck away on a small nudge past the edge", () => {
    // 40 of 400 is 10%, well under the threshold — a slip, not an intent.
    expect(resolveDrop(-40, 100, W, VW, VH).minimized).toBe(false);
  });

  it("records vertical position as a viewport fraction", () => {
    expect(resolveDrop(40, 400, W, VW, VH).y).toBeCloseTo(0.5, 6);
  });

  it("keeps the vertical fraction inside the viewport", () => {
    expect(resolveDrop(40, -200, W, VW, VH).y).toBe(0);
    expect(resolveDrop(40, 5000, W, VW, VH).y).toBe(1);
  });

  it("survives a zero-height viewport without dividing by zero", () => {
    expect(Number.isFinite(resolveDrop(40, 100, W, VW, 0).y)).toBe(true);
  });
});
