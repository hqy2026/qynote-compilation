const initialNotes = [
  {
    path: "学习科学.md",
    tags: ["学习"],
    content: `---
tags:
  - 学习
---
# 学习科学

主动回忆是指不查看材料，主动从记忆中提取信息。

间隔重复能够改善长期记忆效果，相关方法见[[间隔重复]]。`
  },
  {
    path: "间隔重复.md",
    tags: ["学习", "复习"],
    content: `# 间隔重复

间隔重复是指根据遗忘规律安排复习时间。

**遗忘曲线**能够帮助我们理解复习间隔。`
  },
  {
    path: "主动回忆.md",
    tags: ["学习", "记忆"],
    content: `---
tags:
  - 学习
  - 记忆
---
# 主动回忆

主动回忆与提取练习能够帮助长期记忆，强调不查看答案的学习过程。

主动回忆是指从记忆中主动提取信息，而不是重复阅读。`
  },
  {
    path: "研究摘录.md",
    tags: ["待验证"],
    content: `# 研究摘录

研究表明，主动回忆能够改善长期记忆，但这句摘录没有附出来源。`
  },
  {
    path: "相反观点.md",
    tags: ["争议"],
    content: `# 相反观点

间隔重复不能改善长期记忆效果。`
  },
  {
    path: "重复 A.md",
    tags: ["模板"],
    content: `# 重复 A

这是一段用于验证重复检测的完整笔记内容，包含足够多的文字与相同概念。`
  },
  {
    path: "重复 B.md",
    tags: ["模板"],
    content: `# 重复 B

这是一段用于验证重复检测的完整笔记内容，包含足够多的文字与相同概念。`
  },
  {
    path: "番茄工作法.md",
    tags: ["方法"],
    content: `# 番茄工作法

番茄工作法是指把工作时间划分为专注阶段和休息阶段。`
  }
];

const englishStopWords = new Set(["the", "and", "for", "with", "this", "that", "from", "have", "would"]);
const chineseStopWords = new Set(["一个", "一些", "不是", "不能", "可以", "因为", "所以", "如果", "我们", "没有", "通过", "进行", "这个", "这些", "需要", "以及", "或者", "就是", "已经", "还是", "并且", "但是", "由于", "对于", "关于"]);
const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("zh-CN", { granularity: "word" }) : null;

const state = {
  notes: [],
  currentPath: "学习科学.md",
  corpus: null,
  suggestions: [],
  pendingDiff: null,
  lastChange: null,
  activeTab: "organize",
  plan: null,
  planConfirmMode: null
};

const elements = {
  fileList: document.getElementById("fileList"),
  vaultCount: document.getElementById("vaultCount"),
  noteTitle: document.getElementById("noteTitle"),
  notePath: document.getElementById("notePath"),
  noteContent: document.getElementById("noteContent"),
  organizeCurrent: document.getElementById("organizeCurrent"),
  suggestions: document.getElementById("suggestions"),
  organizeResult: document.getElementById("organizeResult"),
  diffPreview: document.getElementById("diffPreview"),
  diffDescription: document.getElementById("diffDescription"),
  diffBefore: document.getElementById("diffBefore"),
  diffAfter: document.getElementById("diffAfter"),
  undoOrganization: document.getElementById("undoOrganization"),
  planGenerate: document.getElementById("planGenerate"),
  planList: document.getElementById("planList"),
  planResult: document.getElementById("planResult"),
  planConfirm: document.getElementById("planConfirm"),
  planConfirmBody: document.getElementById("planConfirmBody"),
  planConfirmApply: document.getElementById("planConfirmApply"),
  planConfirmCancel: document.getElementById("planConfirmCancel"),
  planQuick: document.getElementById("planQuick"),
  planUndo: document.getElementById("planUndo")
};

function cloneNotes() {
  return initialNotes.map((note) => ({ ...note, tags: [...note.tags] }));
}

function parseBlocks(content) {
  const lines = content.split(/\r?\n/);
  const blocks = [];
  let inFrontmatter = lines[0]?.trim() === "---";
  let inCode = false;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (inFrontmatter) {
      if (index > 0 && raw === "---") {
        inFrontmatter = false;
      }
      continue;
    }
    if (raw.startsWith("```") || raw.startsWith("~~~")) {
      inCode = !inCode;
      continue;
    }
    if (inCode || !raw || /^#{1,6}\s+/.test(raw)) {
      continue;
    }
    blocks.push({ line: index + 1, text: readableText(raw) });
  }
  return blocks;
}

function readableText(value) {
  return value
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/!?\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function outgoingLinks(content) {
  return [...new Set([...content.matchAll(/!?\[\[([^\]|#]+)/g)].map((match) => `${match[1].trim()}.md`))];
}

function tokenize(value, allowSingleChineseChar = false) {
  const frequencies = new Map();
  const chinesePattern = allowSingleChineseChar ? /^[\u3400-\u9fff]+$/ : /^[\u3400-\u9fff]{2,}$/;
  const text = readableText(value);
  if (segmenter) {
    for (const part of segmenter.segment(text)) {
      if (!part.isWordLike) {
        continue;
      }
      const term = part.segment.toLowerCase();
      if (
        (chinesePattern.test(term) && !chineseStopWords.has(term)) ||
        (/^[a-z][a-z0-9_-]{1,}$/.test(term) && !englishStopWords.has(term))
      ) {
        frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
      }
    }
    return frequencies;
  }

  const english = text.toLowerCase().match(/[a-z][a-z0-9_-]{1,}/g) ?? [];
  for (const word of english) {
    if (!englishStopWords.has(word)) {
      frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
    }
  }
  for (const sequence of text.match(/[\u3400-\u9fff]{2,}/g) ?? []) {
    for (let index = 0; index < sequence.length - 1; index += 1) {
      const term = sequence.slice(index, index + 2);
      if (!chineseStopWords.has(term)) {
        frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
      }
    }
  }
  return frequencies;
}

function tokenizeTitle(value) {
  return tokenize(value, true);
}

function tokenizeContent(content) {
  const withoutFrontmatter = content.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, " ");
  const withoutCode = withoutFrontmatter.replace(/(?:```|~~~)[\s\S]*?(?:```|~~~)/g, " ");
  const text = withoutCode.replace(/https?:\/\/\S+/g, " ");
  return tokenize(text);
}

function buildVectors() {
  const raw = new Map(state.notes.map((note) => [note.path, tokenizeContent(note.content)]));
  const documentFrequency = new Map();
  for (const vector of raw.values()) {
    for (const term of vector.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const total = state.notes.length;
  const maxCommonDocumentFrequency = Math.max(3, Math.floor(total * 0.05));
  const vectors = new Map();
  const rawTermCounts = new Map();
  for (const note of state.notes) {
    const source = raw.get(note.path) ?? new Map();
    rawTermCounts.set(note.path, source.size);
    const terms = new Map();
    for (const [term, frequency] of source) {
      if ((documentFrequency.get(term) ?? 0) > maxCommonDocumentFrequency) {
        continue;
      }
      const idf = Math.log((total + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1;
      terms.set(term, (1 + Math.log(frequency)) * idf);
    }
    vectors.set(note.path, terms);
  }

  const rawTitleVectors = new Map();
  const titleDocumentFrequency = new Map();
  for (const note of state.notes) {
    const titleVector = tokenizeTitle(titleFromPath(note.path));
    rawTitleVectors.set(note.path, titleVector);
    for (const term of titleVector.keys()) {
      titleDocumentFrequency.set(term, (titleDocumentFrequency.get(term) ?? 0) + 1);
    }
  }
  const titleVectors = new Map();
  for (const [path, titleVector] of rawTitleVectors) {
    const filtered = new Map();
    for (const [term, frequency] of titleVector) {
      if ((titleDocumentFrequency.get(term) ?? 0) <= maxCommonDocumentFrequency) {
        filtered.set(term, frequency);
      }
    }
    titleVectors.set(path, filtered);
  }

  state.corpus = { vectors, titleVectors, rawTermCounts, documentFrequency, maxCommonDocumentFrequency };
}

function cosine(left, right) {
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of left.values()) leftNorm += value * value;
  for (const value of right.values()) rightNorm += value * value;
  for (const [term, value] of smaller) dot += value * (larger.get(term) ?? 0);
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function sharedTerms(left, right) {
  return [...left.entries()]
    .filter(([term]) => right.has(term))
    .sort((a, b) => b[1] * (right.get(b[0]) ?? 0) - a[1] * (right.get(a[0]) ?? 0))
    .slice(0, 5)
    .map(([term]) => term);
}

function scoreSuggestions(source) {
  const corpus = state.corpus;
  const sourceVector = corpus.vectors.get(source.path) ?? new Map();
  const sourceTitleVector = corpus.titleVectors.get(source.path) ?? new Map();
  const sourceLinks = new Set(outgoingLinks(source.content));
  return state.notes
    .filter((note) =>
      note.path !== source.path &&
      !sourceLinks.has(note.path) &&
      !outgoingLinks(note.content).includes(source.path)
    )
    .map((note) => {
      const targetVector = corpus.vectors.get(note.path) ?? new Map();
      const targetTitleVector = corpus.titleVectors.get(note.path) ?? new Map();
      const contentScore = cosine(sourceVector, targetVector);
      const titleScore = cosine(sourceTitleVector, targetTitleVector);
      const contentEvidence = sharedTerms(sourceVector, targetVector);
      const titleEvidence = [...sourceTitleVector.keys()].filter((term) => targetTitleVector.has(term));
      const evidence = [...new Set([...contentEvidence, ...titleEvidence])].slice(0, 5);
      const overlapRatio = Math.min(1, evidence.length / Math.max(1, Math.min(sourceVector.size, targetVector.size)));
      const score = contentScore * 0.62 + titleScore * 0.28 + overlapRatio * 0.1;
      const strongContentMatch = contentEvidence.length >= 2 && contentScore >= 0.12;
      const strongTitleMatch = titleScore >= 0.65 && contentScore >= 0.08 && contentEvidence.length >= 1;
      const eitherIsStub =
        (corpus.rawTermCounts.get(source.path) ?? 0) <= 4 ||
        (corpus.rawTermCounts.get(note.path) ?? 0) <= 4;
      const sharedConceptTitle = titleScore >= 0.55 && titleEvidence.length >= 1 && eitherIsStub;
      const accepted = strongContentMatch || strongTitleMatch || sharedConceptTitle;
      return {
        path: note.path,
        title: titleFromPath(note.path),
        score,
        evidence,
        excerpt: parseBlocks(note.content)[0]?.text ?? "目标笔记暂无正文摘录。",
        accepted
      };
    })
    .sort((a, b) => b.score - a.score);
}

function refreshSuggestions() {
  state.suggestions = scoreSuggestions(currentNote()).filter((item) => item.accepted).slice(0, 4);
}

const NEGATION = /(不|没有|并非|不能|不会|无关|反对|否认|not|never|cannot|no\s)/i;

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/(副本| copy| \d+)$/g, "")
    .replace(/[\s_\-—–·]/g, "")
    .trim();
}

function planNotes() {
  return state.notes.map((note) => ({
    ...note,
    title: titleFromPath(note.path),
    blocks: parseBlocks(note.content)
  }));
}

function findDuplicatesDemo(notes, vectors) {
  const duplicates = [];
  for (let i = 0; i < notes.length; i += 1) {
    for (let j = i + 1; j < notes.length; j += 1) {
      const left = notes[i];
      const right = notes[j];
      if (Math.min(left.content.length, right.content.length) < 20) continue;
      const similarity = cosine(vectors.get(left.path) ?? new Map(), vectors.get(right.path) ?? new Map());
      const sameTitle = normalizeTitle(left.title) === normalizeTitle(right.title);
      if (similarity < 0.82 && !sameTitle) continue;
      duplicates.push({ paths: [left.path, right.path], similarity });
    }
  }
  return duplicates.sort((a, b) => b.similarity - a.similarity).slice(0, 50);
}

function findContradictionsDemo(notes, vectors) {
  const candidates = [];
  for (let i = 0; i < notes.length; i += 1) {
    for (let j = i + 1; j < notes.length; j += 1) {
      const left = notes[i];
      const right = notes[j];
      if (cosine(vectors.get(left.path) ?? new Map(), vectors.get(right.path) ?? new Map()) < 0.12) continue;
      let found = null;
      for (const leftBlock of left.blocks) {
        for (const rightBlock of right.blocks) {
          if (NEGATION.test(leftBlock.text) === NEGATION.test(rightBlock.text)) continue;
          if (cosine(tokenize(leftBlock.text), tokenize(rightBlock.text)) >= 0.4) {
            found = {
              leftPath: left.path,
              rightPath: right.path,
              leftLine: leftBlock.line,
              rightLine: rightBlock.line,
              leftText: leftBlock.text,
              rightText: rightBlock.text
            };
            break;
          }
        }
        if (found) break;
      }
      if (found) candidates.push(found);
    }
  }
  return candidates.slice(0, 50);
}

function buildMergeChangeDemo(keep, drop, similarity) {
  const normalize = (value) => value.replace(/\s+/g, "").trim();
  const keepNorm = normalize(keep.content);
  const additions = drop.blocks.map((b) => b.text).filter((text) => text && !keepNorm.includes(normalize(text)));
  const section =
    `\n\n## 合并自 [[${titleFromPath(drop.path)}]]\n\n` +
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
    willNotTouch: drop.path,
    detectedSimilarity: similarity ?? null
  };
}

function buildContradictionChangeDemo(source, conflicting, match) {
  const sourceIsLeft = match.leftPath === source.path;
  const sourceText = sourceIsLeft ? match.leftText : match.rightText;
  const sourceLine = sourceIsLeft ? match.leftLine : match.rightLine;
  const otherText = sourceIsLeft ? match.rightText : match.leftText;
  const otherLine = sourceIsLeft ? match.rightLine : match.leftLine;
  const section =
    `\n\n## ⚠️ 冲突提示\n\n` +
    `> 本笔记第 ${sourceLine} 行与另一处观点可能冲突，建议人工核对（原文不改）：\n>\n` +
    `> - 本篇：“${sourceText}”\n` +
    `> - [[${titleFromPath(conflicting.path)}]] 第 ${otherLine} 行：“${otherText}”\n`;
  const after = `${source.content.trimEnd()}${section}`;
  return {
    path: source.path,
    kind: "contradiction",
    summary: `标注与 [[${conflicting.title}]] 的观点冲突（仅追加提示，不改原句）`,
    before: source.content,
    after
  };
}

function buildLinkChangeDemo(source, target) {
  const alias = titleFromPath(target.path);
  if (source.content.includes(`[[${alias}]]`) || source.content.includes(`[[${alias}|`)) {
    return null;
  }
  const link = alias === target.title ? `[[${alias}]]` : `[[${alias}|${target.title}]]`;
  const after = `${source.content.trimEnd()}\n\n## 相关笔记\n\n- ${link}\n`;
  return {
    path: source.path,
    kind: "link",
    summary: `关联 [[${target.title}]]`,
    before: source.content,
    after
  };
}

function buildTidyPlanDemo(limit = 20) {
  const notes = planNotes();
  const vectors = state.corpus.vectors;
  const noteByPath = new Map(notes.map((note) => [note.path, note]));
  const touched = new Set();
  const changes = [];

  for (const item of findDuplicatesDemo(notes, vectors).filter((pair) => pair.similarity >= 0.9)) {
    const [keepPath, dropPath] = [...item.paths].sort((a, b) => a.localeCompare(b));
    const keep = noteByPath.get(keepPath);
    const drop = noteByPath.get(dropPath);
    if (!keep || !drop || touched.has(keep.path)) continue;
    changes.push(buildMergeChangeDemo(keep, drop, item.similarity));
    touched.add(keep.path);
  }

  for (const item of findContradictionsDemo(notes, vectors)) {
    const source = noteByPath.get(item.leftPath);
    const conflicting = noteByPath.get(item.rightPath);
    if (!source || !conflicting || touched.has(source.path)) continue;
    changes.push(buildContradictionChangeDemo(source, conflicting, item));
    touched.add(source.path);
  }

  for (const note of notes) {
    if (touched.has(note.path)) continue;
    const best = scoreSuggestions(note).find(
      (s) => s.evidence.length >= 2 && s.score >= 0.25 && !touched.has(s.path)
    );
    const target = best ? noteByPath.get(best.path) : undefined;
    if (!best || !target) continue;
    const change = buildLinkChangeDemo(note, target);
    if (!change) continue;
    changes.push(change);
    touched.add(note.path);
  }

  return changes.slice(0, limit);
}

function appendedTextDemo(change) {
  return change.after.slice(change.before.trimEnd().length);
}

function currentNote() {
  return state.notes.find((note) => note.path === state.currentPath) ?? state.notes[0];
}

function titleFromPath(path) {
  return path.replace(/\.md$/, "").split("/").pop();
}

function renderFileList() {
  elements.fileList.replaceChildren();
  elements.vaultCount.textContent = `${state.notes.length} 篇笔记`;
  for (const note of state.notes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `file-item${note.path === state.currentPath ? " is-active" : ""}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(note.path === state.currentPath));
    const title = document.createElement("span");
    title.textContent = titleFromPath(note.path);
    const meta = document.createElement("span");
    meta.textContent = `${outgoingLinks(note.content).length} 条双链`;
    button.append(title, meta);
    button.addEventListener("click", () => {
      state.currentPath = note.path;
      state.pendingDiff = null;
      refreshAll();
    });
    elements.fileList.appendChild(button);
  }
}

function renderNotePreview() {
  const note = currentNote();
  elements.noteTitle.textContent = titleFromPath(note.path);
  elements.notePath.textContent = note.path;
  elements.noteContent.textContent = note.content;
  elements.organizeCurrent.textContent = titleFromPath(note.path);
}

function renderSuggestions() {
  elements.suggestions.replaceChildren();
  if (state.suggestions.length === 0) {
    elements.suggestions.appendChild(makeEmpty("暂无推荐。可以先补充正文或选择另一篇笔记。"));
    return;
  }
  for (const suggestion of state.suggestions) {
    const card = document.createElement("article");
    card.className = "suggestion";
    const top = document.createElement("div");
    top.className = "suggestion__top";
    const title = document.createElement("strong");
    title.textContent = suggestion.title;
    const score = document.createElement("span");
    score.className = "muted";
    score.textContent = `相关度 ${(suggestion.score * 100).toFixed(1)}`;
    top.append(title, score);
    const evidence = document.createElement("p");
    evidence.className = "evidence";
    evidence.textContent = `相关依据：${suggestion.evidence.join("、")}`;
    const excerpt = document.createElement("p");
    excerpt.className = "excerpt";
    excerpt.textContent = suggestion.excerpt;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button primary";
    button.textContent = "查看修改预览";
    button.addEventListener("click", () => prepareDiff(suggestion.path));
    card.append(top, evidence, excerpt, button);
    elements.suggestions.appendChild(card);
  }
}

function makeEmpty(text) {
  const node = document.createElement("p");
  node.className = "empty";
  node.textContent = text;
  return node;
}

function buildLinkedContent(note, targetPath) {
  const target = targetPath.replace(/\.md$/, "");
  const targetTitle = titleFromPath(targetPath);
  const link = `[[${target}|${targetTitle}]]`;
  let content = note.content;
  if (!content.includes(`[[${target}]]`) && !content.includes(`[[${target}|`)) {
    content = `${content.trimEnd()}\n\n## 相关笔记\n\n- ${link}\n`;
  }
  const targetNote = state.notes.find((item) => item.path === targetPath);
  const newTags = (targetNote?.tags ?? []).filter((tag) => !note.tags.includes(tag)).slice(0, 2);
  if (newTags.length) {
    content = addTags(content, newTags);
  }
  return { content, tags: newTags };
}

function addTags(content, tags) {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return `---\ntags:\n${tags.map((tag) => `  - ${tag}`).join("\n")}\n---\n\n${content}`;
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) {
    return `${content}\n\n标签：${tags.join("、")}`;
  }
  const tagsIndex = lines.findIndex((line, index) => index > 0 && index < end && /^tags\s*:/i.test(line));
  if (tagsIndex < 0) {
    lines.splice(end, 0, "tags:", ...tags.map((tag) => `  - ${tag}`));
    return lines.join("\n");
  }
  const scalar = lines[tagsIndex].match(/^tags\s*:\s*(.+)$/i);
  if (scalar) {
    lines.splice(tagsIndex, 1, "tags:", `  - ${scalar[1].trim()}`, ...tags.map((tag) => `  - ${tag}`));
    return lines.join("\n");
  }
  let insertAt = tagsIndex + 1;
  while (insertAt < end && /^\s+-\s+/.test(lines[insertAt])) insertAt += 1;
  lines.splice(insertAt, 0, ...tags.map((tag) => `  - ${tag}`));
  return lines.join("\n");
}

function prepareDiff(targetPath) {
  const note = currentNote();
  const result = buildLinkedContent(note, targetPath);
  if (result.content === note.content) {
    showResult(elements.organizeResult, "这条关联已经存在。", true);
    return;
  }
  state.pendingDiff = { path: note.path, before: note.content, after: result.content, targetPath };
  elements.diffPreview.hidden = false;
  elements.diffDescription.textContent = `添加 [[${titleFromPath(targetPath)}]]${result.tags.length ? `，并继承标签：${result.tags.join("、")}` : ""}。`;
  elements.diffBefore.textContent = note.content;
  elements.diffAfter.textContent = result.content;
}

function confirmDiff() {
  if (!state.pendingDiff) {
    return;
  }
  const note = state.notes.find((item) => item.path === state.pendingDiff.path);
  if (!note) {
    return;
  }
  state.lastChange = { files: [{ path: note.path, before: note.content }] };
  note.content = state.pendingDiff.after;
  const target = state.notes.find((item) => item.path === state.pendingDiff.targetPath);
  if (target) {
    note.tags = [...new Set([...note.tags, ...target.tags.filter((tag) => !note.tags.includes(tag)).slice(0, 2)])];
  }
  state.pendingDiff = null;
  elements.diffPreview.hidden = true;
  elements.undoOrganization.hidden = false;
  refreshAll();
}

function undoLastChange() {
  if (!state.lastChange) {
    return;
  }
  for (const file of state.lastChange.files) {
    const note = state.notes.find((item) => item.path === file.path);
    if (note) {
      note.content = file.before;
    }
  }
  state.lastChange = null;
  elements.undoOrganization.hidden = true;
  elements.planUndo.hidden = true;
  refreshAll();
}

function refreshAll() {
  buildVectors();
  refreshSuggestions();
  renderFileList();
  renderNotePreview();
  renderSuggestions();
  renderPlan();
}

function showResult(node, text, success) {
  node.textContent = text;
  node.className = `result${success ? " success" : ""}`;
}

const PLAN_KIND_LABEL = { merge: "合并重复", contradiction: "标注矛盾", link: "补充双链" };

function generatePlan() {
  state.plan = buildTidyPlanDemo(20);
  state.planConfirmMode = null;
  elements.planConfirm.hidden = true;
  renderPlan();
  showResult(
    elements.planResult,
    state.plan.length === 0
      ? "没有达到阈值的整理项，库已经很整洁。"
      : `已生成 ${state.plan.length} 处整理建议，每个文件最多改一处。`,
    true
  );
}

function renderPlan() {
  elements.planList.replaceChildren();
  const plan = state.plan;
  if (!plan) {
    elements.planList.appendChild(makeEmpty("点击“生成整库计划”开始：合并高相似重复、标注矛盾、补高置信双链。"));
    elements.planQuick.hidden = true;
    return;
  }
  if (plan.length === 0) {
    elements.planList.appendChild(makeEmpty("没有达到阈值的整理项。"));
    elements.planQuick.hidden = true;
    return;
  }
  for (const change of plan) {
    const card = document.createElement("article");
    card.className = "plan-item";
    const head = document.createElement("div");
    head.className = "plan-item__head";
    const kind = document.createElement("span");
    kind.className = `plan-kind is-${change.kind}`;
    kind.textContent = PLAN_KIND_LABEL[change.kind] ?? change.kind;
    const path = document.createElement("strong");
    path.textContent = change.path;
    head.append(kind, path);
    const summary = document.createElement("p");
    summary.className = "muted";
    summary.textContent = change.summary;
    card.append(head, summary);
    if (change.willNotTouch) {
      const keep = document.createElement("p");
      keep.className = "muted";
      keep.textContent = `来源 ${change.willNotTouch} 保持不变，不会被删除。`;
      card.appendChild(keep);
    }
    const details = document.createElement("details");
    const sum = document.createElement("summary");
    sum.textContent = "查看将追加的内容";
    const pre = document.createElement("pre");
    pre.className = "plan-tail";
    pre.textContent = appendedTextDemo(change).trim() || "（无新增内容）";
    details.append(sum, pre);
    card.appendChild(details);
    elements.planList.appendChild(card);
  }
  elements.planQuick.hidden = false;
  elements.planQuick.textContent = `一键应用全部 ${plan.length} 处（跳过逐项预览）`;
}

function openPlanConfirm(mode) {
  const plan = state.plan;
  if (!plan || plan.length === 0) {
    showResult(elements.planResult, "请先生成整库计划。", false);
    return;
  }
  state.planConfirmMode = mode;
  elements.planConfirmBody.replaceChildren();
  const intro = document.createElement("p");
  intro.textContent =
    mode === "preview"
      ? `将向 ${plan.length} 篇笔记追加整理内容（合并独有段落 / 标注矛盾 / 补双链）。每个文件最多改一处，不改原文、不删除。逐条核对后确认。`
      : `将应用 ${plan.length} 处整理：仅追加、不改原文、不删除，每个文件最多改一处。应用后可整体撤销。`;
  elements.planConfirmBody.appendChild(intro);
  if (mode === "preview") {
    for (const change of plan) {
      const section = document.createElement("div");
      section.className = "plan-item";
      const h = document.createElement("strong");
      h.textContent = `${PLAN_KIND_LABEL[change.kind]} · ${change.path}`;
      const pre = document.createElement("pre");
      pre.className = "plan-tail";
      pre.textContent = appendedTextDemo(change).trim();
      section.append(h, pre);
      elements.planConfirmBody.appendChild(section);
    }
  }
  elements.planConfirmApply.textContent = `确认应用 ${plan.length} 处`;
  elements.planConfirm.hidden = false;
}

function applyPlan() {
  const plan = state.plan;
  if (!plan || plan.length === 0) {
    return;
  }
  state.lastChange = { files: plan.map((change) => ({ path: change.path, before: change.before })) };
  for (const change of plan) {
    const note = state.notes.find((item) => item.path === change.path);
    if (note) {
      note.content = change.after;
    }
  }
  state.plan = null;
  state.planConfirmMode = null;
  elements.planConfirm.hidden = true;
  elements.planUndo.hidden = false;
  showResult(elements.planResult, `已应用 ${plan.length} 处整理，可整体撤销。`, true);
  refreshAll();
}

function activateTab(name) {
  state.activeTab = name;
  for (const tab of document.querySelectorAll(".tab")) {
    const selected = tab.dataset.tab === name;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  }
  document.getElementById("organize-panel").hidden = name !== "organize";
  document.getElementById("plan-panel").hidden = name !== "plan";
}

function resetDemo() {
  state.notes = cloneNotes();
  state.currentPath = "学习科学.md";
  state.pendingDiff = null;
  state.lastChange = null;
  state.plan = null;
  state.planConfirmMode = null;
  elements.diffPreview.hidden = true;
  elements.undoOrganization.hidden = true;
  elements.planUndo.hidden = true;
  elements.planConfirm.hidden = true;
  elements.organizeResult.textContent = "";
  elements.planResult.textContent = "";
  refreshAll();
}

function initialize() {
  state.notes = cloneNotes();
  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  }
  document.getElementById("resetDemo").addEventListener("click", resetDemo);
  document.getElementById("confirmDiff").addEventListener("click", confirmDiff);
  document.getElementById("cancelDiff").addEventListener("click", () => {
    state.pendingDiff = null;
    elements.diffPreview.hidden = true;
  });
  elements.undoOrganization.addEventListener("click", undoLastChange);
  elements.planGenerate.addEventListener("click", generatePlan);
  elements.planQuick.addEventListener("click", () => openPlanConfirm("quick"));
  document.getElementById("planPreviewApply").addEventListener("click", () => openPlanConfirm("preview"));
  elements.planConfirmApply.addEventListener("click", applyPlan);
  elements.planConfirmCancel.addEventListener("click", () => {
    state.planConfirmMode = null;
    elements.planConfirm.hidden = true;
  });
  elements.planUndo.addEventListener("click", undoLastChange);
  activateTab("organize");
  refreshAll();
}

initialize();
