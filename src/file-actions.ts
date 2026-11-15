import { App, MarkdownView, TFile } from "obsidian";
import type { ChangeBackup } from "./types";

export interface NoteChange {
  path: string;
  content: string;
  /** When set, the file's current content must equal this or the whole batch aborts before any write. */
  expected?: string;
}

export async function applyNoteChanges(
  app: App,
  changes: NoteChange[]
): Promise<ChangeBackup> {
  const previous = await Promise.all(
    changes.map(async (change) => {
      const file = app.vault.getAbstractFileByPath(change.path);
      if (!(file instanceof TFile)) {
        throw new Error(`找不到笔记：${change.path}`);
      }
      const content = await app.vault.read(file);
      if (change.expected !== undefined && content !== change.expected) {
        throw new Error(`笔记在生成计划后被改动，请重新生成计划：${change.path}`);
      }
      return { path: change.path, content };
    })
  );

  const applied: TFile[] = [];
  try {
    for (const change of changes) {
      const file = app.vault.getAbstractFileByPath(change.path);
      if (!(file instanceof TFile)) {
        throw new Error(`笔记已移动或删除：${change.path}`);
      }
      await app.vault.modify(file, change.content);
      applied.push(file);
    }
  } catch (error) {
    for (const file of applied) {
      const original = previous.find((item) => item.path === file.path);
      if (original) {
        await app.vault.modify(file, original.content);
      }
    }
    throw error;
  }

  return { createdAt: new Date().toISOString(), files: previous };
}

export async function restoreNoteChanges(
  app: App,
  backup: ChangeBackup
): Promise<void> {
  await applyNoteChanges(app, backup.files);
}

export async function openNoteAtLine(
  app: App,
  path: string,
  line = 1
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    throw new Error(`找不到笔记：${path}`);
  }
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  if (leaf.view instanceof MarkdownView) {
    const editor = leaf.view.editor;
    editor.setCursor({ line: Math.max(0, line - 1), ch: 0 });
    editor.focus();
  }
}
