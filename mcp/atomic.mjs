// Proves the batched write gate never leaves an unrecoverable half-applied vault:
// if a real-file write fails mid-batch, undo_last still rolls every touched file back to its original.
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { LocalVault } from "./vault.mjs";

class FailingVault extends LocalVault {
  constructor(root) {
    super(root);
    this.failOnPath = null; // absolute path suffix that should throw on write
  }
  async writeTargetFile(absolutePath, content) {
    if (this.failOnPath && absolutePath.endsWith(this.failOnPath)) {
      throw new Error(`注入的写入失败：${absolutePath}`);
    }
    return super.writeTargetFile(absolutePath, content);
  }
}

const vault = await mkdtemp(join(tmpdir(), "vc-atomic-"));
await writeFile(join(vault, "重复A.md"), "# 重复A\n\n这是一段用于验证重复检测的完整笔记内容，包含足够多的文字与相同概念。\n");
await writeFile(join(vault, "重复B.md"), "# 重复B\n\n这是一段用于验证重复检测的完整笔记内容，包含足够多的文字与相同概念。\n");
await writeFile(join(vault, "间隔有益.md"), "# 间隔有益\n\n间隔重复能够改善长期记忆的整体效果表现。\n");
await writeFile(join(vault, "间隔有害.md"), "# 间隔有害\n\n间隔重复不能改善长期记忆的整体效果表现。\n");

try {
  const v = new FailingVault(vault);
  await v.scan();

  const plan = v.proposePlan(20);
  assert(plan.changeCount >= 2, `need a multi-file plan to test atomicity, got ${plan.changeCount}`);

  const plannedPaths = plan.items.map((item) => item.path);
  const before = new Map();
  for (const name of plannedPaths) {
    before.set(name, await readFile(join(vault, name), "utf8"));
  }

  // Arm a failure on the LAST planned file so every earlier file is already written when it throws.
  const lastPath = plan.items[plan.items.length - 1].path;
  v.failOnPath = lastPath;

  let threw = false;
  try {
    await v.applyChange(plan.previewId);
  } catch (error) {
    threw = true;
    assert(/undo_last/.test(String(error?.message)), `failure message must point at undo_last: ${error?.message}`);
  }
  assert(threw, "apply_change must reject when a mid-batch write fails");

  // The rollback record exists BEFORE the failure surfaced, so the batch is undoable.
  assert.equal(v.undoStack.length, 1, "a failed batch must still leave exactly one undo entry");

  // Files written before the failure really changed on disk (partial state, but recoverable).
  const firstPath = plan.items[0].path;
  assert.notEqual(await readFile(join(vault, firstPath), "utf8"), before.get(firstPath), "earlier files should have been written");

  // Disarm and roll the whole batch back — every planned file returns to its original bytes.
  v.failOnPath = null;
  const rolled = await v.undoLast();
  assert.deepEqual([...rolled.restored].sort(), [...plannedPaths].sort());

  const names = ["重复A.md", "重复B.md", "间隔有益.md", "间隔有害.md"];
  for (const name of names) {
    if (plannedPaths.includes(name)) {
      assert.equal(await readFile(join(vault, name), "utf8"), before.get(name), `undo must restore ${name} after a mid-batch failure`);
    }
  }

  console.log(
    `MCP atomic: PASS — mid-batch write failure at ${lastPath} left a recoverable batch; undo_last restored ${plannedPaths.length} files`
  );
} finally {
  await rm(vault, { recursive: true, force: true });
}
