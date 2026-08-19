// Side-effect entry point: registering on import is what makes the script-tag
// and bookmarklet builds a one-liner.
import { definePipeAnatomy } from "./pipe-anatomy";

definePipeAnatomy();

if (typeof document !== "undefined" && !document.querySelector("pipe-anatomy")) {
  // Mounted without `open`, so it arrives docked as a small tab against the
  // edge. A diagnostic panel should be available on the host page, not sitting
  // on top of the content the host page exists to show.
  document.body.appendChild(document.createElement("pipe-anatomy"));
}
