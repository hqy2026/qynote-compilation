import type { NoteSummary } from "./types";

export function buildLinkInsertion(
  content: string,
  targetPath: string,
  targetTitle: string
): string {
  const target = targetPath.replace(/\.md$/i, "");
  const link = `[[${target}|${targetTitle}]]`;
  if (content.includes(`[[${target}]]`) || content.includes(`[[${target}|`)) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  const sectionIndex = lines.findIndex((line) => /^##\s+相关笔记\s*$/.test(line.trim()));
  if (sectionIndex >= 0) {
    let insertAt = lines.length;
    for (let index = sectionIndex + 1; index < lines.length; index += 1) {
      if (/^#{1,2}\s+/.test(lines[index])) {
        insertAt = index;
        break;
      }
    }
    while (insertAt > sectionIndex + 1 && !lines[insertAt - 1].trim()) {
      insertAt -= 1;
    }
    lines.splice(insertAt, 0, `- ${link}`);
    return lines.join("\n");
  }
  return `${content.trimEnd()}\n\n## 相关笔记\n\n- ${link}\n`;
}

export function suggestInheritedTags(
  source: NoteSummary,
  target: NoteSummary,
  limit = 3
): string[] {
  return target.tags
    .map((tag) => tag.replace(/^#/, ""))
    .filter((tag) => tag && !source.tags.some((item) => item.replace(/^#/, "") === tag))
    .slice(0, limit);
}

export function addTagsToFrontmatter(content: string, tags: string[]): string {
  const uniqueTags = [...new Set(tags.map((tag) => tag.replace(/^#/, "").trim()).filter(Boolean))];
  if (uniqueTags.length === 0) {
    return content;
  }
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return `---\ntags:\n${uniqueTags.map((tag) => `  - ${tag}`).join("\n")}\n---\n\n${content}`;
  }

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) {
    throw new Error("笔记的 Frontmatter 缺少结束标记。");
  }
  const tagsIndex = lines.findIndex(
    (line, index) => index > 0 && index < end && /^tags\s*:/i.test(line)
  );
  if (tagsIndex < 0) {
    lines.splice(end, 0, "tags:", ...uniqueTags.map((tag) => `  - ${tag}`));
    return lines.join("\n");
  }

  const inline = lines[tagsIndex].match(/^tags\s*:\s*\[(.*)\]\s*$/i);
  if (inline) {
    const existing = inline[1].split(",").map((tag) => tag.trim()).filter(Boolean);
    const missing = uniqueTags.filter((tag) => !existing.includes(tag));
    lines[tagsIndex] = `tags: [${[...existing, ...missing].join(", ")}]`;
    return lines.join("\n");
  }

  const scalar = lines[tagsIndex].match(/^tags\s*:\s*(.+)$/i);
  if (scalar) {
    const existing = scalar[1].trim();
    lines.splice(
      tagsIndex,
      1,
      "tags:",
      `  - ${existing}`,
      ...uniqueTags.filter((tag) => tag !== existing).map((tag) => `  - ${tag}`)
    );
    return lines.join("\n");
  }

  let insertAt = tagsIndex + 1;
  const existing = new Set<string>();
  while (insertAt < end && /^\s+-\s+/.test(lines[insertAt])) {
    existing.add(lines[insertAt].replace(/^\s+-\s+/, "").trim());
    insertAt += 1;
  }
  lines.splice(
    insertAt,
    0,
    ...uniqueTags.filter((tag) => !existing.has(tag)).map((tag) => `  - ${tag}`)
  );
  return lines.join("\n");
}

export function buildOrganizedContent(
  source: NoteSummary,
  target: NoteSummary
): { content: string; tags: string[] } {
  const tags = suggestInheritedTags(source, target);
  const withLink = buildLinkInsertion(source.content, target.path, target.title);
  return { content: addTagsToFrontmatter(withLink, tags), tags };
}
