// Local-only vault layer for the MCP prototype. Reads a vault directory, builds the
// same TF-IDF corpus the plugin uses, and exposes read + gated-write operations.
// No network calls and no language model — everything runs on the user's machine.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildTfidfVectors,
  findContradictions,
  findDuplicates,
  findLinkSuggestions,
  findSourceIssues,
  parseNoteBlocks,
  tokenizeNoteContent
} from "./analysis.mjs";
import {
  buildContradictionChange,
  buildLinkChange,
  buildMergeChange,
  buildTidyPlan
} from "./tidy-plan.mjs";

const LINK_PATTERN = /!?\[\[([^\]|#]+)/g;

export class LocalVault {
  constructor(root) {
    this.root = root;
    this.notes = [];
    this.noteByPath = new Map();
    this.titleToPath = new Map();
    this.corpus = null;
    this.rawVectors = new Map();
    this.previews = new Map(); // previewId -> { path, before, after }
    this.undoStack = []; // [{ path, before, backupPath }]
  }

  async scan() {
    const files = await this.markdownFiles(this.root);
    const pathByBasename = new Map();
    for (const relative of files) {
      pathByBasename.set(basename(relative), relative);
      pathByBasename.set(relative, relative);
    }

    const notes = [];
    for (const relative of files) {
      const content = await readFile(join(this.root, relative), "utf8");
      notes.push({
        path: relative,
        title: basename(relative),
        content,
        blocks: parseNoteBlocks(content),
        tags: frontmatterTags(content),
        outgoingLinks: resolveLinks(content, pathByBasename, relative),
        incomingLinks: [],
        modifiedAt: 0
      });
    }

    const noteByPath = new Map(notes.map((note) => [note.path, note]));
    for (const note of notes) {
      for (const target of note.outgoingLinks) {
        noteByPath.get(target)?.incomingLinks.push(note.path);
      }
    }

    notes.sort((left, right) => left.path.localeCompare(right.path));
    this.notes = notes;
    this.noteByPath = noteByPath;

    const raw = new Map(notes.map((note) => [note.path, tokenizeNoteContent(note.content)]));
    this.rawVectors = raw;
    this.corpus = buildTfidfVectors(notes, raw);
    return this.notes;
  }

  getNote(path) {
    const note = this.noteByPath.get(path);
    if (!note) {
      throw new Error(`找不到笔记：${path}`);
    }
    return note;
  }

  listNotes() {
    return this.notes.map((note) => ({
      path: note.path,
      title: note.title,
      tags: note.tags,
      outgoingLinks: note.outgoingLinks,
      words: note.content.trim().split(/\s+/).length
    }));
  }

  findSuggestions(path, limit = 5) {
    const source = this.getNote(path);
    return findLinkSuggestions(source, this.notes, this.corpus, limit).map((item) => ({
      targetPath: item.targetPath,
      targetTitle: this.getNote(item.targetPath).title,
      score: Number(item.score.toFixed(4)),
      evidence: item.evidence,
      targetExcerpt: item.targetExcerpt
    }));
  }

  diagnose() {
    const duplicates = findDuplicates(this.notes, this.rawVectors).map((item) => ({
      paths: item.paths,
      similarity: Number(item.similarity.toFixed(4)),
      evidence: item.evidence
    }));
    const contradictions = findContradictions(this.notes, this.rawVectors).map((item) => ({
      left: { path: item.leftPath, line: item.leftLine, text: item.leftText },
      right: { path: item.rightPath, line: item.rightLine, text: item.rightText }
    }));
    const sourceIssues = findSourceIssues(this.notes).map((item) => ({
      path: item.path,
      line: item.line,
      text: item.text
    }));
    return { duplicates, contradictions, sourceIssues };
  }

  stage(changes) {
    const previewId = randomUUID();
    this.previews.set(previewId, { changes });
    return previewId;
  }

  contradictionMatch(aPath, bPath) {
    return findContradictions(this.notes, this.rawVectors).find(
      (item) =>
        (item.leftPath === aPath && item.rightPath === bPath) ||
        (item.leftPath === bPath && item.rightPath === aPath)
    );
  }

  flatPreview(previewId, change, noteOverride) {
    const payload = {
      previewId,
      changed: change.added,
      path: change.path,
      kind: change.kind,
      summary: change.summary,
      diff: lineDiff(change.before, change.after),
      note: noteOverride ?? "未写入。用 apply_change 并传入该 previewId 才会落盘（会先写备份，可 undo_last 撤销）。"
    };
    if (change.willNotTouch) {
      payload.willNotTouch = change.willNotTouch;
    }
    if (change.detectedSimilarity !== undefined) {
      payload.detectedSimilarity = change.detectedSimilarity;
    }
    return payload;
  }

  previewLink(sourcePath, targetPath) {
    const change = buildLinkChange(this.getNote(sourcePath), this.getNote(targetPath));
    return this.flatPreview(this.stage([change]), change);
  }

  previewMerge(keepPath, dropPath) {
    const keep = this.getNote(keepPath);
    const drop = this.getNote(dropPath);
    const similarity = findDuplicates(this.notes, this.rawVectors).find(
      (item) => item.paths.includes(keep.path) && item.paths.includes(drop.path)
    )?.similarity;
    const change = buildMergeChange(keep, drop, similarity);
    const payload = this.flatPreview(this.stage([change]), change);
    payload.note =
      "合并仅写入保留笔记（追加来源独有段落并留下 [[链接]]）；来源笔记保持不变，不会删除。确认后用 apply_change 落盘。";
    return payload;
  }

  previewResolveContradiction(sourcePath, conflictingPath) {
    const source = this.getNote(sourcePath);
    const conflicting = this.getNote(conflictingPath);
    const match = this.contradictionMatch(source.path, conflicting.path);
    if (!match) {
      throw new Error("未在这两篇笔记间检测到矛盾，请先运行 diagnose 核对具体的行与措辞。");
    }
    const change = buildContradictionChange(source, conflicting, match);
    const payload = this.flatPreview(this.stage([change]), change);
    payload.note =
      "矛盾处理仅追加一条可核查的冲突提示，绝不删改任一方的原始表述；确认后用 apply_change 落盘。";
    return payload;
  }

  proposePlan(limit = 20) {
    const capped = buildTidyPlan({
      notes: this.notes,
      corpus: this.corpus,
      duplicates: findDuplicates(this.notes, this.rawVectors),
      contradictions: findContradictions(this.notes, this.rawVectors),
      limit
    });
    const previewId = this.stage(capped);
    return {
      previewId,
      changeCount: capped.length,
      items: capped.map((change) => {
        const item = {
          path: change.path,
          kind: change.kind,
          summary: change.summary,
          diff: lineDiff(change.before, change.after)
        };
        if (change.willNotTouch) {
          item.willNotTouch = change.willNotTouch;
        }
        if (change.detectedSimilarity !== undefined) {
          item.detectedSimilarity = change.detectedSimilarity;
        }
        return item;
      }),
      note:
        capped.length === 0
          ? "没有达到阈值的整理项，未生成任何写入计划。"
          : "整份计划的每个文件最多改一处，每项附 diff 供逐文件核查。用 apply_change(previewId) 一次性落盘（任一文件在预览后被改动则整批取消），再用 undo_last 整体回滚。"
    };
  }

  async applyChange(previewId) {
    const plan = this.previews.get(previewId);
    if (!plan) {
      throw new Error("previewId 无效或已使用：必须先 preview_* / propose_plan 拿到 id，才能 apply_change。");
    }
    this.previews.delete(previewId);

    // Verify every target file is still exactly as previewed before touching disk.
    const files = [];
    for (const change of plan.changes) {
      const current = await this.readTargetFile(join(this.root, change.path));
      if (current !== change.before) {
        throw new Error(`目标文件在预览后被改动，整批取消写入：${change.path}`);
      }
      files.push({ path: change.path, before: current });
    }
    // Backups land first: a failure here means nothing real was applied yet.
    for (const file of files) {
      file.backupPath = await this.writeBackup(file.path, file.before);
    }

    // Register the rollback BEFORE writing real files, so even a mid-batch write failure stays undoable.
    this.undoStack.push({ files });
    let written = 0;
    try {
      for (const index of files.keys()) {
        await this.writeTargetFile(join(this.root, files[index].path), plan.changes[index].after);
        written += 1;
      }
    } catch (error) {
      await this.scan();
      throw new Error(
        `批量写入在第 ${written + 1}/${files.length} 个文件处失败；已写入的部分用 undo_last 可整体回滚。原因：${String(error?.message ?? error)}`
      );
    }
    await this.scan();
    return {
      applied: files.length,
      files: files.map((file) => ({ path: file.path, backupPath: file.backupPath }))
    };
  }

  async undoLast() {
    const entry = this.undoStack.pop();
    if (!entry) {
      throw new Error("没有可撤销的改动。");
    }
    for (const file of entry.files) {
      await this.writeTargetFile(join(this.root, file.path), file.before);
    }
    await this.scan();
    return { restored: entry.files.map((file) => file.path) };
  }

  // Thin seams so the real-file I/O can be injected in tests; backups keep their own path.
  async readTargetFile(absolutePath) {
    return readFile(absolutePath, "utf8");
  }

  async writeTargetFile(absolutePath, content) {
    await writeFile(absolutePath, content, "utf8");
  }

  async writeBackup(relativePath, content) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = relativePath.replace(/[\\/]/g, "__");
    const directory = join(this.root, ".qynote-mcp-backups");
    await mkdir(directory, { recursive: true });
    const backupPath = join(directory, `${stamp}__${safeName}.bak`);
    await writeFile(backupPath, content, "utf8");
    return backupPath;
  }

  async markdownFiles(directory, prefix = "") {
    const out = [];
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) {
          continue;
        }
        out.push(...(await this.markdownFiles(join(directory, entry.name), relative)));
      } else if (entry.name.endsWith(".md")) {
        out.push(relative);
      }
    }
    return out;
  }
}

function basename(relative) {
  return relative.split("/").pop().replace(/\.md$/i, "");
}

function resolveLinks(content, pathByBasename, selfPath) {
  const links = new Set();
  for (const match of content.matchAll(LINK_PATTERN)) {
    const resolved = pathByBasename.get(match[1].trim());
    if (resolved && resolved !== selfPath) {
      links.add(resolved);
    }
  }
  return [...links];
}

function frontmatterTags(content) {
  const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) {
    return [];
  }
  const tags = [];
  const inline = block[1].match(/^tags\s*:\s*\[(.*?)\]\s*$/im);
  if (inline) {
    for (const item of inline[1].split(",")) {
      const value = item.trim().replace(/^["']|["']$/g, "");
      if (value) {
        tags.push(value);
      }
    }
    return tags;
  }
  const section = block[1].match(/^tags\s*:\s*$/im);
  if (section) {
    for (const line of block[1].split(/\r?\n/).slice(block[1].split(/\r?\n/).findIndex((l) => /^tags\s*:/.test(l)) + 1)) {
      const item = line.match(/^\s*-\s+(.+)$/);
      if (!item) {
        break;
      }
      tags.push(item[1].trim().replace(/^["']|["']$/g, ""));
    }
  }
  return tags;
}

function lineDiff(before, after) {
  const beforeLines = before.split(/\r?\n/);
  const beforeSet = new Set(beforeLines);
  const added = after.split(/\r?\n/).filter((line, index) => !beforeSet.has(line) || index >= beforeLines.length);
  return { before, after, addedLines: added.filter((line) => line.trim() !== "") };
}
