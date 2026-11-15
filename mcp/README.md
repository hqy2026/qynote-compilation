# QYNote Compilation MCP 工具面（最小原型）

把 QYNote Compilation 已有的整理能力，暴露成一套**可被 agent 调用的本地工具**（MCP server，stdio）。
定位：**纯本地、零联网、不含任何语言模型**。它只是“工具 + 安全写入闸门”；用哪个模型、要不要用模型，由装它的人自己决定，模型和密钥属于 agent 那一层，不进插件、不进本仓库。

## 为什么要它
Obsidian 插件是分发给别人机器上跑的开源工具，不能绑定某个账号/模型/Key。于是分工是：
- **本 MCP server**：读本地库、跑确定性算法、给出可核查的建议，并把每一次写入关在“预览→确认→可撤销”里。
- **agent（Qoder / Claude / 本地模型…）**：由用户在自己的机器、用自己的额度运行，来“编排”这些工具做批量整理。

## 工具
| 工具 | 作用 | 是否写入 |
| --- | --- | --- |
| `list_notes` | 列出笔记（路径/标题/标签/出链/字数） | 只读 |
| `find_suggestions` | 某笔记的本地词形+TF-IDF 关联建议（含证据词、分数） | 只读 |
| `diagnose` | 全库诊断：近似重复、相互矛盾、缺少来源的观点句（含证据与行号） | 只读 |
| `preview_link` | 预览把 `[[target]]` 写进 source 会得到的 diff，返回一次性 `previewId` | 只读（不落盘） |
| `preview_merge` | 预览把重复笔记 drop 的**独有段落**合并进 keep（追加+来源链接，**不删除 drop**） | 只读（不落盘） |
| `preview_resolve_contradiction` | 预览在 source 追加一条观点冲突提示（**不改任一原文**，仅可核查标注） | 只读（不落盘） |
| `propose_plan` | 扫描全库生成一份**一次性整理计划**：合并高相似重复 + 标注矛盾 + 补高置信双链，**每个文件最多改一处**，返回 `previewId` 与逐条摘要，**每项附 `diff`（before/after/addedLines）**供落盘前逐文件核查 | 只读（不落盘） |
| `apply_change` | 落盘任一 `preview_*` 或 `propose_plan`（先校验全部目标文件自预览后未变，再逐份备份写入） | 写入 |
| `undo_last` | 撤销最近一次 apply：单条预览恢复一个文件，整理计划**一次性回滚整批** | 写入（恢复） |

`diagnose` 的结果可直接喂给 `preview_merge` / `preview_resolve_contradiction`，agent 据此“先看清要改什么，再确认落盘”，形成 读→判→预览→确认→可撤销 的闭环。
想让 agent 一次把整库理顺，就用 `propose_plan`：它按优先级（合并→矛盾标注→补双链）把候选改动合成一份“每个文件至多一处、彼此不冲突”的计划，**每项都带 `diff`**（与单条 `preview_*` 同结构），agent/人可在落盘前逐文件看清确切改动；`apply_change` 要么整批落盘、要么整批不写（任一文件在预览后被改过即取消），`undo_last` 一键回滚整份计划。

## 安全闸门（对 agent 与人都一视同仁）
- **必须先 `preview_*` / `propose_plan`** 拿到 `previewId` 才能 `apply_change`；伪造/过期 id 被拒绝。
- `apply_change` **先写备份**（`库/.qynote-mcp-backups/时间戳__路径.bak`）再写入。
- 写入前校验目标文件自预览后**未被改动**，否则取消，避免覆盖并发编辑；对 `propose_plan` 而言，任一文件被改则**整批取消**，不会只写一半。
- 回滚记录在真实写入**之前**登记：即便整批写到第 k 个文件时才失败，前 k-1 个文件也已可被 `undo_last` **整体还原**，绝不留下撤不回的半应用状态（备份也已先落盘）。
- 计划里**每个文件最多改一处**，`undo_last` 精确恢复：单条预览恢复一个文件，整份计划恢复其全部文件。
- **不删除、不改原文**：`preview_merge` 只往保留笔记追加、来源笔记原样不动；`preview_resolve_contradiction` 只追加冲突提示、双方原句都不改。

## 构建与运行
```bash
npm run mcp:build     # 用 esbuild 把 src/analysis.ts、src/tidy-plan.ts 打包成 mcp/analysis.mjs、mcp/tidy-plan.mjs（纯本地算法）
VAULT_PATH=/绝对/路径/到/你的库 npm run mcp:serve   # 从源码启动 stdio MCP server（开发用）
npm run mcp:smoke     # 自检：握手 + 九个工具 + 单条预览/写入/撤销 + propose_plan 批量落盘/整体回滚 + 写失败原子性
npm run mcp:dist      # 打成自包含单文件并做隔离自检（见下）
```

## 自包含分发（给别人机器用）
开源插件是跑在**别人电脑**上的，不能要求对方 clone 仓库、装依赖。`npm run mcp:dist` 会把整套服务（`server → vault → analysis/tidy-plan`）用 esbuild 打成**一个文件**：

```
mcp/dist/qynote-mcp.mjs   # 约 127 KB，零 npm 依赖，仅引用 Node 内置模块（readline/crypto/fs/path）
```

- **终端用户只需这一个文件**：`VAULT_PATH=/你的库 node qynote-mcp.mjs`（Node ≥ 20）。无需仓库、无需 `npm install`、无需联网。
- **可审计**：刻意不压缩（`minify:false`），第三方许可注释保留在文件末尾，用户能看清在自己机器上跑的每一行。
- **隔离自检**：`mcp/dist-smoke.mjs` 把**仅这一个文件**拷进一个空目录（没有 `node_modules`、没有 `src`、没有任何兄弟文件），再像 MCP 客户端一样跑通 `tools/list`（9 个工具）与 `propose_plan(diff) → apply_change → undo_last`，证明它 truly 自包含。
- 构建脚本会校验产物**只剩 `node:` 内置外部引用**，若混入任何 npm 依赖即报错退出。

## 接到 MCP 客户端
在客户端（Qoder / Claude Desktop 等）配置里新增一个 stdio server。**分发场景**直接指向那个单文件即可：
```json
{
  "mcpServers": {
    "qynote-tools": {
      "command": "node",
      "args": ["<qynote-mcp.mjs 的绝对路径>"],
      "env": { "VAULT_PATH": "<你的 Obsidian 库绝对路径>" }
    }
  }
}
```
（开发时也可把 `args` 指向 `<本仓库绝对路径>/mcp/server.mjs`，效果相同。）
之后对 agent 说“用 qynote-tools 找出《主动回忆》的相关笔记并预览要加的双链，确认后再写”，它就能走 `find_suggestions → preview_link → apply_change` 的闭环；要说“把整库先理一遍再给我确认”，它走 `propose_plan → apply_change → undo_last`。

## 当前范围（原型）
- 九个工具：三个只读查询（`list_notes`/`find_suggestions`/`diagnose`）、四个预览（单条 `preview_link`/`preview_merge`/`preview_resolve_contradiction` 与批量 `propose_plan`）、两个受闸门约束的写入（`apply_change`/`undo_last`）。
- 复用 `src/analysis.ts` 与 `src/tidy-plan.ts` 的本地算法；工具面只覆盖整理笔记（双链推荐与整库计划），不含剪藏或资料输出。
- 链接解析用文件名匹配（够用）；不读取 Obsidian 的 metadataCache。
