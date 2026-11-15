// Bundles the pure local algorithm layers (src/analysis.ts, src/tidy-plan.ts — no
// Obsidian runtime imports) into standalone ESM files the local MCP server can import. No network, no model.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");

// tidy-plan imports ./analysis; keep it external pointing at the sibling bundle so the analysis
// code is emitted once (in analysis.mjs) instead of being inlined into tidy-plan.mjs as well.
const externalizeAnalysis = {
  name: "externalize-analysis",
  setup(build) {
    build.onResolve({ filter: /^\.\/analysis$/ }, () => ({
      path: "./analysis.mjs",
      external: true
    }));
  }
};

await build({
  entryPoints: [
    join(src, "analysis.ts"),
    join(src, "tidy-plan.ts")
  ],
  bundle: true,
  splitting: false,
  format: "esm",
  platform: "node",
  target: "node20",
  outdir: here,
  outExtension: { ".js": ".mjs" },
  plugins: [externalizeAnalysis]
});

console.log("built mcp/analysis.mjs and mcp/tidy-plan.mjs");
