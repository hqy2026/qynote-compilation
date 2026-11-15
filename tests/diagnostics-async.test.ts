import { describe, expect, it } from "vitest";
import {
  findContradictions,
  findContradictionsAsync,
  findDuplicates,
  findDuplicatesAsync,
  parseNoteBlocks,
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

function vectors(notes: NoteSummary[]): Map<string, Map<string, number>> {
  return new Map(notes.map((item) => [item.path, tokenizeNoteContent(item.content)]));
}

describe("chunked diagnostics", () => {
  it("matches synchronous duplicate and contradiction results", async () => {
    const notes = [
      note("A.md", "这是一段用于验证重复检测的完整笔记内容，包含足够多的文字与相同概念。"),
      note("B.md", "这是一段用于验证重复检测的完整笔记内容，包含足够多的文字与相同概念。"),
      note("C.md", "间隔重复能够改善长期记忆效果。"),
      note("D.md", "间隔重复不能改善长期记忆效果。")
    ];
    const shared = vectors(notes);
    await expect(findDuplicatesAsync(notes, shared)).resolves.toEqual(findDuplicates(notes, shared));
    await expect(findContradictionsAsync(notes, shared)).resolves.toEqual(
      findContradictions(notes, shared)
    );
  });

  it("yields to the event loop during a large comparison", async () => {
    const notes = Array.from({ length: 150 }, (_, index) =>
      note(`笔记${index}.md`, `这是第${index}篇包含不同主题与学习内容的笔记，用于性能验证。`)
    );
    let yielded = false;
    setTimeout(() => {
      yielded = true;
    }, 0);
    await findDuplicatesAsync(notes, vectors(notes));
    expect(yielded).toBe(true);
  });

  it("inverted-index candidates match the exact pairwise scan on a large diverse vault", async () => {
    const notes: NoteSummary[] = [];
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    // ~900 notes drawing from a large pool so cross-note term overlap is rare.
    for (let index = 0; index < 900; index += 1) {
      const terms = Array.from({ length: 6 }, () => `w${random() % 20000}`).join(" ");
      notes.push(note(`独立${index}.md`, `概念 ${terms} 的说明文字，需要超过长度阈值以参与比较。`));
    }
    // seeded duplicate pair (identical body -> cosine 1)
    notes.push(note("重复甲.md", "统一指标 alpha beta gamma 的完整说明内容用于重复检测。"));
    notes.push(note("重复乙.md", "统一指标 alpha beta gamma 的完整说明内容用于重复检测。"));
    // seeded contradiction pair (shared terms, opposite negation)
    notes.push(note("正方.md", "方法 sigma 能够改善长期记忆的整体效果表现。"));
    notes.push(note("反方.md", "方法 sigma 不能改善长期记忆的整体效果表现。"));

    const shared = vectors(notes);
    expect((await findDuplicatesAsync(notes, shared)).length).toBeGreaterThan(0);
    expect(await findDuplicatesAsync(notes, shared)).toEqual(findDuplicates(notes, shared));
    expect(await findContradictionsAsync(notes, shared)).toEqual(findContradictions(notes, shared));
  });
});
