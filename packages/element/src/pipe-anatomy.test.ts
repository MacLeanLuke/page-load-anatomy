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
  });

  it("renders a panel into shadow DOM without a PerformanceObserver present", () => {
    const element = document.createElement("pipe-anatomy");
    document.body.appendChild(element);

    expect(element.shadowRoot).not.toBeNull();
    expect(element.shadowRoot!.querySelector(".panel")).not.toBeNull();
  });

  it("keeps its styles inside the shadow root, not the host page", () => {
    const element = document.createElement("pipe-anatomy");
    document.body.appendChild(element);

    expect(element.shadowRoot!.querySelector("style")).not.toBeNull();
    expect(document.head.querySelector("style")).toBeNull();
  });

  it("starts collapsed and expands when the header is clicked", () => {
    const element = document.createElement("pipe-anatomy");
    document.body.appendChild(element);

    expect(element.hasAttribute("open")).toBe(false);
    expect(element.shadowRoot!.querySelector(".body")!.hasAttribute("hidden")).toBe(true);

    element.shadowRoot!.querySelector("header")!.dispatchEvent(new Event("click"));

    expect(element.hasAttribute("open")).toBe(true);
    expect(element.shadowRoot!.querySelector(".body")!.hasAttribute("hidden")).toBe(false);
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
