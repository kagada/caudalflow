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
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(request.headers.authorization, 'Bearer desktop-test-key');
      for await (const chunk of request) void chunk;
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
    await window.webContents.executeJavaScript('window.caudalflowFlush()');
    const registry = await storage.call('list');
    const workspaceId = registry[0].id;
    assert(registry[0].filePath.endsWith('.caudalflow'));
    let stored = await storage.call('load', { id: workspaceId });
    const nodeId = stored.data.nodes[0].id;
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
    const history = await storage.call('history', { id: workspaceId }); assert(history.length > 0);
    const destination = path.join(app.getPath('userData'), 'shared.caudalflow');
    await storage.call('export', { id: workspaceId, filename: destination });
    const { DatabaseSync } = require('node:sqlite'); const copy = new DatabaseSync(destination);
    assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='history'").get().n, 0);
    copy.close();
    const screenshot = path.join(app.getPath('userData'), 'storage-smoke.png');
    await fs.writeFile(screenshot, (await window.webContents.capturePage()).toPNG());
    console.log(JSON.stringify({ desktopSmoke: 'passed', packaged: app.isPackaged, storage: app.getPath('userData'), screenshot, checks: ['SQLite worker', 'native file format', 'streaming and reasoning', 'regeneration and immutable versions', 'version selection undo/redo without new API calls', 'undo/redo done state', 'reload durability', 'restart clears undo stack', 'no localStorage workspace writes', 'independent local history', 'portable workspace excludes personal history'] }));
    await storage.close(); clearTimeout(timeout); server.close(); app.exit(0);
  } catch (error) {
    console.error(error); clearTimeout(timeout); server.close(); app.exit(1);
  }
}

module.exports = { runSmokeTest };
