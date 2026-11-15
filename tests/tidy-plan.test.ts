import { describe, expect, it } from "vitest";
import {
  buildTfidfVectors,
  findContradictions,
  findDuplicates,
  parseNoteBlocks,
  tokenize
} from "../src/analysis";
import {
  appendedText,
  buildContradictionChange,
  buildLinkChange,
  buildMergeChange,
  buildTidyPlan
} from "../src/tidy-plan";
import type { ContradictionCandidate, NoteSummary } from "../src/types";

function note(path: string, content: string): NoteSummary {
  return {
    path,
    title: path.replace(/\.md$/, ""),
    content,
    blocks: parseNoteBlocks(content),
    outgoingLinks: [],
    incomingLinks: [],
    tags: [],
    modifiedAt: 1
  };
}

function vectors(notes: NoteSummary[]): Map<string, Map<string, number>> {
  return new Map(notes.map((item) => [item.path, tokenize(item.content)]));
}

function corpusOf(notes: NoteSummary[]) {
  return buildTfidfVectors(notes, vectors(notes));
}

function isAppendOnly(before: string, after: string): boolean {
  return after.startsWith(before.trimEnd()) && after.length > before.trimEnd().length;
}

describe("tidy plan builders", () => {
  it("merges unique paragraphs by appending and never touches the source note", () => {
    const keep = note("重复A.md", "间隔重复能够帮助长期记忆。");
    const drop = note("重复B.md", "间隔重复能够帮助长期记忆。\n主动回忆也很重要。");
    const change = buildMergeChange(keep, drop, 0.95);
    expect(change.kind).toBe("merge");
    expect(change.path).toBe(keep.path);
    expect(change.willNotTouch).toBe(drop.path);
    expect(change.detectedSimilarity).toBe(0.95);
    expect(change.after).toContain("## 合并自 [[重复B]]");
    expect(change.after).toContain("主动回忆也很重要。");
    expect(change.added).toBe(true);
    expect(isAppendOnly(change.before, change.after)).toBe(true);
    expect(appendedText(change)).toContain("## 合并自 [[重复B]]");
  });

  it("records only a source link when the dropped note has no new paragraphs", () => {
    const keep = note("重复A.md", "间隔重复能够帮助长期记忆。");
    const drop = note("重复B.md", "间隔重复能够帮助长期记忆。");
    const change = buildMergeChange(keep, drop);
    expect(change.after).toContain("仅登记来源链接");
    expect(change.detectedSimilarity).toBeNull();
    expect(isAppendOnly(change.before, change.after)).toBe(true);
  });

  it("appends a related-note link and is a no-op when already linked", () => {
    const source = note("记忆.md", "间隔重复能够帮助长期记忆。");
    const target = note("提取练习.md", "主动回忆与提取练习密切相关。");
    const change = buildLinkChange(source, target);
    expect(change.kind).toBe("link");
    expect(change.after).toContain("## 相关笔记");
    expect(change.after).toContain("[[提取练习]]");
    expect(change.added).toBe(true);
    expect(isAppendOnly(change.before, change.after)).toBe(true);

    const already = note("记忆.md", "间隔重复能够帮助长期记忆。\n参见 [[提取练习]]。");
    const noop = buildLinkChange(already, target);
    expect(noop.added).toBe(false);
    expect(noop.after).toBe(noop.before);
  });

  it("annotates a contradiction without editing either original claim", () => {
    const source = note("肯定.md", "间隔重复能够改善长期记忆效果。");
    const conflicting = note("否定.md", "间隔重复不能改善长期记忆效果。");
    const match: ContradictionCandidate = {
      leftPath: source.path,
      rightPath: conflicting.path,
      leftLine: 1,
      rightLine: 1,
      leftText: "间隔重复能够改善长期记忆效果。",
      rightText: "间隔重复不能改善长期记忆效果。"
    };
    const change = buildContradictionChange(source, conflicting, match);
    expect(change.kind).toBe("contradiction");
    expect(change.after).toContain("## ⚠️ 冲突提示");
    expect(change.after).toContain(match.leftText);
    expect(change.after).toContain(match.rightText);
    expect(change.after).toContain("[[否定]]");
    expect(change.added).toBe(true);
    expect(isAppendOnly(change.before, change.after)).toBe(true);
  });
});

describe("buildTidyPlan", () => {
  const dupA = note("重复A.md", "这是一段用于验证重复检测的完整笔记内容，包含足够多的文字与相同概念。");
  const dupB = note("重复B.md", "这是一段用于验证重复检测的完整笔记内容，包含足够多的文字与相同概念。");
  const positive = note("肯定.md", "间隔重复能够改善长期记忆效果。");
  const negative = note("否定.md", "间隔重复不能改善长期记忆效果。");
  const memory = note("记忆.md", "间隔重复能够帮助长期记忆，主动回忆也很重要。");
  const review = note("复习.md", "主动回忆与间隔重复是长期记忆的重要方法。");
  const notes = [dupA, dupB, positive, negative, memory, review];

  function plan(limit?: number) {
    const raw = vectors(notes);
    return buildTidyPlan({
      notes,
      corpus: corpusOf(notes),
      duplicates: findDuplicates(notes, raw),
      contradictions: findContradictions(notes, raw),
      limit
    });
  }

  it("edits each file at most once", () => {
    const changes = plan();
    const paths = changes.map((change) => change.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(changes.length).toBeGreaterThan(0);
  });

  it("never edits a merge source note and keeps every change append-only", () => {
    const changes = plan();
    const paths = new Set(changes.map((change) => change.path));
    for (const change of changes) {
      if (change.willNotTouch) {
        expect(paths.has(change.willNotTouch)).toBe(false);
      }
      expect(change.added).toBe(true);
      expect(isAppendOnly(change.before, change.after)).toBe(true);
      expect(appendedText(change).length).toBeGreaterThan(0);
    }
    expect(changes.some((change) => change.kind === "merge")).toBe(true);
  });

  it("respects the limit", () => {
    expect(plan(1).length).toBeLessThanOrEqual(1);
    expect(plan(0)).toHaveLength(0);
  });

  it("returns an empty plan when there is nothing to diagnose", () => {
    const single = [note("孤立.md", "一篇没有关联、重复或冲突的独立笔记。")];
    const raw = vectors(single);
    const changes = buildTidyPlan({
      notes: single,
      corpus: corpusOf(single),
      duplicates: findDuplicates(single, raw),
      contradictions: findContradictions(single, raw)
    });
    expect(changes).toHaveLength(0);
  });
});