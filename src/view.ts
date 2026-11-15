import { ItemView, WorkspaceLeaf } from "obsidian";
import { openNoteAtLine } from "./file-actions";
import type QYNoteCompilationPlugin from "./main";
import { appendedText } from "./tidy-plan";
import type { VaultSnapshot } from "./types";

export const QYNOTE_COMPILATION_VIEW = "qynote-compilation-view";
type Tab = "organize" | "plan";

const PLAN_KIND_LABEL: Record<string, string> = {
  merge: "合并重复",
  contradiction: "标注矛盾",
  link: "补充双链"
};

export class QYNoteCompilationView extends ItemView {
  private snapshot: VaultSnapshot | null = null;
  private activeTab: Tab = "organize";

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: QYNoteCompilationPlugin
  ) {
    super(leaf);
  }

  getViewType(): string {
    return QYNOTE_COMPILATION_VIEW;
  }

  getDisplayText(): string {
    return "QYNote Compilation";
  }

  getIcon(): string {
    return "network";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("qynote-compilation");
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  renderSnapshot(snapshot: VaultSnapshot): void {
    this.snapshot = snapshot;
    this.render();
  }

  showOrganize(): void {
    this.activeTab = "organize";
    this.render();
  }

  showPlan(): void {
    this.activeTab = "plan";
    this.render();
  }

  handleActiveNoteChange(): void {
    if (this.activeTab === "organize") {
      this.render();
    }
  }

  private render(): void {
    this.contentEl.empty();
    const header = this.contentEl.createDiv("qynote-compilation__header");
    const heading = header.createDiv();
    heading.createEl("h3", { text: "QYNote Compilation" });
    heading.createEl("p", {
      cls: "qynote-compilation__description",
      text: "循证整理笔记，都在 Obsidian 里完成"
    });
    const refreshButton = header.createEl("button", { text: "刷新" });
    refreshButton.addEventListener("click", () => {
      refreshButton.disabled = true;
      void this.plugin.refreshViews(true);
    });

    const tabs = this.contentEl.createDiv("qynote-compilation__tabs");
    for (const [id, label] of [
      ["organize", "整理"],
      ["plan", "计划"]
    ] as const) {
      const button = tabs.createEl("button", {
        text: label,
        cls: this.activeTab === id ? "is-active" : ""
      });
      button.addEventListener("click", () => {
        this.activeTab = id;
        this.render();
      });
    }

    if (!this.snapshot) {
      this.contentEl.createDiv({
        cls: "qynote-compilation__empty",
        text: "正在准备知识库索引…"
      });
      return;
    }

    if (this.activeTab === "organize") {
      this.renderOrganize();
    } else {
      this.renderPlan();
    }

    this.contentEl.createEl("p", {
      cls: "qynote-compilation__footer qynote-compilation__muted",
      text: `上次扫描 ${new Date(this.snapshot.scannedAt).toLocaleTimeString()} · 内容未上传`
    });
  }

  private renderOrganize(): void {
    const note = this.plugin.getActiveNoteSummary();
    if (!note) {
      this.contentEl.createDiv({
        cls: "qynote-compilation__empty",
        text: "先打开一篇需要整理的 Markdown 笔记。"
      });
      return;
    }

    const current = this.contentEl.createDiv("qynote-compilation__current-note");
    current.createEl("strong", { text: note.title });
    current.createSpan({ text: note.path });

    this.contentEl.createEl("h4", {
      cls: "qynote-compilation__section-title",
      text: "相关笔记"
    });
    const suggestions = this.plugin.getLinkSuggestions(note.path);
    if (suggestions.length === 0) {
      this.contentEl.createDiv({
        cls: "qynote-compilation__empty",
        text: "暂无推荐。可以先补充正文，或打开另一篇笔记。"
      });
      return;
    }

    for (const suggestion of suggestions) {
      const card = this.contentEl.createDiv("qynote-compilation__suggestion");
      card.createEl("strong", { text: suggestion.targetPath.replace(/\.md$/i, "") });
      card.createEl("p", {
        cls: "qynote-compilation__muted",
        text: `相关依据：${suggestion.evidence.join("、")}`
      });
      card.createEl("p", { text: suggestion.targetExcerpt });
      const row = card.createDiv("qynote-compilation__actions");
      this.addButton(row, "打开目标", () => {
        void openNoteAtLine(this.app, suggestion.targetPath);
      });
      this.addButton(row, "预览并添加", () => {
        void this.plugin.previewOrganization(note.path, suggestion.targetPath);
      });
    }
  }

  private renderPlan(): void {
    this.contentEl.createEl("h4", {
      cls: "qynote-compilation__section-title",
      text: "整库整理计划"
    });
    this.contentEl.createEl("p", {
      cls: "qynote-compilation__description",
      text: "扫描全库，按优先级生成一份每个文件最多改一处的方案：合并高相似重复、标注矛盾、补高置信双链。逐项核对后再整批应用，可随时撤销。"
    });

    const actions = this.contentEl.createDiv("qynote-compilation__actions");
    const generate = actions.createEl("button", { text: "生成整理计划" });
    generate.addEventListener("click", () => {
      generate.disabled = true;
      generate.setText("正在检查重复与矛盾…");
      void this.plugin.generateTidyPlan().finally(() => {
        generate.disabled = false;
        generate.setText("生成整理计划");
      });
    });
    if (this.plugin.hasLastChange()) {
      this.addButton(actions, "撤销上次整理", () => this.plugin.undoLastOrganization());
    }

    const plan = this.plugin.getTidyPlan();
    if (!plan) {
      this.contentEl.createDiv({
        cls: "qynote-compilation__empty",
        text: "点击“生成整理计划”开始。首次会检查重复与矛盾，大库稍候。"
      });
      return;
    }
    if (plan.length === 0) {
      this.contentEl.createDiv({
        cls: "qynote-compilation__empty",
        text: "没有达到阈值的整理项，库已经很整洁。"
      });
      return;
    }

    this.contentEl.createEl("p", {
      cls: "qynote-compilation__muted",
      text: `共 ${plan.length} 处 · 每个文件最多改一处 · 仅追加，不改原文、不删除`
    });
    for (const change of plan) {
      const card = this.contentEl.createDiv("qynote-compilation__plan-item");
      const head = card.createDiv("qynote-compilation__plan-head");
      head.createSpan({
        cls: `qynote-compilation__plan-kind is-${change.kind}`,
        text: PLAN_KIND_LABEL[change.kind] ?? change.kind
      });
      head.createEl("strong", { text: change.path });
      card.createEl("p", { cls: "qynote-compilation__muted", text: change.summary });
      if (change.willNotTouch) {
        card.createEl("p", {
          cls: "qynote-compilation__muted",
          text: `来源 ${change.willNotTouch} 保持不变，不会被删除。`
        });
      }
      const details = card.createEl("details", "qynote-compilation__disclosure");
      details.createEl("summary", { text: "查看将追加的内容" });
      details.createEl("pre", {
        cls: "qynote-compilation__plan-tail",
        text: appendedText(change).trim() || "（无新增内容）"
      });
      const row = card.createDiv("qynote-compilation__actions");
      this.addButton(row, "打开笔记", () => void openNoteAtLine(this.app, change.path));
    }

    const quick = this.contentEl.createEl("button", {
      text: `一键应用全部 ${plan.length} 处（跳过逐项预览）`
    });
    quick.addEventListener("click", () => void this.plugin.quickApplyTidyPlan());

    const apply = this.contentEl.createEl("button", {
      cls: "mod-cta",
      text: `预览全部并应用 ${plan.length} 处`
    });
    apply.addEventListener("click", () => void this.plugin.applyTidyPlan());
  }

  private addButton(
    container: HTMLElement,
    text: string,
    onClick: () => void
  ): void {
    const button = container.createEl("button", { text });
    button.addEventListener("click", onClick);
  }
}
