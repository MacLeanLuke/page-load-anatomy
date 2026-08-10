# Page Load Anatomy

A dissectible model of what actually happens between typing a URL and seeing pixels.

**Live demo: [page-load-anatomy.vercel.app](https://page-load-anatomy.vercel.app)**

Pull out a layer — DNS, TCP, TLS, HTTP, the render path — see it working on its
own, then change one thing and watch what moves downstream.

## Why a simulator and not an animation

There are plenty of pretty "how the internet works" diagrams. They animate a
packet flying across a wire and teach nothing you can act on, because the numbers
are decorative.

This is a **deterministic model with real protocol arithmetic**, and it has tests
asserting the model matches the specs. When it says a cold HTTP/1.1 + TLS 1.2
connection spends seven round trips before the first byte of HTML, that number
comes from counting the actual flights:

| | Round trips |
| --- | --- |
| DNS, cold (root → TLD → authoritative) | 4 |
| TCP three-way handshake | 1 |
| TLS 1.2 full handshake | 2 |
| **Before the request even goes out** | **7** |

Switch to HTTP/3 with 0-RTT resumption and a warm DNS cache and that becomes **0**.
On a 100ms link that is 380ms of pure setup you either pay or don't — and no
amount of shrinking your JavaScript touches it.

## What you can change

| Lever | Why it's interesting |
| --- | --- |
| RTT | The dominant cost for most pages. Latency, not bandwidth |
| Bandwidth | Matters far less than people expect until payloads get large |
| Packet loss | Punishes big transfers disproportionately |
| DNS state | Cold, resolver-cached, or browser-cached — 4 / 1 / 0 round trips |
| TLS mode | 1.2 full, 1.3 full, 1.3 resumed, 1.3 0-RTT |
| HTTP version | 1.1's six-connection limit vs. multiplexed h2/h3 |
| CDN | Shortens every round trip, which compounds across the handshake |
| Resource mix | Count, size, render-blocking, discovered-after-parse |

## Things the model makes obvious

Each of these is an assertion in the test suite, not a claim in a README:

- **The first 14.6KB is special.** TCP's initial congestion window is 10 segments
  at a 1460-byte MSS. Anything inside it arrives in one round trip; one byte over
  costs a second.
- **A CDN beats halving your HTML.** Cutting the document from 12KB to 6KB changes
  nothing when both fit the first window — but shortening every round trip changes
  everything.
- **Bandwidth barely matters for small pages.** Drop from 1000Mbps to 5Mbps on an
  8KB page and it costs under 20ms. Triple the RTT and it more than doubles.
- **HTTP/1.1 queues.** Thirteen assets over six connections stack up; the same page
  over HTTP/2 doesn't queue at all.
- **HTTP/3 saves exactly one round trip** over HTTP/2 — QUIC folds the transport and
  crypto handshakes together.

## Two halves: predict, and observe

The distinction matters, because they answer different questions.

**`core` predicts.** Give it network conditions and a connection config, get a
waterfall back. Good for "what would this cost on 3G from Sydney with a cold DNS
cache?"

**`observe` reports.** The browser already dissects every real request for you —
`PerformanceResourceTiming` exposes `domainLookupStart/End`, `connectStart/End`,
`secureConnectionStart`, `requestStart`, `responseStart`, `responseEnd`. Almost
nobody looks. This turns those entries into the same span shape the simulator
produces, so a measured request and a predicted one can be drawn by the same
component and compared directly.

It also handles the thing naive implementations get wrong: a cross-origin
response without `Timing-Allow-Origin` has **every phase timing zeroed**. Drawing
that as zero-length bars implies the request was instant, which is the opposite
of what it means. Those entries are flagged as opaque instead.

## Embedding it in another project

`<pipe-anatomy>` is a custom element, not a framework component, so it drops into
Next.js, Astro, Vite, or a plain `<script>` tag unchanged. Shadow DOM keeps the
host page's CSS out.

```html
<script type="module">
  import { definePipeAnatomy } from "@page-load-anatomy/element";
  definePipeAnatomy();
</script>

<pipe-anatomy open limit="40"></pipe-anatomy>
```

Or the one-liner, which registers the element and mounts it for you:

```js
import "@page-load-anatomy/element/auto";
```

The panel then shows every request the host app makes, live — phases, negotiated
protocol, transfer size, cache hits.

## Layout

```
packages/
  core/      protocol arithmetic. No UI, no network, no dependencies
  observe/   real timings from PerformanceObserver, same span shape as core
  element/   <pipe-anatomy> custom element
```

`core` is a pure function from configuration to a timeline, which is what makes
it testable — and what makes the visualization trustworthy.

## Commands

```bash
npm install
npm test        # 58 tests across core, observe and element
npm run typecheck
```

## Roadmap

1. **The model** — done, and tested.
2. **The cutaway** — an interactive waterfall with the levers above, where every
   span explains where its number came from.
3. **The AI layer.** Once the pipe is legible, an LLM request becomes the most
   interesting thing you can push through it: time-to-first-token instead of TTFB,
   a response that streams for seconds over SSE, and a request payload that grows
   every turn because the whole conversation is resent. Those properties are
   genuinely unusual, and they're only *visible* against a baseline of how normal
   requests behave.

That order is deliberate. Bolting AI onto a black box teaches nothing; putting it
into a model you can already read shows exactly why it behaves unlike anything
else on the wire.
