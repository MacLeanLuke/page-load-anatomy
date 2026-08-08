// Side-effect entry point: registering on import is what makes the script-tag
// and bookmarklet builds a one-liner.
import { definePipeAnatomy } from "./pipe-anatomy";

definePipeAnatomy();

if (typeof document !== "undefined" && !document.querySelector("pipe-anatomy")) {
  const element = document.createElement("pipe-anatomy");
  element.setAttribute("open", "");
  document.body.appendChild(element);
}
