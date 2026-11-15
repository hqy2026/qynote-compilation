import { describe, expect, it } from "vitest";
import {
  buildTfidfVectors,
  cosineSimilarity,
  findContradictions,
  findDuplicates,
  findLinkSuggestions,
  findSourceIssues,
  parseNoteBlocks,
  tokenize
} from "../src/analysis";
import type { NoteSummary } from "../src/types";

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

function corpus(notes: NoteSummary[]) {
  return buildTfidfVectors(notes, vectors(notes));
}

describe("note analysis", () => {
  it("keeps source line numbers and skips frontmatter and code", () => {
    const blocks = parseNoteBlocks(
      "---\ntags: test\n---\n# 第一章\n有效段落内容\n```\n代码内容\n```\n第二段内容"
    );
    expect(blocks).toEqual([
      { line: 5, text: "有效段落内容", heading: "第一章" },
      { line: 9, text: "第二段内容", heading: "第一章" }
    ]);
  });

  it("calculates deterministic token similarity", () => {
    const left = tokenize("间隔重复能够帮助长期记忆");
    expect(cosineSimilarity(left, tokenize("间隔重复能够帮助长期记忆"))).toBeCloseTo(1);
    expect(cosineSimilarity(left, tokenize("completely different words"))).toBe(0);
  });

  it("suggests only unlinked related notes with evidence", () => {
    const source = note("记忆.md", "间隔重复能够帮助长期记忆，主动回忆也很重要。");
    const target = note("复习.md", "主动回忆与间隔重复是长期记忆的重要方法。");
    const linked = note("已连接.md", "主动回忆与间隔重复是长期记忆的重要方法。");
    source.outgoingLinks = [linked.path];
    const suggestions = findLinkSuggestions(
      source,
      [source, target, linked],
      corpus([source, target, linked])
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].targetPath).toBe(target.path);
    expect(suggestions[0].evidence.length).toBeGreaterThan(0);
  });

  it("detects near duplicates without treating short notes as duplicates", () => {
    const left = note("A.md", "这是一段用于验证重复检测的完整笔记内容，包含足够多的文字与相同概念。");
    const right = note("B.md", "这是一段用于验证重复检测的完整笔记内容，包含足够多的文字与相同概念。");
    const short = note("C.md", "短内容");
    expect(findDuplicates([left, right, short], vectors([left, right, short]))).toHaveLength(1);
  });

  it("flags source claims only when no reference exists", () => {
    const missing = note("无来源.md", "研究表明，主动回忆能够改善长期记忆。");
    const referenced = note("有来源.md", "研究表明，主动回忆能够改善长期记忆。\n来源：https://example.com/study");
    expect(findSourceIssues([missing, referenced])).toHaveLength(1);
    expect(findSourceIssues([missing, referenced])[0].path).toBe(missing.path);
  });

  it("marks contradictory statements as review candidates with both excerpts", () => {
    const left = note("肯定.md", "间隔重复能够改善长期记忆效果。");
    const right = note("否定.md", "间隔重复不能改善长期记忆效果。");
    const candidates = findContradictions([left, right], vectors([left, right]));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].leftLine).toBe(1);
    expect(candidates[0].rightLine).toBe(1);
  });
});
