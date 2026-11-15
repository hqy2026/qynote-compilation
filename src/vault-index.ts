import { App, getAllTags, TFile } from "obsidian";
import {
  buildTfidfVectors,
  findContradictionsAsync,
  findDuplicatesAsync,
  findLinkSuggestions,
  findSourceIssues,
  parseNoteBlocks,
  tokenizeNoteContent
} from "./analysis";
import type { TfidfCorpus } from "./analysis";
import { buildTidyPlan as composeTidyPlan, type TidyPlanChange } from "./tidy-plan";
import type {
  ContradictionCandidate,
  DuplicateCandidate,
  LinkSuggestion,
  NoteBlock,
  NoteSummary,
  QYNoteCompilationSettings,
  VaultSnapshot
} from "./types";

interface CachedContent {
  mtime: number;
  content: string;
  blocks: NoteBlock[];
  vector: Map<string, number>;
}

interface DiagnosticsResult {
  revision: string;
  duplicates: DuplicateCandidate[];
  contradictions: ContradictionCandidate[];
}

export class VaultIndex {
  private readonly contentCache = new Map<string, CachedContent>();
  private latestNotes: NoteSummary[] = [];
  private noteByPath = new Map<string, NoteSummary>();
  private corpus: TfidfCorpus = {
    vectors: new Map<string, Map<string, number>>(),
    titleVectors: new Map<string, Map<string, number>>(),
    rawTermCounts: new Map<string, number>(),
    documentFrequency: new Map<string, number>(),
    titleDocumentFrequency: new Map<string, number>(),
    maxCommonDocumentFrequency: 3
  };
  private rawVectors = new Map<string, Map<string, number>>();
  private latestRevision = "";
  private diagnosticsCache: DiagnosticsResult | null = null;
  private diagnosticsPromise: Promise<DiagnosticsResult> | null = null;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => QYNoteCompilationSettings
  ) {}

  async scan(): Promise<VaultSnapshot> {
    const settings = this.getSettings();
    const files = this.app.vault.getMarkdownFiles().filter(
      (file) => !this.isExcluded(file, settings.excludedFolders)
    );
    const includedPaths = new Set(files.map((file) => file.path));
    const revision = files
      .map((file) => `${file.path}:${file.stat.mtime}:${file.stat.size}`)
      .sort()
      .join("|");

    for (const path of this.contentCache.keys()) {
      if (!includedPaths.has(path)) {
        this.contentCache.delete(path);
      }
    }

    const notes = new Map<string, NoteSummary>();
    const rawVectors = new Map<string, Map<string, number>>();

    for (const file of files) {
      const cached = await this.getContent(file);
      const metadata = this.app.metadataCache.getFileCache(file);
      const outgoingLinks = new Set<string>();

      for (const link of metadata?.links ?? []) {
        const destination = this.app.metadataCache.getFirstLinkpathDest(
          link.link,
          file.path
        );
        if (
          destination &&
          destination.path !== file.path &&
          includedPaths.has(destination.path)
        ) {
          outgoingLinks.add(destination.path);
        }
      }

      notes.set(file.path, {
        path: file.path,
        title: file.basename,
        content: cached.content,
        blocks: cached.blocks,
        outgoingLinks: [...outgoingLinks],
        incomingLinks: [],
        tags: metadata ? getAllTags(metadata) ?? [] : [],
        modifiedAt: file.stat.mtime
      });
      rawVectors.set(file.path, cached.vector);
    }

    for (const note of notes.values()) {
      for (const target of note.outgoingLinks) {
        notes.get(target)?.incomingLinks.push(note.path);
      }
    }

    const allNotes = [...notes.values()].sort((left, right) =>
      left.path.localeCompare(right.path)
    );
    this.latestNotes = allNotes;
    this.noteByPath = new Map(allNotes.map((note) => [note.path, note]));
    this.corpus = buildTfidfVectors(allNotes, rawVectors);
    this.rawVectors = rawVectors;
    this.latestRevision = revision;
    const orphanNotes = allNotes
      .filter(
        (note) =>
          note.incomingLinks.length === 0 && note.outgoingLinks.length === 0
      )
      .sort((left, right) => right.modifiedAt - left.modifiedAt);
    const staleThreshold = Date.now() - settings.staleDays * 24 * 60 * 60 * 1000;
    const diagnostics = this.diagnosticsCache?.revision === revision
      ? this.diagnosticsCache
      : null;

    return {
      notes: allNotes,
      orphanNotes,
      staleNotes: allNotes
        .filter((note) => note.modifiedAt < staleThreshold)
        .sort((left, right) => left.modifiedAt - right.modifiedAt),
      duplicates: diagnostics?.duplicates ?? [],
      contradictions: diagnostics?.contradictions ?? [],
      diagnosticsReady: Boolean(diagnostics),
      sourceIssues: findSourceIssues(allNotes),
      totalLinks: allNotes.reduce(
        (total, note) => total + note.outgoingLinks.length,
        0
      ),
      scannedAt: Date.now(),
      revision
    };
  }

  async scanDiagnostics(): Promise<DiagnosticsResult> {
    if (this.diagnosticsCache?.revision === this.latestRevision) {
      return this.diagnosticsCache;
    }
    if (this.diagnosticsPromise) {
      return this.diagnosticsPromise;
    }

    const revision = this.latestRevision;
    const notes = this.latestNotes;
    const vectors = this.rawVectors;
    this.diagnosticsPromise = (async () => {
      const [duplicates, contradictions] = await Promise.all([
        findDuplicatesAsync(notes, vectors),
        findContradictionsAsync(notes, vectors)
      ]);
      const result = { revision, duplicates, contradictions };
      if (this.latestRevision === revision) {
        this.diagnosticsCache = result;
      }
      return result;
    })();

    try {
      return await this.diagnosticsPromise;
    } finally {
      this.diagnosticsPromise = null;
    }
  }

  getNote(path: string): NoteSummary | undefined {
    return this.noteByPath.get(path);
  }

  getLinkSuggestions(path: string): LinkSuggestion[] {
    const source = this.getNote(path);
    return source
      ? findLinkSuggestions(source, this.latestNotes, this.corpus)
      : [];
  }

  getTidyPlan(
    duplicates: DuplicateCandidate[],
    contradictions: ContradictionCandidate[],
    limit = 20
  ): TidyPlanChange[] {
    return composeTidyPlan({
      notes: this.latestNotes,
      corpus: this.corpus,
      duplicates,
      contradictions,
      limit
    });
  }

  private async getContent(file: TFile): Promise<CachedContent> {
    const cached = this.contentCache.get(file.path);
    if (cached?.mtime === file.stat.mtime) {
      return cached;
    }
    const content = await this.app.vault.cachedRead(file);
    const next = {
      mtime: file.stat.mtime,
      content,
      blocks: parseNoteBlocks(content),
      vector: tokenizeNoteContent(content)
    };
    this.contentCache.set(file.path, next);
    return next;
  }

  private isExcluded(file: TFile, excludedFolders: string[]): boolean {
    return excludedFolders.some((folder) =>
      file.path.startsWith(`${folder}/`)
    );
  }
}
