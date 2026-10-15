const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createServer } = require('node:http');
const { once } = require('node:events');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(window, expression) {
  for (let index = 0; index < 250; index++) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await delay(100);
  }
  throw new Error(`Desktop UI timed out: ${expression}`);
}

// 使用独立临时目录与本地假 API，验证真实 Electron 的线程、协议和 SQLite 持久化。
async function runSmokeTest(window, app, storage) {
  const timeout = setTimeout(() => app.exit(1), 60000);
  let requests = 0;
  let titleRequests = 0;
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(request.headers.authorization, 'Bearer desktop-test-key');
      let body = '';
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      if (input.messages[0]?.content.includes('根据首次问题提炼')) {
        titleRequests++;
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.end('data:{"choices":[{"delta":{"content":"SQLite 聊天自检标题"},"finish_reason":"stop"}]}\n\ndata:[DONE]\n');
        return;
      }
      const answer = ++requests === 1 ? '回复成功' : '回复成功·重答';
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('data:{"choices":[{"delta":{"reasoning_content":"桌面思考测试"}}]}\n\n');
      await delay(100);
      response.write('data:{"choices":[{"delta":{"content":"SQLite 流式"}}]}\n\n');
      await delay(100);
      response.end(`data:{"choices":[{"delta":{"content":${JSON.stringify(answer)}},"finish_reason":"stop"}]}\n\ndata:[DONE]\n`);
    } catch (error) { response.writeHead(500); response.end(error.message); }
  });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    await waitFor(window, "!!window.caudalflowFlush && !!document.querySelector('.react-flow')");
    const settings = { state: { llmConfig: { providerId: 'custom', providerName: 'Desktop test', endpoint: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'desktop-test-key', model: 'desktop-test-model', temperature: 0.7, maxTokens: 2048, mockDelay: 30 }, welcomeDismissed: true, language: 'zh', theme: 'light' }, version: 0 };
    await window.webContents.executeJavaScript(`localStorage.setItem('caudalflow-settings', ${JSON.stringify(JSON.stringify(settings))}); localStorage.setItem('i18nextLng','zh'); window.caudalflowFlush()`);
    let loaded = once(window.webContents, 'did-finish-load'); window.webContents.reload(); await loaded;
    await waitFor(window, "!!window.caudalflowFlush && !!document.querySelector('button[aria-label=\"新建对话\"]')");
    await window.webContents.executeJavaScript("document.querySelector('button[aria-label=\"新建对话\"]').click()");
    await waitFor(window, "!!document.querySelector('.react-flow textarea')");
    await window.webContents.executeJavaScript(`(async () => {
      const input = document.querySelector('.react-flow textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'SQLite 聊天自检');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    await waitFor(window, "document.body.innerText.includes('SQLite 流式回复成功')");
    await waitFor(window, "document.body.innerText.includes('SQLite 聊天自检标题')");
    await window.webContents.executeJavaScript('window.caudalflowFlush()');
    const registry = await storage.call('list');
    const workspaceId = registry[0].id;
    assert(registry[0].filePath.endsWith('.caudalflow'));
    let stored = await storage.call('load', { id: workspaceId });
    const nodeId = stored.data.nodes[0].id;
    assert.equal(stored.data.nodes[0].data.topic, 'SQLite 聊天自检标题');
    assert.equal(titleRequests, 1);
    const initialHistory = await storage.call('history', { id: workspaceId });
    const creation = initialHistory.find((entry) => entry.label === '创建会话并提问');
    assert(creation);
    const creationDetail = await storage.call('historyDetail', { id: workspaceId, historyId: creation.id });
    assert.equal(creationDetail.before.nodes.length, 0);
    assert.equal(creationDetail.after.conversations[nodeId].messages.length, 1);
    assert.equal(stored.data.conversations[nodeId].messages.at(-1).content, 'SQLite 流式回复成功');
    assert(stored.data.conversations[nodeId].messages.at(-1).versionId);
    assert(await window.webContents.executeJavaScript("document.querySelector('details').textContent.includes('桌面思考测试')"));

    const answerId = stored.data.conversations[nodeId].messages.at(-1).id;
    const context = `document.querySelector('[data-message-id="${answerId}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:700,clientY:400}))`;
    await window.webContents.executeJavaScript(context);
    await waitFor(window, "!!document.querySelector('[role=menu]')");
    await window.webContents.executeJavaScript("[...document.querySelectorAll('[role=menu] button')].find(button => button.textContent==='重新回答这个问题').click()");
    await waitFor(window, "document.body.innerText.includes('SQLite 流式回复成功·重答')");
    await window.webContents.executeJavaScript('window.caudalflowFlush()');
    await window.webContents.executeJavaScript(context);
    await window.webContents.executeJavaScript("[...document.querySelectorAll('[role=menu] button')].find(button => button.textContent==='文档版本').click()");
    await waitFor(window, "!!document.querySelector('[aria-label=\"文档版本\"] button') && [...document.querySelectorAll('[aria-label=\"文档版本\"] button')].some(button => button.textContent.includes('SQLite 流式回复成功') && !button.textContent.includes('重答'))");
    await window.webContents.executeJavaScript("[...document.querySelectorAll('[aria-label=\"文档版本\"] button')].find(button => button.textContent.includes('SQLite 流式回复成功') && !button.textContent.includes('重答')).click()");
    await waitFor(window, "!document.querySelector('[aria-label=\"文档版本\"]') && !document.body.innerText.includes('回复成功·重答')");
    await window.webContents.executeJavaScript('window.caudalflowFlush()');
    await window.webContents.executeJavaScript("document.querySelector('button[aria-label=\"撤销内容操作\"]').click()");
    await waitFor(window, "document.body.innerText.includes('SQLite 流式回复成功·重答')");
    await window.webContents.executeJavaScript("document.querySelector('button[aria-label=\"重做内容操作\"]').click()");
    await waitFor(window, "!document.body.innerText.includes('回复成功·重答')");
    assert.equal(requests, 2);

    // UI 入口修改完成状态，随后撤销和重做，不能重新调用模型。
    await window.webContents.executeJavaScript("document.querySelector('button[aria-label=\"卡片菜单\"]').click()");
    await waitFor(window, "!!document.querySelector('[role=menu]')");
    await window.webContents.executeJavaScript("document.querySelector('[role=menu] button').click()");
    await waitFor(window, "!!document.querySelector('[data-conversation-done]')");
    await window.webContents.executeJavaScript('window.caudalflowFlush()');
    await window.webContents.executeJavaScript("document.querySelector('button[aria-label=\"撤销内容操作\"]').click()");
    await waitFor(window, "!document.querySelector('[data-conversation-done]')");
    await window.webContents.executeJavaScript("document.querySelector('button[aria-label=\"重做内容操作\"]').click()");
    await waitFor(window, "!!document.querySelector('[data-conversation-done]')");
    await window.webContents.executeJavaScript('window.caudalflowFlush()');

    const legacy = await window.webContents.executeJavaScript("Object.keys(localStorage).filter(key => key.startsWith('caudalflow-workspace-'))");
    assert.deepEqual(legacy, []);
    loaded = once(window.webContents, 'did-finish-load'); window.webContents.reload(); await loaded;
    await waitFor(window, "!!window.caudalflowFlush && document.body.innerText.includes('SQLite 流式回复成功') && !!document.querySelector('[data-conversation-done]')");
    assert(await window.webContents.executeJavaScript("document.querySelector('button[aria-label=\"撤销内容操作\"]').disabled"));
    stored = await storage.call('load', { id: workspaceId });
    assert.equal(stored.data.conversations[nodeId].messages.at(-1).content, 'SQLite 流式回复成功');
    // 标题相同而地址不同：必须在历史原文对比中直接看到两侧 URL。
    stored.data.conversations[nodeId].messages.at(-1).content = '[同一标题](https://old.example)\n\n原段落';
    await storage.call('save', { id: workspaceId, data: stored.data, expectedRevision: stored.revision, label: '历史测试：旧原文' });
    stored = await storage.call('load', { id: workspaceId });
    stored.data.conversations[nodeId].messages.at(-1).content = '[同一标题](https://new.example)\n\n新段落';
    await storage.call('save', { id: workspaceId, data: stored.data, expectedRevision: stored.revision, label: '历史测试：链接变化' });
    loaded = once(window.webContents, 'did-finish-load'); window.webContents.reload(); await loaded;
    await waitFor(window, "!!window.caudalflowFlush && document.body.innerText.includes('新段落')");
    await window.webContents.executeJavaScript("document.querySelector('button[aria-label=\"本地历史\"]').click()");
    await waitFor(window, "!!document.querySelector('[aria-label=\"本地历史\"] [data-raw-diff]') && document.querySelector('[aria-label=\"原文差异\"]').textContent.includes('https://old.example') && document.querySelector('[aria-label=\"原文差异\"]').textContent.includes('https://new.example')");
    const visibleRecords = await window.webContents.executeJavaScript("[...document.querySelectorAll('[aria-label=\"修改记录\"] button')].filter(button => button.textContent.includes('历史测试：链接变化')).length");
    assert.equal(visibleRecords, 1);
    assert(await window.webContents.executeJavaScript("document.querySelector('[aria-label=\"涉及内容\"]').textContent.includes('SQLite 聊天自检')"));
    const historyScreenshot = path.join(app.getPath('userData'), 'local-history-smoke.png');
    await fs.writeFile(historyScreenshot, (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript("window.confirm=()=>true; [...document.querySelectorAll('[aria-label=\"本地历史\"] button')].find(button=>button.textContent==='还原').click()");
    await waitFor(window, "!document.querySelector('[role=\"dialog\"][aria-label=\"本地历史\"]') && document.body.innerText.includes('原段落')");
    await window.webContents.executeJavaScript('window.caudalflowFlush()');
    stored = await storage.call('load', { id: workspaceId });
    assert(stored.data.conversations[nodeId].messages.at(-1).content.includes('https://old.example'));
    assert(await window.webContents.executeJavaScript("document.querySelector('button[aria-label=\"撤销内容操作\"]').disabled"));
    const history = await storage.call('history', { id: workspaceId }); assert(history.length > 0);
    const destination = path.join(app.getPath('userData'), 'shared.caudalflow');
    await storage.call('export', { id: workspaceId, filename: destination });
    const { DatabaseSync } = require('node:sqlite'); const copy = new DatabaseSync(destination);
    assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='history'").get().n, 0);
    copy.close();
    const screenshot = path.join(app.getPath('userData'), 'storage-smoke.png');
    await fs.writeFile(screenshot, (await window.webContents.capturePage()).toPNG());
    console.log(JSON.stringify({ desktopSmoke: 'passed', packaged: app.isPackaged, storage: app.getPath('userData'), screenshot, historyScreenshot, checks: ['SQLite worker', 'native file format', 'streaming and reasoning', 'regeneration and immutable versions', 'version selection undo/redo without new API calls', 'undo/redo done state', 'reload durability', 'restart clears undo stack', 'no localStorage workspace writes', 'independent local history', 'one entry per operation', 'affected question/reply tree', 'raw Markdown URL diff', 'scoped history restore clears undo', 'portable workspace excludes personal history'] }));
    await storage.close(); clearTimeout(timeout); server.close(); app.exit(0);
  } catch (error) {
    console.error(error); clearTimeout(timeout); server.close(); app.exit(1);
  }
}

module.exports = { runSmokeTest };
