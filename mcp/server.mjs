// Minimal, local-only MCP server for the QYNote Compilation tool surface.
// stdio JSON-RPC. Reads VAULT_PATH (a folder of .md files) on the user's machine.
// No network, no language model. Writes are gated: preview_*/propose_plan -> apply_change(previewId) -> undo_last.
import { createInterface } from "node:readline";
import { LocalVault } from "./vault.mjs";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "qynote-tools", version: "0.1.0" };

const vaultRoot = process.env.VAULT_PATH || process.argv[2];
if (!vaultRoot) {
  process.stderr.write("qynote-tools: set VAULT_PATH to a vault directory.\n");
  process.exit(1);
}

const vault = new LocalVault(vaultRoot);
await vault.scan();

const TOOLS = [
  {
    name: "list_notes",
    description: "列出库中全部 Markdown 笔记（路径、标题、标签、出链数、字数）。只读。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "find_suggestions",
    description: "为某篇笔记返回本地词形+TF-IDF 的关联建议（含证据词与分数）。只读，不写入。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "笔记相对路径，如 学习科学.md" },
        limit: { type: "integer", minimum: 1, maximum: 20 }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    name: "diagnose",
    description: "全库诊断：近似重复、相互矛盾、缺少来源的观点句。只读，仅给出证据供 agent 决策。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "preview_link",
    description: "预览把 [[target]] 关联写进 source 会得到什么（返回 diff 与一次性 previewId），但不写入。",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string" },
        target: { type: "string" }
      },
      required: ["source", "target"],
      additionalProperties: false
    }
  },
  {
    name: "preview_merge",
    description: "预览把重复笔记 drop 的独有段落合并进保留笔记 keep（追加，不删除来源），返回一次性 previewId。不落盘。",
    inputSchema: {
      type: "object",
      properties: {
        keep: { type: "string", description: "保留并写入的笔记路径" },
        drop: { type: "string", description: "作为来源被合并、但不删除的笔记路径" }
      },
      required: ["keep", "drop"],
      additionalProperties: false
    }
  },
  {
    name: "preview_resolve_contradiction",
    description: "预览在 source 笔记追加一条与 conflicting 的观点冲突提示（不改任一原文），返回一次性 previewId。不落盘。",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "将被追加冲突提示的笔记路径" },
        conflicting: { type: "string", description: "与之矛盾的笔记路径" }
      },
      required: ["source", "conflicting"],
      additionalProperties: false
    }
  },
  {
    name: "propose_plan",
    description:
      "扫描全库并生成一份一次性整理计划（合并高相似重复、标注矛盾、补高置信双链），每个文件最多改一处；返回 previewId 与逐条摘要，每项附 diff（before/after/addedLines）供落盘前逐文件核查。只读，不写入。",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50, description: "最多包含的改动条数，默认 20" }
      },
      additionalProperties: false
    }
  },
  {
    name: "apply_change",
    description:
      "落盘一次 preview_* 或 propose_plan 的改动：先校验所有目标文件自预览后未被改动（任一被改则整批取消），再逐份备份写入。previewId 无效/过期则拒绝。",
    inputSchema: {
      type: "object",
      properties: { previewId: { type: "string" } },
      required: ["previewId"],
      additionalProperties: false
    }
  },
  {
    name: "undo_last",
    description: "撤销最近一次 apply_change 的写入：若是整理计划则一次性回滚该计划涉及的全部文件。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }
];

async function callTool(name, args = {}) {
  switch (name) {
    case "list_notes":
      return vault.listNotes();
    case "find_suggestions":
      return vault.findSuggestions(String(args.path), Number(args.limit ?? 5));
    case "diagnose":
      return vault.diagnose();
    case "preview_link":
      return vault.previewLink(String(args.source), String(args.target));
    case "preview_merge":
      return vault.previewMerge(String(args.keep), String(args.drop));
    case "preview_resolve_contradiction":
      return vault.previewResolveContradiction(String(args.source), String(args.conflicting));
    case "propose_plan":
      return vault.proposePlan(Number(args.limit ?? 20));
    case "apply_change":
      return vault.applyChange(String(args.previewId));
    case "undo_last":
      return vault.undoLast();
    default:
      throw new Error(`未知工具：${name}`);
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(message) {
  const { id, method, params } = message;
  const hasId = id !== undefined && id !== null;

  if (method === "initialize") {
    return respond(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO
    });
  }
  if (method === "notifications/initialized" || method === "initialized") {
    return; // notification, no response
  }
  if (method === "ping") {
    return hasId ? respond(id, {}) : undefined;
  }
  if (method === "tools/list") {
    return respond(id, { tools: TOOLS });
  }
  if (method === "tools/call") {
    try {
      const payload = await callTool(params?.name, params?.arguments ?? {});
      return respond(id, {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        isError: false
      });
    } catch (error) {
      return respond(id, {
        content: [{ type: "text", text: String(error?.message ?? error) }],
        isError: true
      });
    }
  }
  if (hasId) {
    return respondError(id, -32601, `未知方法：${method}`);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    respondError(null, -32700, "解析错误：需要换行分隔的 JSON-RPC。");
    return;
  }
  Promise.resolve(handle(message)).catch((error) => {
    if (message?.id !== undefined) {
      respondError(message.id, -32603, String(error?.message ?? error));
    }
  });
});
