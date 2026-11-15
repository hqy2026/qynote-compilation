import { describe, expect, it } from "vitest";
import {
  buildTfidfVectors,
  findLinkSuggestions,
  parseNoteBlocks,
  tokenize,
  tokenizeNoteContent
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

function rawVectors(notes: NoteSummary[]): Map<string, Map<string, number>> {
  return new Map(notes.map((item) => [item.path, tokenizeNoteContent(item.content)]));
}

describe("local Chinese segmentation", () => {
  it("keeps natural words instead of mechanical adjacent bigrams", () => {
    const terms = tokenize("主动回忆与提取练习有助于长期记忆");
    expect([...terms.keys()]).toEqual(
      expect.arrayContaining(["主动", "回忆", "提取", "练习", "长期", "记忆"])
    );
    expect(terms.has("动回")).toBe(false);
    expect(terms.has("与")).toBe(false);
  });

  it("excludes frontmatter, fenced code and URLs from note vectors", () => {
    const terms = tokenizeNoteContent(
      "---\ntags: 隐藏标签\n---\n公开知识\n```\n秘密代码\n```\nhttps://example.com/隐藏网址"
    );
    expect(terms.has("公开")).toBe(true);
    expect(terms.has("知识")).toBe(true);
    expect(terms.has("隐藏")).toBe(false);
    expect(terms.has("标签")).toBe(false);
    expect(terms.has("秘密")).toBe(false);
    expect(terms.has("代码")).toBe(false);
  });
});

describe("TF-IDF recommendations", () => {
  it("gives rare terms more weight than terms present in every note", () => {
    const notes = [
      note("A.md", "学习 回忆"),
      note("B.md", "学习 复习"),
      note("C.md", "学习 记忆")
    ];
    const corpus = buildTfidfVectors(notes, rawVectors(notes));
    expect(corpus.vectors.get("A.md")?.get("回忆")).toBeGreaterThan(
      corpus.vectors.get("A.md")?.get("学习") ?? 0
    );
  });

  it("ranks a meaningful match above a template-only match", () => {
    const source = note("来源.md", "学习 记录 总结 主动回忆 长期记忆");
    const meaningful = note("相关.md", "学习 记录 总结 主动回忆");
    const templateOnly = note("模板.md", "学习 记录 总结");
    const filler = [
      note("补充A.md", "学习 记录 总结 间隔重复"),
      note("补充B.md", "学习 记录 总结 遗忘曲线")
    ];
    const notes = [source, meaningful, templateOnly, ...filler];
    const weighted = buildTfidfVectors(notes, rawVectors(notes));
    const suggestions = findLinkSuggestions(source, notes, weighted, 2);
    expect(suggestions[0].targetPath).toBe(meaningful.path);
    expect(suggestions[0].evidence.slice(0, 2)).toEqual(
      expect.arrayContaining(["主动", "回忆"])
    );
  });

  it("links an atomic stub note through a rare shared title word", () => {
    const stub = note("熵.md", "熵。");
    const definition = note("熵的定义.md", "熵是系统无序程度的度量指标。");
    const filler = [
      note("光合作用.md", "植物借助叶绿体把光能转化为化学能。"),
      note("板块运动.md", "地壳板块漂移引发地震和火山活动。")
    ];
    const notes = [stub, definition, ...filler];
    const suggestions = findLinkSuggestions(
      stub,
      notes,
      buildTfidfVectors(notes, rawVectors(notes)),
      3
    );
    expect(suggestions.map((item) => item.targetPath)).toContain(definition.path);
  });

  it("does not link content-rich notes that only share a generic title prefix", () => {
    const source = note("读书笔记-机器学习入门.md", "梯度下降通过迭代更新参数来最小化损失函数。");
    const samePrefix = note("读书笔记-线性回归入门.md", "最小二乘法拟合观测数据并计算残差平方和。");
    const filler = [
      note("咖啡拉花.md", "绵密奶泡的流动角度决定图案的清晰度。"),
      note("黑体辐射.md", "理想黑体的辐射能谱只由它的温度决定。")
    ];
    const notes = [source, samePrefix, ...filler];
    const suggestions = findLinkSuggestions(
      source,
      notes,
      buildTfidfVectors(notes, rawVectors(notes)),
      3
    );
    expect(suggestions.map((item) => item.targetPath)).not.toContain(samePrefix.path);
  });
});
