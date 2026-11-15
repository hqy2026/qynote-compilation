// Drives the MCP server exactly like a client would (JSON-RPC over stdio) and
// asserts every tool + the write gate. Creates a throwaway vault in a temp dir.
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";

const vault = await mkdtemp(join(tmpdir(), "vc-mcp-"));
await writeFile(join(vault, "主动回忆.md"), "# 主动回忆\n\n主动回忆与提取练习能够帮助长期记忆，强调不查看答案地学习。\n");
await writeFile(join(vault, "提取练习.md"), "# 提取练习\n\n提取练习就是不回看材料，主动把信息从长期记忆中检索出来。\n");
await writeFile(join(vault, "番茄工作法.md"), "# 番茄工作法\n\n把工作时间切成专注与休息的段落。\n");
await writeFile(join(vault, "重复A.md"), "# 重复A\n\n这是一段用于验证重复检测的完整笔记内容，包含足够多的文字与相同概念。\n");
await writeFile(join(vault, "重复B.md"), "# 重复B\n\n这是一段用于验证重复检测的完整笔记内容，包含足够多的文字与相同概念。\n");
await writeFile(join(vault, "研究摘录.md"), "# 研究摘录\n\n研究表明，主动回忆能够显著改善长期记忆效果。\n");
await writeFile(join(vault, "间隔有益.md"), "# 间隔有益\n\n间隔重复能够改善长期记忆的整体效果表现。\n");
await writeFile(join(vault, "间隔有害.md"), "# 间隔有害\n\n间隔重复不能改善长期记忆的整体效果表现。\n");

const child = spawn(process.execPath, [join(import.meta.dirname, "server.mjs")], {
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
    clientInfo: { name: "smoke", version: "0" }
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

  assert.equal(result(await call("list_notes")).length, 8);

  const suggestions = result(await call("find_suggestions", { path: "主动回忆.md", limit: 3 }));
  assert(suggestions.some((item) => item.targetPath === "提取练习.md"));

  const diagnosis = result(await call("diagnose"));
  assert(diagnosis.duplicates.some((item) => item.paths.includes("重复A.md") && item.paths.includes("重复B.md")));
  assert(diagnosis.sourceIssues.some((item) => item.path === "研究摘录.md"));
  assert(
    diagnosis.contradictions.some(
      (item) =>
        item.left.path === "间隔有害.md" && item.right.path === "间隔有益.md"
    ),
    `expected 间隔有害/间隔有益 contradiction, got ${JSON.stringify(diagnosis.contradictions)}`
  );

  // gate: apply must reject a bogus previewId
  assert.equal((await call("apply_change", { previewId: "nope" })).result.isError, true);

  // link: preview -> apply -> undo
  const linkPreview = result(await call("preview_link", { source: "主动回忆.md", target: "提取练习.md" }));
  assert.equal(linkPreview.changed, true);
  assert.equal((await call("apply_change", { previewId: linkPreview.previewId })).result.isError, false);
  assert((await read("主动回忆.md")).includes("[[提取练习]]"));
  await call("undo_last");
  assert(!(await read("主动回忆.md")).includes("[[提取练习]]"));

  // merge: keep gains drop's unique paragraphs, drop untouched, undoable
  const mergePreview = result(await call("preview_merge", { keep: "重复A.md", drop: "重复B.md" }));
  assert.equal(mergePreview.kind, "merge");
  assert.equal(mergePreview.willNotTouch, "重复B.md");
  await call("apply_change", { previewId: mergePreview.previewId });
  assert((await read("重复A.md")).includes("## 合并自 [[重复B]]"));
  assert(!(await read("重复B.md")).includes("合并自"), "merge must not modify the source note");
  await call("undo_last");
  assert(!(await read("重复A.md")).includes("合并自"));

  // resolve contradiction: appends a hint only, never edits the claim
  const resolvePreview = result(
    await call("preview_resolve_contradiction", { source: "间隔有害.md", conflicting: "间隔有益.md" })
  );
  assert.equal(resolvePreview.kind, "contradiction");
  await call("apply_change", { previewId: resolvePreview.previewId });
  const resolved = await read("间隔有害.md");
  assert(resolved.includes("## ⚠️ 冲突提示"));
  assert(resolved.includes("间隔重复不能改善长期记忆的整体效果表现"), "original claim must be preserved");
  await call("undo_last");
  assert(!(await read("间隔有害.md")).includes("冲突提示"));

  // propose_plan: one batched tidy plan — each file edited at most once, apply writes all at once, undo rolls back all.
  const names = [
    "主动回忆.md",
    "提取练习.md",
    "番茄工作法.md",
    "重复A.md",
    "重复B.md",
    "研究摘录.md",
    "间隔有益.md",
    "间隔有害.md"
  ];
  const plan = result(await call("propose_plan", { limit: 20 }));
  assert(plan.changeCount >= 1, `expected a non-empty tidy plan, got ${JSON.stringify(plan)}`);
  const planPaths = plan.items.map((item) => item.path);
  assert.equal(new Set(planPaths).size, planPaths.length, "propose_plan must edit each file at most once");
  assert(!planPaths.includes("重复B.md"), "the duplicate drop note must never be edited");
  assert(plan.items.some((item) => item.kind === "merge"), "expected a high-similarity duplicate merge in the plan");

  const before = new Map();
  for (const name of names) {
    before.set(name, await read(name));
  }
  for (const item of plan.items) {
    assert(
      item.diff && typeof item.diff.before === "string" && typeof item.diff.after === "string" && Array.isArray(item.diff.addedLines),
      `each plan item must carry a diff (before/after/addedLines): ${item.path}`
    );
    assert.equal(item.diff.before, before.get(item.path), `diff.before must equal the live file before apply: ${item.path}`);
    assert(item.diff.addedLines.length >= 1, `an append-only change must list its added lines: ${item.path}`);
  }

  const applied = await call("apply_change", { previewId: plan.previewId });
  assert.equal(applied.result.isError, false);
  assert.equal(result(applied).applied, plan.changeCount, "apply_change must write every planned file in one batch");

  const markerFor = { merge: "## 合并自", contradiction: "## ⚠️ 冲突提示", link: "## 相关笔记" };
  for (const item of plan.items) {
    const text = await read(item.path);
    assert(text.includes(before.get(item.path).trimEnd()), `${item.path} must preserve its original text`);
    assert(text.includes(markerFor[item.kind]), `apply must write the ${item.kind} change into ${item.path}`);
    assert.equal(text, item.diff.after, `the diff shown before apply must equal what lands on disk: ${item.path}`);
  }
  for (const name of names) {
    if (!planPaths.includes(name)) {
      assert.equal(await read(name), before.get(name), `files outside the plan must stay untouched: ${name}`);
    }
  }

  const rolled = result(await call("undo_last"));
  assert.deepEqual(
    [...rolled.restored].sort(),
    [...planPaths].sort(),
    "undo_last must roll back exactly the files the plan touched"
  );
  for (const name of names) {
    assert.equal(await read(name), before.get(name), `undo_last must restore the whole plan: ${name}`);
  }

  console.log(
    "MCP smoke: PASS — 9 tools, read queries (suggestions/diagnose), gated preview→apply→undo for link/merge/resolve, and batched propose_plan (per-item diff matches disk)→apply→undo (each-file-once, non-plan files untouched, full rollback) all OK"
  );
} finally {
  child.kill();
  await rm(vault, { recursive: true, force: true });
}
