/** @vitest-environment jsdom */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

beforeAll(async () => {
  document.documentElement.innerHTML = fs.readFileSync(
    path.resolve(process.cwd(), "web/index.html"),
    "utf8"
  ).replace(/^<!doctype html>/i, "");
  await import("../web/app.js");
});

function clickByText(text: string): void {
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === text
  );
  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }
  button.click();
}

describe("public demo interactions", () => {
  it("organizes a note through preview, confirmation and undo", () => {
    const targetFile = [...document.querySelectorAll(".file-item")].find(
      (item) => item.textContent?.includes("学习科学")
    );
    targetFile?.click();
    expect(document.querySelectorAll(".suggestion").length).toBeGreaterThan(0);
    clickByText("查看修改预览");
    expect(document.getElementById("diffPreview")?.getAttribute("hidden")).toBeNull();
    expect(document.getElementById("diffAfter")?.textContent).toContain("相关笔记");
    clickByText("确认写回");
    expect(document.getElementById("noteContent")?.textContent).toContain("[[");
    clickByText("撤销上次整理");
    expect(document.getElementById("noteContent")?.textContent).not.toContain("## 相关笔记");
  });

  it("resets the sample vault", () => {
    clickByText("重置演示");
    expect(document.getElementById("vaultCount")?.textContent).toBe("8 篇笔记");
    expect(document.getElementById("noteContent")?.textContent).not.toContain("## 相关笔记");
  });

  it("generates, previews, applies and undoes a whole-vault plan", () => {
    (document.getElementById("plan-tab") as HTMLButtonElement).click();
    (document.getElementById("planGenerate") as HTMLButtonElement).click();
    const items = document.querySelectorAll("#planList .plan-item");
    expect(items.length).toBeGreaterThan(0);
    (document.getElementById("planPreviewApply") as HTMLButtonElement).click();
    expect(document.getElementById("planConfirm")?.getAttribute("hidden")).toBeNull();
    expect(document.querySelectorAll("#planConfirmBody .plan-item").length).toBe(items.length);
    (document.getElementById("planConfirmApply") as HTMLButtonElement).click();
    expect(document.getElementById("planUndo")?.getAttribute("hidden")).toBeNull();

    const mergeTarget = [...document.querySelectorAll(".file-item")].find((item) =>
      item.textContent?.includes("重复 A")
    );
    mergeTarget?.click();
    expect(document.getElementById("noteContent")?.textContent).toContain("## 合并自");

    (document.getElementById("planUndo") as HTMLButtonElement).click();
    expect(document.getElementById("planUndo")?.getAttribute("hidden")).not.toBeNull();
    expect(document.getElementById("noteContent")?.textContent).not.toContain("## 合并自");
  });
});
