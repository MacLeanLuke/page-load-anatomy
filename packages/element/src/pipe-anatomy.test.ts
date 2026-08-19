// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PipeAnatomy, definePipeAnatomy } from "./pipe-anatomy";

/**
 * jsdom has no PerformanceObserver, which is exactly the condition the element
 * must survive: it is meant to be dropped into arbitrary pages, including ones
 * where the API is missing or blocked.
 */

describe("definePipeAnatomy", () => {
  it("registers the element", () => {
    definePipeAnatomy();
    expect(customElements.get("pipe-anatomy")).toBe(PipeAnatomy);
  });

  it("is idempotent — a second call must not throw", () => {
    definePipeAnatomy();
    expect(() => definePipeAnatomy()).not.toThrow();
  });
});

describe("mounting", () => {
  beforeEach(() => {
    definePipeAnatomy();
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("mounts as a docked tab, not a panel covering the host page", () => {
    const element = document.createElement("pipe-anatomy");
    document.body.appendChild(element);

    expect(element.shadowRoot).not.toBeNull();
    expect(element.shadowRoot!.querySelector(".tab")).not.toBeNull();
    expect(element.shadowRoot!.querySelector(".panel")).toBeNull();
  });

  it("opens as a panel when the open attribute is set", () => {
    const element = document.createElement("pipe-anatomy");
    element.setAttribute("open", "");
    document.body.appendChild(element);

    expect(element.shadowRoot!.querySelector(".panel")).not.toBeNull();
    expect(element.shadowRoot!.querySelector(".body")!.hasAttribute("hidden")).toBe(false);
  });

  it("keeps its styles inside the shadow root, not the host page", () => {
    const element = document.createElement("pipe-anatomy");
    document.body.appendChild(element);

    expect(element.shadowRoot!.querySelector("style")).not.toBeNull();
    expect(document.head.querySelector("style")).toBeNull();
  });

  it("restores to a panel and tucks away again", () => {
    const element = document.createElement("pipe-anatomy") as PipeAnatomy;
    document.body.appendChild(element);

    expect(element.minimized).toBe(true);

    element.restore();
    expect(element.minimized).toBe(false);
    expect(element.shadowRoot!.querySelector(".panel")).not.toBeNull();

    element.minimize();
    expect(element.minimized).toBe(true);
    expect(element.shadowRoot!.querySelector(".tab")).not.toBeNull();
  });

  it("remembers being tucked away across mounts", () => {
    const first = document.createElement("pipe-anatomy") as PipeAnatomy;
    document.body.appendChild(first);
    first.restore();
    first.remove();

    // A panel someone opened should still be open on the next page.
    const second = document.createElement("pipe-anatomy") as PipeAnatomy;
    document.body.appendChild(second);
    expect(second.minimized).toBe(false);

    second.minimize();
    second.remove();

    const third = document.createElement("pipe-anatomy") as PipeAnatomy;
    document.body.appendChild(third);
    expect(third.minimized).toBe(true);
  });

  it("anchors itself to an edge so it never floats mid-screen", () => {
    const element = document.createElement("pipe-anatomy");
    document.body.appendChild(element);
    expect(["left", "right"]).toContain(element.getAttribute("data-edge"));
  });

  it("exposes a minimise control on the panel", () => {
    const element = document.createElement("pipe-anatomy") as PipeAnatomy;
    element.setAttribute("open", "");
    document.body.appendChild(element);

    const button = element.shadowRoot!.querySelector<HTMLButtonElement>("[data-minimize]");
    expect(button).not.toBeNull();
    button!.dispatchEvent(new Event("click"));
    expect(element.minimized).toBe(true);
  });

  it("honours the limit attribute", () => {
    const element = document.createElement("pipe-anatomy") as PipeAnatomy;
    element.setAttribute("limit", "5");
    document.body.appendChild(element);
    expect(element.limit).toBe(5);
  });

  it("shows an empty state rather than a broken chart when nothing has loaded", () => {
    const element = document.createElement("pipe-anatomy");
    element.setAttribute("open", "");
    document.body.appendChild(element);
    expect(element.shadowRoot!.querySelector(".empty")?.textContent).toContain("Waiting for requests");
  });

  it("disconnects cleanly", () => {
    const element = document.createElement("pipe-anatomy");
    document.body.appendChild(element);
    expect(() => element.remove()).not.toThrow();
  });
});

describe("escaping", () => {
  beforeEach(() => {
    definePipeAnatomy();
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("does not execute markup coming from a request URL", () => {
    const element = document.createElement("pipe-anatomy") as PipeAnatomy;
    element.setAttribute("open", "");
    document.body.appendChild(element);

    // Request names come from the network, so they are untrusted input.
    const injected = "<img src=x onerror=alert(1)>";
    // @ts-expect-error — reaching into the private buffer to simulate an observed request.
    element["#requests"] = undefined;
    const spy = vi.spyOn(console, "error");
    element.setAttribute("limit", "10");
    expect(spy).not.toHaveBeenCalled();
    expect(element.shadowRoot!.innerHTML).not.toContain(injected);
    spy.mockRestore();
  });
});
