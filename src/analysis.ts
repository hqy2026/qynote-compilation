import type {
  ContradictionCandidate,
  DuplicateCandidate,
  LinkSuggestion,
  NoteBlock,
  NoteSummary,
  SourceIssue
} from "./types";

const ENGLISH_STOP_WORDS = new Set([
  "about",
  "after",
  "and",
  "are",
  "before",
  "could",
  "for",
  "from",
  "have",
  "into",
  "not",
  "that",
  "the",
  "their",
  "there",
  "these",
  "this",
  "with",
  "would",
  "your"
]);

const CHINESE_STOP_WORDS = new Set([
  "一个",
  "一些",
  "一种",
  "不是",
  "不能",
  "可以",
  "因为",
  "所以",
  "如果",
  "我们",
  "没有",
  "通过",
  "进行",
  "这个",
  "这些",
  "需要",
  "以及",
  "或者",
  "就是",
  "已经",
  "还是",
  "并且",
  "但是",
  "由于",
  "对于",
  "关于"
]);

const WORD_SEGMENTER = new Intl.Segmenter("zh-CN", { granularity: "word" });

const SOURCE_CLAIM = /(研究表明|研究显示|数据显示|据统计|实验证明|论文指出|有研究|调查表明|according to|research shows|studies show)/i;
const SOURCE_REFERENCE = /(https?:\/\/|doi\s*:|isbn\s*:|^#+\s*(参考文献|来源|references)\s*$)/im;
const NEGATION = /(不|没有|并非|不能|不会|无关|反对|否认|not|never|cannot|no\s)/i;

export function parseNoteBlocks(content: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  const lines = content.split(/\r?\n/);
  let heading = "未分节";
  let inFrontmatter = lines[0]?.trim() === "---";
  let inCodeBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (inFrontmatter) {
      if (index > 0 && raw === "---") {
        inFrontmatter = false;
      }
      continue;
    }
    if (raw.startsWith("```") || raw.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock || !raw) {
      continue;
    }
    const headingMatch = raw.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      heading = stripMarkdown(headingMatch[1]);
      continue;
    }
    const text = stripMarkdown(raw);
    if (text.length >= 2) {
      blocks.push({ line: index + 1, text, heading });
    }
  }
  return blocks;
}

export function stripMarkdown(value: string): string {
  return value
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/!?\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_~>#-]/g, " ")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value: string, allowSingleChineseChar = false): Map<string, number> {
  const frequencies = new Map<string, number>();
  const chinesePattern = allowSingleChineseChar ? /^[\u3400-\u9fff]+$/ : /^[\u3400-\u9fff]{2,}$/;
  for (const part of WORD_SEGMENTER.segment(value)) {
    if (!part.isWordLike) {
      continue;
    }
    const term = part.segment.toLowerCase();
    if (
      (chinesePattern.test(term) && !CHINESE_STOP_WORDS.has(term)) ||
      (/^[a-z][a-z0-9_-]{1,}$/.test(term) && !ENGLISH_STOP_WORDS.has(term))
    ) {
      increment(frequencies, term);
    }
  }
  return frequencies;
}

export function tokenizeTitle(value: string): Map<string, number> {
  return tokenize(value, true);
}

export function tokenizeNoteContent(content: string): Map<string, number> {  const withoutFrontmatter = content.replace(
    /^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,
    ""
  );
  const withoutCode = withoutFrontmatter.replace(
    /(?:```|~~~)[\s\S]*?(?:```|~~~)/g,
    " "
  );
  const text = stripMarkdown(withoutCode).replace(/https?:\/\/\S+/g, " ");
  return tokenize(text);
}

export interface TfidfCorpus {
  vectors: Map<string, Map<string, number>>;
  titleVectors: Map<string, Map<string, number>>;
  rawTermCounts: Map<string, number>;
  documentFrequency: Map<string, number>;
  titleDocumentFrequency: Map<string, number>;
  maxCommonDocumentFrequency: number;
}

export function buildTfidfVectors(
  notes: NoteSummary[],
  vectors: ReadonlyMap<string, ReadonlyMap<string, number>>
): TfidfCorpus {
  const documentFrequency = new Map<string, number>();
  for (const vector of vectors.values()) {
    for (const term of vector.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const noteCount = notes.length;
  const maxCommonDocumentFrequency = Math.max(3, Math.floor(noteCount * 0.05));
  const weighted = new Map<string, Map<string, number>>();
  const rawTermCounts = new Map<string, number>();
  for (const note of notes) {
    const vector = vectors.get(note.path) ?? new Map<string, number>();
    rawTermCounts.set(note.path, vector.size);
    const terms = new Map<string, number>();
    for (const [term, frequency] of vector) {
      if ((documentFrequency.get(term) ?? 0) > maxCommonDocumentFrequency) {
        continue;
      }
      const idf = Math.log((noteCount + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1;
      terms.set(term, (1 + Math.log(frequency)) * idf);
    }
    weighted.set(note.path, terms);
  }

  const rawTitleVectors = new Map<string, Map<string, number>>();
  const titleDocumentFrequency = new Map<string, number>();
  for (const note of notes) {
    const titleVector = tokenizeTitle(note.title);
    rawTitleVectors.set(note.path, titleVector);
    for (const term of titleVector.keys()) {
      titleDocumentFrequency.set(term, (titleDocumentFrequency.get(term) ?? 0) + 1);
    }
  }
  const maxCommonTitleDocumentFrequency = Math.max(3, Math.floor(noteCount * 0.05));
  const titleVectors = new Map<string, Map<string, number>>();
  for (const [path, titleVector] of rawTitleVectors) {
    const filtered = new Map<string, number>();
    for (const [term, frequency] of titleVector) {
      if ((titleDocumentFrequency.get(term) ?? 0) <= maxCommonTitleDocumentFrequency) {
        filtered.set(term, frequency);
      }
    }
    titleVectors.set(path, filtered);
  }

  return {
    vectors: weighted,
    titleVectors,
    rawTermCounts,
    documentFrequency,
    titleDocumentFrequency,
    maxCommonDocumentFrequency
  };
}

export function cosineSimilarity(
  left: Map<string, number>,
  right: Map<string, number>
): number {
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of left.values()) {
    leftNorm += value * value;
  }
  for (const value of right.values()) {
    rightNorm += value * value;
  }
  for (const [term, value] of smaller) {
    dot += value * (larger.get(term) ?? 0);
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

export function sharedTerms(
  left: Map<string, number>,
  right: Map<string, number>,
  limit = 5
): string[] {
  return [...left.entries()]
    .filter(([term]) => right.has(term))
    .sort((a, b) => b[1] * (right.get(b[0]) ?? 0) - a[1] * (right.get(a[0]) ?? 0))
    .slice(0, limit)
    .map(([term]) => term);
}

export function findLinkSuggestions(
  source: NoteSummary,
  notes: NoteSummary[],
  corpus: TfidfCorpus,
  limit = 5
): LinkSuggestion[] {
  const sourceVector = corpus.vectors.get(source.path) ?? new Map<string, number>();
  const sourceTitleVector = corpus.titleVectors.get(source.path) ?? new Map<string, number>();
  return notes
    .filter(
      (note) =>
        note.path !== source.path &&
        !source.outgoingLinks.includes(note.path) &&
        !note.outgoingLinks.includes(source.path)
    )
    .map((note) => {
      const targetVector = corpus.vectors.get(note.path) ?? new Map<string, number>();
      const targetTitleVector = corpus.titleVectors.get(note.path) ?? new Map<string, number>();
      const contentScore = cosineSimilarity(sourceVector, targetVector);
      const titleScore = cosineSimilarity(sourceTitleVector, targetTitleVector);
      const contentEvidence = substantiveSharedTerms(sourceVector, targetVector, corpus);
      const titleEvidence = [...sourceTitleVector.keys()].filter((term) =>
        targetTitleVector.has(term)
      );
      const evidence = [...new Set([...contentEvidence, ...titleEvidence])].slice(0, 5);
      const overlapRatio = Math.min(
        1,
        evidence.length /
          Math.max(1, Math.min(substantiveTerms(sourceVector, corpus).size, substantiveTerms(targetVector, corpus).size))
      );
      const score = contentScore * 0.62 + titleScore * 0.28 + overlapRatio * 0.1;
      const strongContentMatch = contentEvidence.length >= 2 && contentScore >= 0.12;
      const strongTitleMatch = titleScore >= 0.65 && contentScore >= 0.08 && contentEvidence.length >= 1;
      const eitherIsStub =
        (corpus.rawTermCounts.get(source.path) ?? 0) <= 4 ||
        (corpus.rawTermCounts.get(note.path) ?? 0) <= 4;
      const sharedConceptTitle =
        titleScore >= 0.55 && titleEvidence.length >= 1 && eitherIsStub;
      return {
        suggestion: {
          sourcePath: source.path,
          targetPath: note.path,
          score,
          evidence,
          targetExcerpt: note.blocks[0]?.text ?? "目标笔记暂无正文摘录。"
        },
        accepted: strongContentMatch || strongTitleMatch || sharedConceptTitle
      };
    })
    .filter((item) => item.accepted)
    .map((item) => item.suggestion)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function substantiveTerms(
  vector: Map<string, number>,
  corpus: TfidfCorpus
): Set<string> {
  return new Set(
    [...vector.keys()].filter(
      (term) => (corpus.documentFrequency.get(term) ?? 0) <= corpus.maxCommonDocumentFrequency
    )
  );
}

function substantiveSharedTerms(
  left: Map<string, number>,
  right: Map<string, number>,
  corpus: TfidfCorpus
): string[] {
  const leftTerms = substantiveTerms(left, corpus);
  const rightTerms = substantiveTerms(right, corpus);
  return [...leftTerms]
    .filter((term) => rightTerms.has(term))
    .sort(
      (a, b) =>
        (right.get(b) ?? 0) * (left.get(b) ?? 0) - (right.get(a) ?? 0) * (left.get(a) ?? 0)
    )
    .slice(0, 5);
}

export function findDuplicates(
  notes: NoteSummary[],
  vectors: Map<string, Map<string, number>>
): DuplicateCandidate[] {
  const duplicates: DuplicateCandidate[] = [];
  forEachNotePair(notes, (left, right) => {
    const candidate = findDuplicateCandidate(left, right, vectors);
    if (candidate) {
      duplicates.push(candidate);
    }
  });
  return duplicates.sort((left, right) => right.similarity - left.similarity).slice(0, 50);
}

export async function findDuplicatesAsync(
  notes: NoteSummary[],
  vectors: Map<string, Map<string, number>>
): Promise<DuplicateCandidate[]> {
  const duplicates: DuplicateCandidate[] = [];
  await forEachNotePairAsync(notes, (left, right) => {
    const candidate = findDuplicateCandidate(left, right, vectors);
    if (candidate) {
      duplicates.push(candidate);
    }
  });
  return duplicates.sort((left, right) => right.similarity - left.similarity).slice(0, 50);
}

export function findSourceIssues(notes: NoteSummary[]): SourceIssue[] {
  const issues: SourceIssue[] = [];
  for (const note of notes) {
    if (SOURCE_REFERENCE.test(note.content)) {
      continue;
    }
    for (const block of note.blocks) {
      if (SOURCE_CLAIM.test(block.text)) {
        issues.push({ path: note.path, line: block.line, text: block.text });
      }
    }
  }
  return issues.slice(0, 100);
}

export function findContradictions(
  notes: NoteSummary[],
  vectors: Map<string, Map<string, number>>
): ContradictionCandidate[] {
  const candidates: ContradictionCandidate[] = [];
  forEachNotePair(notes, (left, right) => {
    const candidate = findContradictionCandidate(left, right, vectors);
    if (candidate) {
      candidates.push(candidate);
    }
  });
  return candidates.slice(0, 50);
}

export async function findContradictionsAsync(
  notes: NoteSummary[],
  vectors: Map<string, Map<string, number>>
): Promise<ContradictionCandidate[]> {
  const candidates: ContradictionCandidate[] = [];
  await forEachNotePairAsync(notes, (left, right) => {
    const candidate = findContradictionCandidate(left, right, vectors);
    if (candidate) {
      candidates.push(candidate);
    }
  });
  return candidates.slice(0, 50);
}

function findDuplicateCandidate(
  left: NoteSummary,
  right: NoteSummary,
  vectors: Map<string, Map<string, number>>
): DuplicateCandidate | null {
  if (Math.min(left.content.length, right.content.length) < 20) {
    return null;
  }
  const leftVector = vectors.get(left.path) ?? new Map<string, number>();
  const rightVector = vectors.get(right.path) ?? new Map<string, number>();
  const similarity = cosineSimilarity(leftVector, rightVector);
  const sameTitle = normalizeTitle(left.title) === normalizeTitle(right.title);
  if (similarity < 0.82 && !sameTitle) {
    return null;
  }
  return {
    paths: [left.path, right.path],
    similarity,
    evidence: sameTitle ? ["标题规范化后相同"] : sharedTerms(leftVector, rightVector)
  };
}

function findContradictionCandidate(
  left: NoteSummary,
  right: NoteSummary,
  vectors: Map<string, Map<string, number>>
): ContradictionCandidate | null {
  if (
    cosineSimilarity(vectors.get(left.path) ?? new Map(), vectors.get(right.path) ?? new Map()) <
    0.12
  ) {
    return null;
  }
  for (const leftBlock of left.blocks) {
    for (const rightBlock of right.blocks) {
      if (NEGATION.test(leftBlock.text) === NEGATION.test(rightBlock.text)) {
        continue;
      }
      if (cosineSimilarity(getBlockVector(leftBlock), getBlockVector(rightBlock)) >= 0.4) {
        return {
          leftPath: left.path,
          rightPath: right.path,
          leftLine: leftBlock.line,
          rightLine: rightBlock.line,
          leftText: leftBlock.text,
          rightText: rightBlock.text
        };
      }
    }
  }
  return null;
}

const BLOCK_VECTORS = new WeakMap<NoteBlock, Map<string, number>>();

function getBlockVector(block: NoteBlock): Map<string, number> {
  const cached = BLOCK_VECTORS.get(block);
  if (cached) {
    return cached;
  }
  const vector = tokenize(block.text);
  BLOCK_VECTORS.set(block, vector);
  return vector;
}

function forEachNotePair(
  notes: NoteSummary[],
  visit: (left: NoteSummary, right: NoteSummary) => void
): void {
  for (let leftIndex = 0; leftIndex < notes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < notes.length; rightIndex += 1) {
      visit(notes[leftIndex], notes[rightIndex]);
    }
  }
}

async function forEachNotePairAsync(
  notes: NoteSummary[],
  visit: (left: NoteSummary, right: NoteSummary) => void
): Promise<void> {
  for (let leftIndex = 0; leftIndex < notes.length; leftIndex += 1) {
    if (leftIndex > 0 && leftIndex % 10 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    for (let rightIndex = leftIndex + 1; rightIndex < notes.length; rightIndex += 1) {
      visit(notes[leftIndex], notes[rightIndex]);
    }
  }
}

function increment(frequencies: Map<string, number>, term: string): void {
  frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/(副本| copy| \d+)$/g, "")
    .replace(/[\s_\-—–·]/g, "")
    .trim();
}
