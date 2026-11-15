import { Notice, Plugin, TAbstractFile, TFile } from "obsidian";
import {
  applyNoteChanges,
  restoreNoteChanges
} from "./file-actions";
import {
  ConfirmModal,
  DiffPreviewModal,
  PlanPreviewModal
} from "./modals";
import { buildOrganizedContent } from "./organize";
import { QYNoteCompilationSettingTab } from "./settings";
import type { TidyPlanChange } from "./tidy-plan";
import {
  DEFAULT_DATA,
  DEFAULT_SETTINGS,
  type QYNoteCompilationData,
  type QYNoteCompilationSettings,
  type VaultSnapshot
} from "./types";
import { VaultIndex } from "./vault-index";
import { QYNOTE_COMPILATION_VIEW, QYNoteCompilationView } from "./view";

export default class QYNoteCompilationPlugin extends Plugin {
  settings: QYNoteCompilationSettings = { ...DEFAULT_SETTINGS, excludedFolders: [] };
  private data: QYNoteCompilationData = {
    ...DEFAULT_DATA,
    settings: this.settings
  };
  private vaultIndex: VaultIndex;
  private snapshot: VaultSnapshot | null = null;
  private tidyPlan: TidyPlanChange[] | null = null;
  private refreshTimer: number | null = null;
  private refreshing = false;
  private refreshQueued = false;
  private diagnosticsRunning = false;
  private metadataSignatures = new Map<string, number>();

  async onload(): Promise<void> {
    await this.loadPluginData();
    this.vaultIndex = new VaultIndex(this.app, () => this.settings);
    this.registerView(QYNOTE_COMPILATION_VIEW, (leaf) => new QYNoteCompilationView(leaf, this));
    this.addRibbonIcon("network", "打开 QYNote Compilation", () => void this.activateView());
    this.registerCommands();
    this.addSettingTab(new QYNoteCompilationSettingTab(this.app, this));

    this.registerEvent(this.app.vault.on("create", (file) => this.handleFileEvent(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.handleFileEvent(file)));
    this.registerEvent(this.app.vault.on("rename", (file) => this.handleFileEvent(file)));
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => this.handleMetadataChanged(file))
    );
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRefresh()));
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.handleActiveNoteChange())
    );

    this.app.workspace.onLayoutReady(() => void this.refreshViews());
    this.register(() => {
      if (this.refreshTimer !== null) {
        window.clearTimeout(this.refreshTimer);
      }
    });
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(QYNOTE_COMPILATION_VIEW);
  }

  async saveSettings(): Promise<void> {
    this.data.settings = this.settings;
    await this.persistData();
  }

  async refreshViews(showNotice = false): Promise<void> {
    if (this.refreshing) {
      this.refreshQueued = true;
      return;
    }
    this.refreshing = true;
    try {
      do {
        this.refreshQueued = false;
        const snapshot = await this.vaultIndex.scan();
        this.snapshot = snapshot;
        this.metadataSignatures = new Map(
          snapshot.notes.map((note) => [note.path, note.modifiedAt])
        );
        this.renderSnapshotToViews();
      } while (this.refreshQueued);
      if (showNotice && this.snapshot) {
        new Notice(
          `刷新完成：${this.snapshot.notes.length} 篇笔记，${this.snapshot.orphanNotes.length} 篇待整理。`
        );
      }
    } catch (error) {
      this.showError("刷新知识库失败", error);
    } finally {
      this.refreshing = false;
    }
  }

  async refreshDiagnostics(): Promise<void> {
    if (!this.snapshot || this.snapshot.diagnosticsReady || this.diagnosticsRunning) {
      return;
    }
    this.diagnosticsRunning = true;
    try {
      const result = await this.vaultIndex.scanDiagnostics();
      if (this.snapshot?.revision === result.revision) {
        this.snapshot = {
          ...this.snapshot,
          duplicates: result.duplicates,
          contradictions: result.contradictions,
          diagnosticsReady: true
        };
        this.renderSnapshotToViews();
      }
    } catch (error) {
      this.showError("检查重复与矛盾失败", error);
    } finally {
      this.diagnosticsRunning = false;
    }
  }

  scheduleRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshViews();
    }, 800);
  }

  getActiveNoteSummary() {
    const file = this.app.workspace.getActiveFile();
    return file ? this.vaultIndex.getNote(file.path) : undefined;
  }

  getLinkSuggestions(path: string) {
    return this.vaultIndex.getLinkSuggestions(path);
  }

  getTidyPlan(): TidyPlanChange[] | null {
    return this.tidyPlan;
  }

  hasLastChange(): boolean {
    return this.data.lastChange !== null;
  }

  undoLastOrganization(): void {
    void this.undoLastChange();
  }

  async generateTidyPlan(): Promise<void> {
    try {
      if (!this.snapshot) {
        await this.refreshViews();
      }
      const diagnostics = await this.vaultIndex.scanDiagnostics();
      this.tidyPlan = this.vaultIndex.getTidyPlan(
        diagnostics.duplicates,
        diagnostics.contradictions,
        20
      );
      this.renderSnapshotToViews();
      new Notice(
        this.tidyPlan.length === 0
          ? "没有达到阈值的整理项。"
          : `已生成 ${this.tidyPlan.length} 处整理建议，逐项核对后再应用。`
      );
    } catch (error) {
      this.showError("生成整理计划失败", error);
    }
  }

  async applyTidyPlan(): Promise<void> {
    const plan = this.tidyPlan;
    if (!plan || plan.length === 0) {
      new Notice("请先生成整理计划。");
      return;
    }
    new PlanPreviewModal(this.app, plan, () => this.commitTidyPlan(plan)).open();
  }

  async quickApplyTidyPlan(): Promise<void> {
    const plan = this.tidyPlan;
    if (!plan || plan.length === 0) {
      new Notice("请先生成整理计划。");
      return;
    }
    new ConfirmModal(
      this.app,
      "一键应用整理计划",
      `将应用 ${plan.length} 处整理：仅追加、不改原文、不删除，每个文件最多改一处。应用后可用“撤销上次整理”整体恢复。`,
      "确认应用",
      () => this.commitTidyPlan(plan)
    ).open();
  }

  private async commitTidyPlan(plan: TidyPlanChange[]): Promise<void> {
    try {
      this.data.lastChange = await applyNoteChanges(
        this.app,
        plan.map((change) => ({
          path: change.path,
          content: change.after,
          expected: change.before
        }))
      );
      this.tidyPlan = null;
      await this.persistData();
      new Notice(`已应用 ${plan.length} 处整理，可通过“撤销上次整理”整体恢复。`);
      await this.refreshViews();
    } catch (error) {
      this.showError("应用整理计划失败", error);
    }
  }

  async previewOrganization(sourcePath: string, targetPath: string): Promise<void> {
    try {
      const source = this.vaultIndex.getNote(sourcePath);
      const target = this.vaultIndex.getNote(targetPath);
      if (!source || !target) {
        throw new Error("笔记索引已变化，请重新扫描。");
      }
      const organized = buildOrganizedContent(source, target);
      if (organized.content === source.content) {
        new Notice("这个双链和标签已经存在，无需修改。");
        return;
      }
      new DiffPreviewModal(
        this.app,
        source.content,
        organized.content,
        `添加 [[${target.title}]]${organized.tags.length ? `，继承标签：${organized.tags.join("、")}` : ""}。`,
        async () => {
          try {
            this.data.lastChange = await applyNoteChanges(this.app, [
              { path: source.path, content: organized.content }
            ]);
            await this.persistData();
            new Notice("已确认写回，可通过“撤销上次整理”恢复。");
            await this.refreshViews();
          } catch (error) {
            this.showError("写回笔记失败", error);
          }
        }
      ).open();
    } catch (error) {
      this.showError("准备整理建议失败", error);
    }
  }

  private registerCommands(): void {
    this.addCommand({
      id: "open-dashboard",
      name: "打开知识库概览",
      callback: () => void this.activateView()
    });
    this.addCommand({
      id: "refresh-index",
      name: "重新扫描知识库",
      callback: () => void this.refreshViews(true)
    });
    this.addCommand({
      id: "organize-current",
      name: "整理当前笔记",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.activateView().then(() => {
            const leaf = this.app.workspace.getLeavesOfType(QYNOTE_COMPILATION_VIEW)[0];
            if (leaf?.view instanceof QYNoteCompilationView) {
              leaf.view.showOrganize();
            }
          });
        }
        return true;
      }
    });
    this.addCommand({
      id: "tidy-plan",
      name: "生成整库整理计划",
      callback: () => {
        void this.activateView().then(() => {
          const leaf = this.app.workspace.getLeavesOfType(QYNOTE_COMPILATION_VIEW)[0];
          if (leaf?.view instanceof QYNoteCompilationView) {
            leaf.view.showPlan();
          }
          void this.generateTidyPlan();
        });
      }
    });
    this.addCommand({
      id: "undo-organization",
      name: "撤销上次整理",
      checkCallback: (checking) => {
        if (!this.data.lastChange) {
          return false;
        }
        if (!checking) {
          void this.undoLastChange();
        }
        return true;
      }
    });
  }

  private async undoLastChange(): Promise<void> {
    const backup = this.data.lastChange;
    if (!backup) {
      return;
    }
    try {
      const original = backup.files[0];
      const file = this.app.vault.getAbstractFileByPath(original.path);
      if (!(file instanceof TFile)) {
        throw new Error("原笔记已移动或删除，未执行撤销。");
      }
      const current = await this.app.vault.read(file);
      new DiffPreviewModal(
        this.app,
        current,
        original.content,
        `撤销 ${backup.files.length} 篇笔记的上次整理，恢复确认写回前的内容。`,
        async () => {
          try {
            await restoreNoteChanges(this.app, backup);
            this.data.lastChange = null;
            await this.persistData();
            new Notice("已恢复整理前的内容。");
            await this.refreshViews();
          } catch (error) {
            this.showError("撤销整理失败", error);
          }
        }
      ).open();
    } catch (error) {
      this.showError("准备撤销失败", error);
    }
  }

  private async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(QYNOTE_COMPILATION_VIEW)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      return;
    }
    await leaf.setViewState({ type: QYNOTE_COMPILATION_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
    if (this.snapshot) {
      this.renderSnapshotToViews();
    } else {
      await this.refreshViews();
    }
  }

  private handleActiveNoteChange(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(QYNOTE_COMPILATION_VIEW)) {
      if (leaf.view instanceof QYNoteCompilationView) {
        leaf.view.handleActiveNoteChange();
      }
    }
  }

  private renderSnapshotToViews(): void {
    if (!this.snapshot) {
      return;
    }
    for (const leaf of this.app.workspace.getLeavesOfType(QYNOTE_COMPILATION_VIEW)) {
      if (leaf.view instanceof QYNoteCompilationView) {
        leaf.view.renderSnapshot(this.snapshot);
      }
    }
  }

  private async loadPluginData(): Promise<void> {
    const saved = (await this.loadData() ?? {}) as Partial<QYNoteCompilationData> & {
      excludedFolders?: string[];
    };
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...saved.settings,
      excludedFolders:
        saved.settings?.excludedFolders ?? saved.excludedFolders ?? []
    };
    this.data = {
      settings: this.settings,
      lastChange: saved.lastChange ?? null
    };
  }

  private async persistData(): Promise<void> {
    await this.saveData(this.data);
  }

  private handleMetadataChanged(file: TFile): void {
    if (file.extension !== "md") {
      return;
    }
    if (this.metadataSignatures.get(file.path) === file.stat.mtime) {
      return;
    }
    this.metadataSignatures.set(file.path, file.stat.mtime);
    this.scheduleRefresh();
  }

  private handleFileEvent(file: TAbstractFile): void {
    if (file instanceof TFile && file.extension === "md") {
      this.scheduleRefresh();
    }
  }

  private showError(message: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    new Notice(`${message}：${detail}`, 8000);
    console.error(`[QYNote Compilation] ${message}`, error);
  }
}
