// Bundles the whole MCP server (server.mjs -> vault.mjs -> analysis.mjs/tidy-plan.mjs)
// into ONE self-contained ESM file with zero npm dependencies — only Node built-ins remain external.
// Run mcp:build first so analysis.mjs/tidy-plan.mjs exist. Kept unminified so users can audit what runs locally.
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const outfile = join(here, "dist", "qynote-mcp.mjs");
await mkdir(dirname(outfile), { recursive: true });

const result = await build({
  entryPoints: [join(here, "server.mjs")],
  outfile,
  bundle: true,
  splitting: false,
  format: "esm",
  platform: "node",
  target: "node20",
  minify: false,
  sourcemap: false,
  legalComments: "eof",
  banner: {
    js: [
      "// QYNote Compilation MCP — self-contained, local-only tool surface.",
      "// No network, no language model, no keys. Writes are gated: preview_*/propose_plan -> apply_change -> undo_last.",
      "// Run: VAULT_PATH=/absolute/path/to/your/vault node qynote-mcp.mjs   (Node >= 20)",
      "// Regenerate from source with: npm run mcp:dist"
    ].join("\n")
  },
  metafile: true
});

const outputs = Object.keys(result.metafile.outputs);
const externalImports = Object.values(result.metafile.outputs)
  .flatMap((output) => output.imports)
  .filter((imp) => imp.external && !imp.path.startsWith("node:"));
console.log(`built ${outfile}`);
console.log(`outputs: ${outputs.join(", ")}`);
if (externalImports.length) {
  console.error(`WARNING: non-builtin external imports remain: ${JSON.stringify(externalImports)}`);
  process.exitCode = 1;
} else {
  console.log("self-contained: only node: built-ins are external (zero npm dependencies).");
}
