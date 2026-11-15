import { App, PluginSettingTab, Setting } from "obsidian";
import type QYNoteCompilationPlugin from "./main";

export class QYNoteCompilationSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: QYNoteCompilationPlugin
  ) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: "QYNote Compilation" });
    this.containerEl.createEl("p", {
      text: "默认设置即可使用。笔记分析在本地完成，不需要账号；只有排除隐私目录时才需要修改这里。"
    });

    new Setting(this.containerEl)
      .setName("排除目录")
      .setDesc("每行一个目录。目录中的 Markdown 不进入索引，适用于日记、模板或私密内容。")
      .addTextArea((text) =>
        text
          .setPlaceholder("日记\n模板\n私密")
          .setValue(this.plugin.settings.excludedFolders.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.excludedFolders = value
              .split(/[\n,]/)
              .map((folder) => folder.trim().replace(/^\/+|\/+$/g, ""))
              .filter(Boolean);
            await this.plugin.saveSettings();
            this.plugin.scheduleRefresh();
          })
      );
  }
}
