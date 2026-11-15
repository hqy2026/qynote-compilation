// Proves the distributable is truly self-contained: copy ONLY dist/qynote-mcp.mjs into an
// empty directory (no node_modules, no src, no sibling files), then drive it over stdio JSON-RPC
// exactly like an MCP client would. Requires `npm run mcp:dist` (build) to have produced the bundle.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, readFile, rm, copyFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const distFile = join(here, "dist", "qynote-mcp.mjs");

const isolated = await mkdtemp(join(tmpdir(), "vc-dist-"));
const runFile = join(isolated, "qynote-mcp.mjs");
await copyFile(distFile, runFile);
assert.deepEqual(
  (await readdir(isolated)).sort(),
  ["qynote-mcp.mjs"],
  "the run directory must contain ONLY the single bundle — no deps, no src, no siblings"
);

const vault = await mkdtemp(join(tmpdir(), "vc-dist-vault-"));
await writeFile(join(vault, "重复A.md"), "# 重复A\n\n这是一段用于验证重复检测的完整笔记内容，包含足够多的文字与相同概念。\n");
await writeFile(join(vault, "重复B.md"), "# 重复B\n\n这是一段用于验证重复检测的完整笔记内容，包含足够多的文字与相同概念。\n");
await writeFile(join(vault, "间隔有益.md"), "# 间隔有益\n\n间隔重复能够改善长期记忆的整体效果表现。\n");
await writeFile(join(vault, "间隔有害.md"), "# 间隔有害\n\n间隔重复不能改善长期记忆的整体效果表现。\n");

const child = spawn(process.execPath, [runFile], {
  cwd: isolated,
  env: { ...process.env, VAULT_PATH: vault },
  stdio: ["pipe", "pipe", "inherit"]
});

let nextId = 0;
const pending = new Map();
const rl = createInterface({ input: child.stdout });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const request = (method, params) =>
  new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
const notify = (method, params) =>
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
const call = (name, arguments_) => request("tools/call", { name, arguments: arguments_ ?? {} });
const result = (response) => JSON.parse(response.result.content[0].text);
const read = (name) => readFile(join(vault, name), "utf8");

try {
  const init = await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "dist-smoke", version: "0" }
  });
  assert.equal(init.result.serverInfo.name, "qynote-tools");
  notify("notifications/initialized", {});

  const tools = (await request("tools/list", {})).result.tools.map((tool) => tool.name);
  assert.deepEqual(tools, [
    "list_notes",
    "find_suggestions",
    "diagnose",
    "preview_link",
    "preview_merge",
    "preview_resolve_contradiction",
    "propose_plan",
    "apply_change",
    "undo_last"
  ]);
  assert.equal(result(await call("list_notes")).length, 4);

  const before = new Map();
  for (const name of ["重复A.md", "重复B.md", "间隔有益.md", "间隔有害.md"]) {
    before.set(name, await read(name));
  }

  const plan = result(await call("propose_plan", { limit: 20 }));
  assert(plan.changeCount >= 1, `expected a non-empty plan from the isolated bundle, got ${JSON.stringify(plan)}`);
  assert(plan.items.every((item) => item.diff && typeof item.diff.after === "string"), "isolated bundle must still return per-item diffs");

  const applied = await call("apply_change", { previewId: plan.previewId });
  assert.equal(applied.result.isError, false);
  assert.equal(result(applied).applied, plan.changeCount);
  for (const item of plan.items) {
    assert.equal(await read(item.path), item.diff.after, "isolated bundle: diff.after must equal what lands on disk");
  }

  const rolled = result(await call("undo_last"));
  assert.deepEqual([...rolled.restored].sort(), [...plan.items.map((i) => i.path)].sort());
  for (const [name, content] of before) {
    assert.equal(await read(name), content, `isolated bundle: undo must restore ${name}`);
  }

  console.log(
    `MCP dist: PASS — single file ran from an empty dir (no deps/src), 9 tools listed, propose_plan(diff)→apply→undo roundtrip OK (${plan.changeCount} changes)`
  );
} finally {
  child.kill();
  // Wait for the child to release its cwd/file handles before removing the isolated dir (Windows EBUSY race).
  if (child.exitCode === null && child.signalCode === null) {
    await once(child, "exit").catch(() => {});
  }
  const cleanup = (dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  await cleanup(isolated).catch((error) => console.warn(`dist cleanup skipped (${isolated}): ${error?.code ?? error}`));
  await cleanup(vault).catch((error) => console.warn(`vault cleanup skipped (${vault}): ${error?.code ?? error}`));
}
