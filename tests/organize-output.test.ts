import { describe, expect, it } from "vitest";
import { addTagsToFrontmatter, buildLinkInsertion } from "../src/organize";

describe("confirmed organization", () => {
  it("inserts a link into an existing related-notes section", () => {
    const result = buildLinkInsertion(
      "# A\n\n## 相关笔记\n\n- [[旧笔记]]\n\n## 其他\n内容",
      "目录/目标.md",
      "目标"
    );
    expect(result).toContain("- [[旧笔记]]\n- [[目录/目标|目标]]\n\n## 其他");
  });

  it("does not insert duplicate links", () => {
    const content = "# A\n\n[[目录/目标|目标]]";
    expect(buildLinkInsertion(content, "目录/目标.md", "目标")).toBe(content);
  });

  it("adds tags without duplicating existing frontmatter tags", () => {
    const result = addTagsToFrontmatter(
      "---\ntitle: A\ntags:\n  - 学习\n---\n正文",
      ["学习", "记忆"]
    );
    expect(result.match(/  - 学习/g)).toHaveLength(1);
    expect(result).toContain("  - 记忆");
  });
});
