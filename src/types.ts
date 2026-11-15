export interface QYNoteCompilationSettings {
  excludedFolders: string[];
  staleDays: number;
}

export const DEFAULT_SETTINGS: QYNoteCompilationSettings = {
  excludedFolders: [],
  staleDays: 180
};

export interface NoteBlock {
  line: number;
  text: string;
  heading: string;
}

export interface NoteSummary {
  path: string;
  title: string;
  content: string;
  blocks: NoteBlock[];
  outgoingLinks: string[];
  incomingLinks: string[];
  tags: string[];
  modifiedAt: number;
}

export interface LinkSuggestion {
  sourcePath: string;
  targetPath: string;
  score: number;
  evidence: string[];
  targetExcerpt: string;
}

export interface DuplicateCandidate {
  paths: [string, string];
  similarity: number;
  evidence: string[];
}

export interface ContradictionCandidate {
  leftPath: string;
  rightPath: string;
  leftLine: number;
  rightLine: number;
  leftText: string;
  rightText: string;
}

export interface SourceIssue {
  path: string;
  line: number;
  text: string;
}

export interface VaultSnapshot {
  notes: NoteSummary[];
  orphanNotes: NoteSummary[];
  staleNotes: NoteSummary[];
  duplicates: DuplicateCandidate[];
  contradictions: ContradictionCandidate[];
  diagnosticsReady: boolean;
  sourceIssues: SourceIssue[];
  totalLinks: number;
  scannedAt: number;
  revision: string;
}

export interface ChangeBackup {
  createdAt: string;
  files: Array<{ path: string; content: string }>;
}

export interface QYNoteCompilationData {
  settings: QYNoteCompilationSettings;
  lastChange: ChangeBackup | null;
}

export const DEFAULT_DATA: QYNoteCompilationData = {
  settings: DEFAULT_SETTINGS,
  lastChange: null
};
