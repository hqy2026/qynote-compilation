import { findLinkSuggestions, type TfidfCorpus } from "./analysis";
import type { ContradictionCandidate, DuplicateCandidate, NoteSummary } from "./types";

export type TidyPlanKind = "link" | "merge" | "contradiction";

export interface TidyPlanChange {
  path: string;
  kind: TidyPlanKind;
  summary: string;
  before: string;
  after: string;
  added: boolean;
  willNotTouch?: string;
  detectedSimilarity?: number | null;
}

export interface TidyPlanInput {
  notes: NoteSummary[];
  corpus: TfidfCorpus;
  duplicates: DuplicateCandidate[];
  contradictions: ContradictionCandidate[];
  limit?: number;
}

/** Append-only link insertion; never edits existing text. Shared by the plugin and the MCP surface. */
export function buildLinkChange(source: NoteSummary, target: NoteSummary): TidyPlanChange {
  const result = organizeAppend(source.content, target.title, target.path);
  return {
    path: source.path,
    kind: "link",
    summary: `关联 [[${target.title}]]`,
    before: source.content,
    after: result.content,
    added: result.added
  };
}

/** Merge drop's unique paragraphs into keep by appending; the source note is never touched or deleted. */
export function buildMergeChange(
  keep: NoteSummary,
  drop: NoteSummary,
  similarity?: number
): TidyPlanChange {
  const normalize = (value: string) => value.replace(/\s+/g, "").trim();
  const keepNorm = normalize(keep.content);
  const additions = drop.blocks
    .map((block) => block.text)
    .filter((text) => text && !keepNorm.includes(normalize(text)));
  const section =
    `\n\n## 合并自 [[${basename(drop.path)}]]\n\n` +
    (additions.length
      ? additions.map((text) => `- ${text}`).join("\n") + "\n"
      : "- （该笔记没有新增正文段落，仅登记来源链接）\n");
  const after = `${keep.content.trimEnd()}${section}`;
  return {
    path: keep.path,
    kind: "merge",
    summary: `合并 [[${drop.title}]] 的独有段落进 [[${keep.title}]]（不删除来源笔记）`,
    before: keep.content,
    after,
    added: after !== keep.content,
    willNotTouch: drop.path,
    detectedSimilarity: similarity ?? null
  };
}

/** Append a verifiable conflict hint; neither side's original claim is edited. */
export function buildContradictionChange(
  source: NoteSummary,
  conflicting: NoteSummary,
  match: ContradictionCandidate
): TidyPlanChange {
  const sourceIsLeft = match.leftPath === source.path;
  const sourceText = sourceIsLeft ? match.leftText : match.rightText;
  const sourceLine = sourceIsLeft ? match.leftLine : match.rightLine;
  const otherText = sourceIsLeft ? match.rightText : match.leftText;
  const otherLine = sourceIsLeft ? match.rightLine : match.leftLine;
  const section =
    `\n\n## ⚠️ 冲突提示\n\n` +
    `> 本笔记第 ${sourceLine} 行与另一处观点可能冲突，建议人工核对（原文不改）：\n>\n` +
    `> - 本篇：“${sourceText}”\n` +
    `> - [[${basename(conflicting.path)}]] 第 ${otherLine} 行：“${otherText}”\n`;
  const after = `${source.content.trimEnd()}${section}`;
  return {
    path: source.path,
    kind: "contradiction",
    summary: `标注与 [[${conflicting.title}]] 的观点冲突（仅追加提示，不改原句）`,
    before: source.content,
    after,
    added: true
  };
}

/**
 * Compose one whole-vault tidy plan: merge high-similarity duplicates, annotate contradictions,
 * then add high-confidence links. Each file is edited at most once. Diagnostics are supplied by the
 * caller (the plugin reuses its cached async scan; the MCP computes them synchronously).
 */
export function buildTidyPlan(input: TidyPlanInput): TidyPlanChange[] {
  const limit = Number.isFinite(input.limit) ? Math.max(0, Math.floor(input.limit as number)) : 20;
  const noteByPath = new Map(input.notes.map((note) => [note.path, note]));
  const touched = new Set<string>();
  const changes: TidyPlanChange[] = [];

  for (const item of input.duplicates.filter((pair) => pair.similarity >= 0.9)) {
    const [keepPath, dropPath] = [...item.paths].sort((a, b) => a.localeCompare(b));
    const keep = noteByPath.get(keepPath);
    const drop = noteByPath.get(dropPath);
    if (!keep || !drop || touched.has(keep.path)) {
      continue;
    }
    changes.push(buildMergeChange(keep, drop, item.similarity));
    touched.add(keep.path);
  }

  for (const item of input.contradictions) {
    const source = noteByPath.get(item.leftPath);
    const conflicting = noteByPath.get(item.rightPath);
    if (!source || !conflicting || touched.has(source.path)) {
      continue;
    }
    changes.push(buildContradictionChange(source, conflicting, item));
    touched.add(source.path);
  }

  for (const note of input.notes) {
    if (touched.has(note.path)) {
      continue;
    }
    const best = findLinkSuggestions(note, input.notes, input.corpus, 1).find(
      (suggestion) =>
        suggestion.evidence.length >= 2 &&
        suggestion.score >= 0.25 &&
        !touched.has(suggestion.targetPath)
    );
    const target = best ? noteByPath.get(best.targetPath) : undefined;
    if (!best || !target) {
      continue;
    }
    changes.push(buildLinkChange(note, target));
    touched.add(note.path);
  }

  return changes.slice(0, limit);
}

/** The appended tail of an append-only change, for compact review in the sidebar. */
export function appendedText(change: TidyPlanChange): string {
  return change.after.slice(change.before.trimEnd().length);
}

function organizeAppend(
  content: string,
  targetTitle: string,
  targetPath: string
): { content: string; added: boolean } {
  const alias = basename(targetPath);
  if (content.includes(`[[${alias}]]`) || content.includes(`[[${alias}|`)) {
    return { content, added: false };
  }
  const link = alias === targetTitle ? `[[${alias}]]` : `[[${alias}|${targetTitle}]]`;
  return { content: `${content.trimEnd()}\n\n## 相关笔记\n\n- ${link}\n`, added: true };
}

function basename(relative: string): string {
  return relative.split("/").pop()?.replace(/\.md$/i, "") ?? relative;
}
