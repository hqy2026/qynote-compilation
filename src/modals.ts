import { App, Modal, Setting } from "obsidian";
import { diffLines } from "diff";
import type { TidyPlanChange } from "./tidy-plan";

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    title: string,
    private readonly description: string,
    private readonly confirmLabel: string,
    private readonly onConfirm: () => Promise<void>
  ) {
    super(app);
    this.titleEl.setText(title);
  }

  onOpen(): void {
    this.contentEl.createEl("p", { text: this.description });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) =>
        button.setButtonText(this.confirmLabel).setCta().onClick(async () => {
          button.setDisabled(true);
          await this.onConfirm();
          this.close();
        })
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class DiffPreviewModal extends Modal {
  constructor(
    app: App,
    private readonly before: string,
    private readonly after: string,
    private readonly description: string,
    private readonly onConfirm: () => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("确认整理修改");
    this.contentEl.addClass("qynote-compilation__modal");
    this.contentEl.createEl("p", { text: this.description });
    const diff = this.contentEl.createDiv("qynote-compilation__diff");
    for (const part of diffLines(this.before, this.after)) {
      if (!part.added && !part.removed && part.count && part.count > 8) {
        continue;
      }
      diff.createEl("pre", {
        cls: part.added
          ? "qynote-compilation__diff-added"
          : part.removed
            ? "qynote-compilation__diff-removed"
            : "qynote-compilation__diff-context",
        text: `${part.added ? "+ " : part.removed ? "- " : "  "}${part.value}`
      });
    }
    new Setting(this.contentEl)
      .setDesc("只有点击确认后才会写回；写入前内容会保存在插件数据中，可通过命令撤销。")
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) =>
        button.setButtonText("确认写回").setCta().onClick(async () => {
          button.setDisabled(true);
          await this.onConfirm();
          this.close();
        })
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

const PLAN_KIND_LABEL: Record<TidyPlanChange["kind"], string> = {
  merge: "合并重复",
  contradiction: "标注矛盾",
  link: "补充双链"
};

export class PlanPreviewModal extends Modal {
  constructor(
    app: App,
    private readonly changes: TidyPlanChange[],
    private readonly onConfirm: () => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("确认整库整理计划");
    this.contentEl.addClass("qynote-compilation__modal");
    this.contentEl.createEl("p", {
      text: `将向 ${this.changes.length} 篇笔记追加整理内容（合并独有段落 / 标注矛盾 / 补双链）。每个文件最多改一处，不改原文、不删除任何笔记。`
    });
    for (const change of this.changes) {
      const section = this.contentEl.createDiv("qynote-compilation__plan-change");
      section.createEl("h4", {
        text: `${PLAN_KIND_LABEL[change.kind]} · ${change.path}`
      });
      section.createEl("p", { cls: "qynote-compilation__muted", text: change.summary });
      if (change.willNotTouch) {
        section.createEl("p", {
          cls: "qynote-compilation__muted",
          text: `来源笔记 ${change.willNotTouch} 保持不变，不会被删除。`
        });
      }
      const diff = section.createDiv("qynote-compilation__diff");
      for (const part of diffLines(change.before, change.after)) {
        if (!part.added && !part.removed && part.count && part.count > 6) {
          continue;
        }
        diff.createEl("pre", {
          cls: part.added
            ? "qynote-compilation__diff-added"
            : part.removed
              ? "qynote-compilation__diff-removed"
              : "qynote-compilation__diff-context",
          text: `${part.added ? "+ " : part.removed ? "- " : "  "}${part.value}`
        });
      }
    }
    new Setting(this.contentEl)
      .setDesc("只有点击确认后才会整批写回；写入前内容会保存在插件数据中，可通过“撤销上次整理”整体恢复。")
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) =>
        button.setButtonText(`确认应用 ${this.changes.length} 处`).setCta().onClick(async () => {
          button.setDisabled(true);
          await this.onConfirm();
          this.close();
        })
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
