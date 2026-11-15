# QYNote Compilation

本地优先的 Obsidian 整理插件：循证双链推荐与整库整理计划，都在你的笔记库内完成。

- **纯本地**：所有计算（中文分词、TF‑IDF）都在本机运行。
- **零网络、零模型、零密钥**：不内置任何语言模型或 API key，不上传笔记。
- **人确认后才写回**：任何修改都走「预览 diff → 确认 → 原子写入 → 可撤销」。
- **只追加、不改原文**：整理时绝不删除或改写你的原有文字。

> 2026 Qoder 天池大赛 · StudyHack 赛道参赛作品。当前版本 **1.2.0**，minAppVersion **1.14.4**。
>
> 源码仓库：<https://github.com/hqy2026/qynote-compilation> · 在线演示：<https://vaultcoach-lp9v9mm3elt.qoder.zone> · 安装包下载：<https://vaultcoach-lp9v9mm3elt.qoder.zone/download/qynote-compilation.zip> · GitHub Release：<https://github.com/hqy2026/qynote-compilation/releases/tag/v1.2.0>

---

## 功能

| 环节 | 能力 |
|---|---|
| **整理** | 循证双链推荐（附共享词证据）、整库整理计划（合并重复 / 标注冲突 / 补双链，可一键应用） |
| **诊断** | 重复笔记、观点冲突、孤儿笔记、陈旧笔记、缺来源声明（作为整理计划的候选证据） |

侧边栏只有两个入口——**整理 / 计划**，力求上手简单。

---

## 安装

### 方式一：安装包（推荐）
1. 下载 `qynote-compilation.zip` 并解压，得到 `qynote-compilation/` 文件夹（含 `manifest.json`、`main.js`、`styles.css`）。
2. 把该文件夹放到 `你的库/.obsidian/plugins/qynote-compilation/`。
3. 打开 Obsidian → 设置 → 社区插件 → 关闭「受限模式」→ 启用 **QYNote Compilation**。

### 方式二：从源码构建
```bash
npm install
npm run build      # 生成 main.js
```
然后把 `manifest.json`、`main.js`、`styles.css` 三个文件复制到 `你的库/.obsidian/plugins/qynote-compilation/`，再在设置里启用。

> 插件 id 为 `qynote-compilation`，文件夹名必须与之一致。

---

## 使用

启用后，左侧 ribbon 点击网络图标即可打开侧边栏；也可用命令面板（`Ctrl/Cmd + P`）：

| 命令 | 说明 |
|---|---|
| 打开知识库概览 | 打开侧边栏 |
| 重新扫描知识库 | 手动刷新索引 |
| 整理当前笔记 | 查看当前笔记的循证双链建议 |
| 生成整库整理计划 | 生成合并/冲突/双链计划，逐项审阅后批量应用（也可一键应用） |
| 撤销上次整理 | 恢复上次确认写回前的内容 |

### 默认设置（可在设置页修改）
- 排除文件夹：默认无（设置页唯一选项，用于跳过日记/模板/私密目录）

---

## 安全写回模型

这是本插件的核心承诺：

1. **预览**：所有修改先以 diff 形式展示，逐条可核查。
2. **确认**：只有你点击确认后才写回。
3. **原子**：批量写入若中途失败，已写入部分会整体回滚。
4. **校验**：写回前检查笔记自生成计划后未被改动，否则中止并提示重新生成。
5. **只追加**：合并/冲突/双链都以追加段落实现，原文一字不改；每个文件每份计划至多编辑一次。
6. **可撤销**：写回前的内容保存在插件数据中，可用「撤销上次整理」恢复。

---

## Agent 工具面（MCP）

除图形界面外，项目提供一个**本地 MCP 服务器**，让 AI agent 以同样的安全约束整理笔记。它与插件共用同一个计划构建器，逻辑不分叉。

9 个工具：

| 工具 | 作用 |
|---|---|
| `list_notes` | 列出笔记 |
| `find_suggestions` | 循证双链推荐 |
| `diagnose` | 重复 / 冲突 / 缺来源诊断 |
| `preview_link` / `preview_merge` / `preview_resolve_contradiction` | 预览单项整理 |
| `propose_plan` | 一次性整库计划（逐项带 diff） |
| `apply_change` | 确认后原子写回 |
| `undo_last` | 撤销上次写回 |

### 运行
```bash
npm run mcp:build                 # 生成算法层 ESM
VAULT_PATH=/absolute/path/to/vault npm run mcp:serve
```

### 自包含单文件分发
```bash
npm run mcp:dist                  # 打包 + 隔离自检
```
产物 `mcp/dist/qynote-mcp.mjs`：约 127KB、**零 npm 依赖**、仅需 Node ≥ 20、未压缩便于审计。可直接拷贝到任意目录运行：
```bash
VAULT_PATH=/absolute/path/to/vault node qynote-mcp.mjs
```
详见 [`mcp/README.md`](mcp/README.md)。

---

## 开发与验证

```bash
npm run dev          # 监听构建
npm run check        # 类型检查
npm run build        # 生产构建
npm test             # 单元测试（Vitest）
npm run mcp:smoke    # MCP 冒烟 + 原子性故障注入
npm run mcp:dist     # MCP 自包含打包 + 隔离自检
npm run test:obsidian  # 真实 Obsidian 端到端（需先以 CDP 启动 Obsidian，见下）
```

### 推荐质量基线
50 用例评测：**Top1 准确率 96% / Top3 召回 100% / 误报率 0%**。

### 真实 Obsidian 端到端
`tests/obsidian-smoke.mjs` 通过 CDP（默认端口 9225）附着到正在运行的 Obsidian，在**隔离测试库**上验证插件加载、诊断、双链写回与撤销、计划闭环（含一键应用）与大库性能。运行前需：
1. 完全退出所有 Obsidian 实例；
2. 以 `Obsidian.exe --remote-debugging-port=9225` 启动，并打开装有本插件的隔离测试库；
3. `npm run test:obsidian`。

> 切勿对日常使用的真实笔记库运行此 mutating 测试。

---

## 隐私

- 不发起任何网络请求。
- 不内置语言模型、不收集数据、不上传笔记。
- 整理备份保存在插件本地数据中，用于撤销。

## 技术栈
TypeScript · esbuild · Obsidian API · diff · Vitest