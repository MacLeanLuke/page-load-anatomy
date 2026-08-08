import { defineConfig } from "vite";

// A self-contained IIFE build: one file, no imports, registers itself on load.
// This is what makes the element droppable into any project — and it doubles as
// the bookmarklet payload.
export default defineConfig({
  build: {
    lib: {
      entry: "src/auto.ts",
      name: "PipeAnatomy",
      formats: ["iife"],
      fileName: () => "pipe-anatomy.global.js",
    },
    outDir: "dist",
    emptyOutDir: true,
    minify: "esbuild",
  },
});
