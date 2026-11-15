import assert from "node:assert/strict";

const port = Number(process.env.OBSIDIAN_CDP_PORT ?? 9225);
const runtimeErrors = [];
let socket;

try {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const target = targets.find((item) => item.url.startsWith("app://obsidian.md"));
  assert(target, "Obsidian page target was not found");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });

  let nextId = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const handler = pending.get(message.id);
      if (handler) {
        pending.delete(message.id);
        if (message.error) {
          handler.reject(new Error(JSON.stringify(message.error)));
        } else {
          handler.resolve(message.result);
        }
      }
    } else if (message.method === "Runtime.exceptionThrown") {
      runtimeErrors.push(message.params.exceptionDetails);
    }
  };

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  };

  const waitFor = async (expression, description, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const pageText = await evaluate(`document.body.innerText.slice(-4000)`);
    throw new Error(`Timed out: ${description}\nPage: ${pageText}\nRuntime errors: ${JSON.stringify(runtimeErrors)}`);
  };

  const clickModalButton = async (text) => {
    const clicked = await evaluate(`(() => {
      const button = [...document.querySelectorAll('.modal button')].find((item) => item.textContent.trim() === ${JSON.stringify(text)});
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert(clicked, `Modal button not found: ${text}`);
  };

  const closeModals = async () => {
    for (let index = 0; index < 8; index += 1) {
      if (await evaluate(`document.querySelectorAll('.modal').length === 0`)) {
        return;
      }
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Unable to close test modals");
  };

  const readFile = (path) => evaluate(`(async () => {
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
    return file ? await app.vault.read(file) : null;
  })()`);

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.bringToFront");
  await waitFor(`!!(window.app && app.vault && app.plugins)`, "Obsidian application");
  await closeModals();
  // Turn off Restricted Mode in the isolated test vault so community plugins can load.
  await evaluate(`localStorage.setItem("enable-plugin-" + app.appId, "true")`);
  const pluginState = await evaluate(`(async () => {
    if (app.plugins.getPlugin('qynote-compilation')) {
      await app.plugins.disablePlugin('qynote-compilation');
    }
    await app.plugins.enablePlugin('qynote-compilation');
    const plugin = app.plugins.getPlugin('qynote-compilation');
    return {
      loaded: !!plugin,
      manifests: Object.keys(app.plugins.manifests),
      vault: app.vault.getName()
    };
  })()`);
  assert(pluginState.loaded, `Plugin did not load: ${JSON.stringify(pluginState)}`);

  await evaluate(`(async () => {
    const plugin = app.plugins.getPlugin('qynote-compilation');
    plugin.data.lastChange = null;
    await plugin.persistData();
    const generated = app.vault.getAbstractFileByPath('QYNote');
    if (generated) await app.vault.delete(generated, true);
    const performanceFixtures = app.vault.getAbstractFileByPath('性能');
    if (performanceFixtures) await app.vault.delete(performanceFixtures, true);
    const source = app.vault.getAbstractFileByPath('学习科学.md');
    await app.vault.modify(source, ${JSON.stringify(`---
tags:
  - 学习
---
# 学习科学

主动回忆是指不查看材料，主动从记忆中提取信息。

间隔重复能够改善长期记忆效果，相关方法见[[间隔重复]]。
`)});
    await plugin.refreshViews();
    await plugin.refreshDiagnostics();
    app.commands.executeCommandById('qynote-compilation:open-dashboard');
  })()`);
  await waitFor(`!!document.querySelector('.qynote-compilation')`, "QYNote Compilation sidebar");
  const tabs = await evaluate(`[...document.querySelectorAll('.qynote-compilation__tabs button')].map((item) => item.textContent)`);
  assert.deepEqual(tabs, ["整理", "计划"]);
  assert(
    await evaluate(`document.querySelector('.qynote-compilation__tabs .is-active')?.textContent === '整理'`),
    "organize tab should be active by default"
  );

  const stats = await evaluate(`(() => {
    const snapshot = app.plugins.getPlugin('qynote-compilation').snapshot;
    return {
      notes: snapshot.notes.length,
      links: snapshot.totalLinks,
      orphans: snapshot.orphanNotes.length,
      duplicates: snapshot.duplicates.length,
      contradictions: snapshot.contradictions.length,
      sourceIssues: snapshot.sourceIssues.length
    };
  })()`);
  assert.equal(stats.notes, 8);
  assert(stats.links >= 1);
  assert(stats.orphans >= 1);
  assert(stats.duplicates >= 1);
  assert(stats.sourceIssues >= 1);

  const original = await readFile("学习科学.md");
  const suggestion = await evaluate(`(() => {
    const plugin = app.plugins.getPlugin('qynote-compilation');
    const item = plugin.getLinkSuggestions('学习科学.md').find((item) => item.targetPath === '主动回忆.md');
    return item ?? null;
  })()`);
  assert(suggestion, "Expected evidence-based link suggestion");
  assert(!suggestion.evidence.includes("动回"), "Mechanical Chinese bigram leaked into evidence");
  await evaluate(`app.plugins.getPlugin('qynote-compilation').previewOrganization('学习科学.md', '主动回忆.md')`);
  await waitFor(`!!document.querySelector('.qynote-compilation__diff')`, "organization diff preview");
  await clickModalButton("确认写回");
  await waitFor(`(async () => {
    const file = app.vault.getAbstractFileByPath('学习科学.md');
    return (await app.vault.read(file)).includes('[[主动回忆|主动回忆]]');
  })()`, "confirmed link write");
  const organized = await readFile("学习科学.md");
  assert(organized.includes("  - 记忆"));

  await evaluate(`app.plugins.getPlugin('qynote-compilation').undoLastChange()`);
  await waitFor(`!!document.querySelector('.qynote-compilation__diff')`, "undo diff preview");
  await clickModalButton("确认写回");
  await waitFor(`(async () => {
    const file = app.vault.getAbstractFileByPath('学习科学.md');
    return (await app.vault.read(file)) === ${JSON.stringify(original)};
  })()`, "undo restores original content");
  await waitFor(`(() => {
    const note = app.plugins.getPlugin('qynote-compilation').snapshot.notes.find((n) => n.path === '学习科学.md');
    return !!note && note.content === ${JSON.stringify(original)};
  })()`, "snapshot reflects undo before planning");

  await evaluate(`app.plugins.getPlugin('qynote-compilation').generateTidyPlan()`);
  const plan = await evaluate(`(() => {
    const changes = app.plugins.getPlugin('qynote-compilation').getTidyPlan();
    return changes ? changes.map((c) => ({ path: c.path, kind: c.kind, before: c.before, after: c.after })) : null;
  })()`);
  assert(plan && plan.length >= 1, "Expected at least one tidy plan change");
  const planTarget = plan[0];
  await evaluate(`app.plugins.getPlugin('qynote-compilation').applyTidyPlan()`);
  await waitFor(`!!document.querySelector('.modal button')`, "plan preview modal");
  assert(await evaluate(`(() => {
    const button = [...document.querySelectorAll('.modal button')].find((b) => /^确认应用/.test(b.textContent.trim()));
    if (!button) return false;
    button.click();
    return true;
  })()`), "Plan confirm button not found");
  await waitFor(`!document.querySelector('.modal') && !!app.plugins.getPlugin('qynote-compilation').data.lastChange`, "plan applied");
  const appliedContent = await readFile(planTarget.path);
  assert.equal(appliedContent, planTarget.after, "Plan apply must write the reviewed after-content");
  assert(appliedContent.startsWith(planTarget.before.trimEnd()), "Plan apply must be append-only");
  await evaluate(`app.plugins.getPlugin('qynote-compilation').undoLastOrganization()`);
  await waitFor(`!!document.querySelector('.modal button')`, "undo diff modal");
  await clickModalButton("确认写回");
  await waitFor(`!document.querySelector('.modal') && !app.plugins.getPlugin('qynote-compilation').data.lastChange`, "plan undo");
  assert.equal(await readFile(planTarget.path), planTarget.before, "Undo must restore the pre-plan content");

  await evaluate(`app.plugins.getPlugin('qynote-compilation').generateTidyPlan()`);
  const quickPlan = await evaluate(`(() => {
    const changes = app.plugins.getPlugin('qynote-compilation').getTidyPlan();
    return changes ? changes.map((c) => ({ path: c.path, before: c.before, after: c.after })) : null;
  })()`);
  assert(quickPlan && quickPlan.length >= 1, "Expected a plan for quick mode");
  const quickTarget = quickPlan[0];
  await evaluate(`app.plugins.getPlugin('qynote-compilation').quickApplyTidyPlan()`);
  await waitFor(`!!document.querySelector('.modal button')`, "quick confirm modal");
  await clickModalButton("确认应用");
  await waitFor(`!document.querySelector('.modal') && !!app.plugins.getPlugin('qynote-compilation').data.lastChange`, "quick plan applied");
  const quickApplied = await readFile(quickTarget.path);
  assert.equal(quickApplied, quickTarget.after, "Quick apply must write the after-content");
  assert(quickApplied.startsWith(quickTarget.before.trimEnd()), "Quick apply must be append-only");
  await evaluate(`app.plugins.getPlugin('qynote-compilation').undoLastOrganization()`);
  await waitFor(`!!document.querySelector('.modal button')`, "quick undo modal");
  await clickModalButton("确认写回");
  await waitFor(`!document.querySelector('.modal') && !app.plugins.getPlugin('qynote-compilation').data.lastChange`, "quick plan undo");
  assert.equal(await readFile(quickTarget.path), quickTarget.before, "Quick undo must restore content");

  const performanceResult = await evaluate(`(async () => {
    const plugin = app.plugins.getPlugin('qynote-compilation');
    const originalSchedule = plugin.scheduleRefresh;
    plugin.scheduleRefresh = () => {};
    try {
      if (!app.vault.getAbstractFileByPath('性能')) await app.vault.createFolder('性能');
      for (let index = 0; index < 1000; index += 1) {
        const path = '性能/笔记' + index + '.md';
        if (!app.vault.getAbstractFileByPath(path)) {
          await app.vault.create(
            path,
            '# 性能笔记 ' + index + '\\n\\n这是用于验证大库刷新速度的第 ' + index + ' 篇笔记，包含学习、复习与知识管理等常见词语。'
          );
        }
      }
      const firstStarted = performance.now();
      await plugin.refreshViews();
      const firstRefreshMs = performance.now() - firstStarted;
      const secondStarted = performance.now();
      await plugin.refreshViews();
      const secondRefreshMs = performance.now() - secondStarted;
      const leaf = app.workspace.getLeavesOfType('qynote-compilation-view')[0];
      leaf.view.showPlan();
      let renderCount = 0;
      const originalRender = leaf.view.render;
      leaf.view.render = function (...args) {
        renderCount += 1;
        return originalRender.apply(this, args);
      };
      const editorLeaf = app.workspace.getLeaf(false);
      await editorLeaf.openFile(app.vault.getAbstractFileByPath('性能/笔记1.md'));
      await editorLeaf.openFile(app.vault.getAbstractFileByPath('性能/笔记2.md'));
      leaf.view.render = originalRender;
      const diagnosticsStarted = performance.now();
      await plugin.refreshDiagnostics();
      const diagnosticsMs = performance.now() - diagnosticsStarted;
      return {
        notes: plugin.snapshot.notes.length,
        firstRefreshMs,
        secondRefreshMs,
        planRendersOnTwoSwitches: renderCount,
        diagnosticsMs,
        diagnosticsReady: plugin.snapshot.diagnosticsReady
      };
    } finally {
      plugin.scheduleRefresh = originalSchedule;
      const fixtures = app.vault.getAbstractFileByPath('性能');
      if (fixtures) await app.vault.delete(fixtures, true);
      await plugin.refreshViews();
    }
  })()`);
  assert(performanceResult.firstRefreshMs < 1500, JSON.stringify(performanceResult));
  assert(performanceResult.secondRefreshMs < 1000, JSON.stringify(performanceResult));
  assert.equal(performanceResult.planRendersOnTwoSwitches, 0);
  assert(performanceResult.diagnosticsReady);

  const data = await evaluate(`(() => {
    const plugin = app.plugins.getPlugin('qynote-compilation');
    return {
      hasUndo: !!plugin.data.lastChange
    };
  })()`);
  assert.equal(data.hasUndo, false);
  assert.equal(runtimeErrors.length, 0, JSON.stringify(runtimeErrors));

  console.log(JSON.stringify({
    status: "passed",
    plugin: pluginState,
    stats,
    tabs,
    suggestion: { target: suggestion.targetPath, evidence: suggestion.evidence },
    tidyPlan: { changes: plan.length, appliedAndUndone: true },
    quickPlan: { changes: quickPlan.length, appliedAndUndone: true },
    performance: performanceResult,
    runtimeErrors: runtimeErrors.length
  }, null, 2));
} finally {
  if (socket) {
    socket.close();
  }
}