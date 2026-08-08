import { toObservedRequest, type ObservedRequest, type ResourceTimingLike } from "./resource-timing";

export * from "./resource-timing";

export interface ObserveOptions {
  /** Skip requests whose URL matches. Useful for ignoring your own telemetry. */
  ignore?: (url: string) => boolean;
  /** Replay entries already recorded before the observer started. Default true. */
  includeExisting?: boolean;
}

export interface Observation {
  stop: () => void;
}

/**
 * Subscribes to resource timings as they happen.
 *
 * `buffered: true` matters more than it looks — a PerformanceObserver created
 * after page load would otherwise miss every request the page has already made,
 * which is most of them.
 */
export function observeRequests(
  onRequest: (request: ObservedRequest) => void,
  options: ObserveOptions = {},
): Observation {
  const { ignore, includeExisting = true } = options;

  if (typeof PerformanceObserver === "undefined") {
    return { stop: () => {} };
  }

  const emit = (entry: ResourceTimingLike) => {
    if (ignore?.(entry.name)) return;
    onRequest(toObservedRequest(entry));
  };

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      emit(entry as unknown as ResourceTimingLike);
    }
  });

  observer.observe({ type: "resource", buffered: includeExisting });

  return { stop: () => observer.disconnect() };
}

/** One-shot read of everything recorded so far. */
export function collectRequests(options: Pick<ObserveOptions, "ignore"> = {}): ObservedRequest[] {
  if (typeof performance === "undefined" || !performance.getEntriesByType) return [];

  return performance
    .getEntriesByType("resource")
    .map((entry) => entry as unknown as ResourceTimingLike)
    .filter((entry) => !options.ignore?.(entry.name))
    .map(toObservedRequest);
}

/**
 * Navigation timing for the document itself, which is a different entry type
 * from the subresources above.
 */
export function collectNavigation(): ObservedRequest | null {
  if (typeof performance === "undefined" || !performance.getEntriesByType) return null;

  const [entry] = performance.getEntriesByType("navigation");
  if (!entry) return null;

  return toObservedRequest(entry as unknown as ResourceTimingLike);
}
