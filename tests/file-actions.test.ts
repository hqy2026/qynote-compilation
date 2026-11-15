import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
  class TFile {
    constructor(public path: string) {}
  }
  class TFolder {
    constructor(public path: string) {}
  }
  class MarkdownView {}
  class App {}
  return { TFile, TFolder, MarkdownView, App, requestUrl: vi.fn() };
});

import { TFile } from "obsidian";
import { applyNoteChanges, restoreNoteChanges } from "../src/file-actions";
import type { ChangeBackup } from "../src/types";

interface FakeVault {
  store: Map<string, string>;
  reads: number;
  failOnPath?: string;
  getAbstractFileByPath(path: string): TFile | null;
  read(file: TFile): Promise<string>;
  modify(file: TFile, content: string): Promise<void>;
}

function fakeVault(files: Record<string, string>): FakeVault {
  const vault: FakeVault = {
    store: new Map(Object.entries(files)),
    reads: 0,
    getAbstractFileByPath(path) {
      return vault.store.has(path) ? new TFile(path) : null;
    },
    async read(file) {
      vault.reads += 1;
      const content = vault.store.get(file.path);
      if (content === undefined) {
        throw new Error(`missing ${file.path}`);
      }
      return content;
    },
    async modify(file, content) {
      if (vault.failOnPath === file.path) {
        throw new Error(`write failed: ${file.path}`);
      }
      vault.store.set(file.path, content);
    }
  };
  return vault;
}

function appOf(vault: FakeVault) {
  return { vault } as never;
}

describe("applyNoteChanges verified batch write", () => {
  it("writes every change and backs up the prior content when expected matches", async () => {
    const vault = fakeVault({ "A.md": "甲", "B.md": "乙" });
    const backup = await applyNoteChanges(appOf(vault), [
      { path: "A.md", content: "甲++", expected: "甲" },
      { path: "B.md", content: "乙++", expected: "乙" }
    ]);
    expect(vault.store.get("A.md")).toBe("甲++");
    expect(vault.store.get("B.md")).toBe("乙++");
    expect(backup.files).toEqual([
      { path: "A.md", content: "甲" },
      { path: "B.md", content: "乙" }
    ]);
    expect(vault.reads).toBe(2);
  });

  it("aborts the whole batch before any write when one expected mismatches", async () => {
    const vault = fakeVault({ "A.md": "甲", "B.md": "已被改动" });
    await expect(
      applyNoteChanges(appOf(vault), [
        { path: "A.md", content: "甲++", expected: "甲" },
        { path: "B.md", content: "乙++", expected: "乙" }
      ])
    ).rejects.toThrow(/被改动/);
    expect(vault.store.get("A.md")).toBe("甲");
    expect(vault.store.get("B.md")).toBe("已被改动");
  });

  it("rolls back already-written files when a later write fails", async () => {
    const vault = fakeVault({ "A.md": "甲", "B.md": "乙" });
    vault.failOnPath = "B.md";
    await expect(
      applyNoteChanges(appOf(vault), [
        { path: "A.md", content: "甲++", expected: "甲" },
        { path: "B.md", content: "乙++", expected: "乙" }
      ])
    ).rejects.toThrow(/write failed/);
    expect(vault.store.get("A.md")).toBe("甲");
    expect(vault.store.get("B.md")).toBe("乙");
  });

  it("restores a backup without an expected guard", async () => {
    const vault = fakeVault({ "A.md": "甲++", "B.md": "乙++" });
    const backup: ChangeBackup = {
      createdAt: new Date().toISOString(),
      files: [
        { path: "A.md", content: "甲" },
        { path: "B.md", content: "乙" }
      ]
    };
    await restoreNoteChanges(appOf(vault), backup);
    expect(vault.store.get("A.md")).toBe("甲");
    expect(vault.store.get("B.md")).toBe("乙");
  });
});