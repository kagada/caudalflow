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
  window.webContents.on('console-message', (event) => { if (event.level === 'error') console.error('Renderer:', event.message); });
  const timeout = setTimeout(() => app.exit(1), 60000);
  let requests = 0;
  let titleRequests = 0;
  let summaryRequests = 0;
  const chatRequests = [];
  const summaryPrompts = [];
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(request.headers.authorization, 'Bearer desktop-test-key');
      let body = '';
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      assert.equal(input.stream_options?.include_usage, true);
      if (input.messages[0]?.content.startsWith('将以下学习对话整理')) {
        summaryRequests++;
        summaryPrompts.push(input.messages[0].content);
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.end('data:{"choices":[{"delta":{"content":"引用摘要：SQLite 原段落的学习背景"},"finish_reason":"stop"}]}\ndata:{"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":50}}}\ndata:[DONE]\n');
        return;
      }
      if (input.messages[0]?.content.includes('根据首次问题提炼')) {
        titleRequests++;
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.end('data:{"choices":[{"delta":{"content":"SQLite 聊天自检标题"},"finish_reason":"stop"}]}\ndata:{"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":0}}}\ndata:[DONE]\n');
        return;
      }
      const answer = ++requests === 1 ? '回复成功' : '回复成功·重答';
      chatRequests.push(input);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('data:{"choices":[{"delta":{"reasoning_content":"桌面思考测试"}}]}\n\n');
      await delay(100);
      response.write('data:{"choices":[{"delta":{"content":"SQLite 流式"}}]}\n\n');
      await delay(100);
      response.end(`data:{"choices":[{"delta":{"content":${JSON.stringify(answer)}},"finish_reason":"stop"}]}\ndata:{"choices":[],"usage":{"prompt_tokens":${requests === 1 ? 200 : 210},"completion_tokens":30,"prompt_tokens_details":{"cached_tokens":100}}}\ndata:[DONE]\n`);
    } catch (error) { response.writeHead(500); response.end(error.message); }
  });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    await waitFor(window, "!!window.caudalflowFlush && !!document.querySelector('.react-flow')");
    const settings = { state: { llmConfig: { providerId: 'custom', providerName: 'Desktop test', endpoint: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'desktop-test-key', model: 'desktop-test-model', temperature: 0.7, maxTokens: 2048, mockDelay: 30 }, welcomeDismissed: true, language: 'zh', theme: 'light' }, version: 0 };
    await window.webContents.executeJavaScript(`localStorage.setItem('caudalflow-settings', ${JSON.stringify(JSON.stringify(settings))}); localStorage.setItem('i18nextLng','zh'); window.caudalflowFlush()`);
    // 发送入口从独立模型目录读取配置，自检也必须显式选择测试模型。
    const models = { state: { providers: [{ id: 'custom', name: 'Desktop test', endpoint: settings.state.llmConfig.endpoint, apiKey: 'desktop-test-key', enabled: true,
      models: [{ id: 'desktop-test-model', name: 'desktop-test-model', enabled: true }] }], defaultModel: { providerId: 'custom', providerName: 'Desktop test', modelId: 'desktop-test-model' } }, version: 0 };
    await window.webContents.executeJavaScript(`localStorage.setItem('caudalflow-local-models', ${JSON.stringify(JSON.stringify(models))})`);
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
    assert.equal(initialHistory.length, 1);
    const creation = initialHistory.find((entry) => entry.label === '创建会话并提问');
    assert(creation);
    const creationDetail = await storage.call('historyDetail', { id: workspaceId, historyId: creation.id });
    assert.equal(creationDetail.before.nodes.length, 0);
    assert.equal(creationDetail.after.conversations[nodeId].messages.length, 2);
    assert.equal(creationDetail.after.nodes[0].data.topic, 'SQLite 聊天自检标题');
    assert.equal(stored.data.conversations[nodeId].messages.at(-1).content, 'SQLite 流式回复成功');
    assert(Number.isSafeInteger(stored.data.conversations[nodeId].messages.at(-1).versionId));
    assert(await window.webContents.executeJavaScript("[...document.querySelectorAll('details')].some(item=>item.textContent.includes('桌面思考测试'))"));
    assert.equal(stored.data.conversations[nodeId].usage.reduce((sum, record) => sum + record.inputTokens, 0), 220);
    assert.equal(stored.data.conversations[nodeId].messages.at(-1).usage[0].cachedInputTokens, 100);
    await waitFor(window, "[...document.querySelectorAll('[data-token-usage]')].some(item=>item.textContent.includes('本会话累计') && item.textContent.includes('输入 220'))");

    const answerId = stored.data.conversations[nodeId].messages.at(-1).id;
    // 首次回答只有正文版本，生成占位符不能进入数据库或历史版本弹窗。
    assert.equal((await storage.call('versions', { id: workspaceId, documentId: answerId })).length, 1);
    const questionId = stored.data.conversations[nodeId].messages.find((message) => message.role === 'user').id;
    const usageIs = (id, count) => `document.querySelector('[data-message-id="${id}"] [data-token-usage]')?.textContent.includes('输入 ${count}')`;
    assert(await window.webContents.executeJavaScript(`!document.querySelector('[data-message-id="${questionId}"] [data-token-usage]')`));
    await waitFor(window, usageIs(answerId, 200));
    const context = `document.querySelector('[data-message-id="${answerId}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:700,clientY:400}))`;
    await window.webContents.executeJavaScript(context);
    await waitFor(window, "!!document.querySelector('[role=menu]')");
    await window.webContents.executeJavaScript("[...document.querySelectorAll('[role=menu] button')].find(button => button.textContent==='重新回答这个问题').click()");
    await waitFor(window, "document.body.innerText.includes('SQLite 流式回复成功·重答')");
    await window.webContents.executeJavaScript('window.caudalflowFlush()');
    assert.deepEqual(chatRequests[1].messages, chatRequests[0].messages);
    await waitFor(window, usageIs(answerId, 210));
    await window.webContents.executeJavaScript(context);
    await window.webContents.executeJavaScript("document.querySelector('[aria-label=\"重新回答这个问题的更多选项\"]').click()");
    await waitFor(window, "!!document.querySelector('[data-submenu]')");
    await window.webContents.executeJavaScript("[...document.querySelectorAll('[data-submenu] button')].find(button => button.textContent==='历史版本…').click()");
    await waitFor(window, "!!document.querySelector('[aria-label=\"文档版本\"] button') && [...document.querySelectorAll('[aria-label=\"文档版本\"] button')].some(button => button.textContent.includes('SQLite 流式回复成功') && !button.textContent.includes('重答'))");
    assert.equal((await storage.call('versions', { id: workspaceId, documentId: answerId })).length, 2);
    assert(await window.webContents.executeJavaScript("!document.querySelector('[aria-label=\"文档版本\"]').textContent.includes('空内容')"));
    await window.webContents.executeJavaScript("[...document.querySelectorAll('[aria-label=\"文档版本\"] button')].find(button => button.textContent.includes('SQLite 流式回复成功') && !button.textContent.includes('重答')).click()");
    await waitFor(window, "!document.querySelector('[aria-label=\"文档版本\"]') && !document.body.innerText.includes('回复成功·重答')");
    await window.webContents.executeJavaScript('window.caudalflowFlush()');
    await window.webContents.executeJavaScript("document.querySelector('button[aria-label=\"撤销内容操作\"]').click()");
    await waitFor(window, "document.body.innerText.includes('SQLite 流式回复成功·重答')");
    await window.webContents.executeJavaScript("document.querySelector('button[aria-label=\"重做内容操作\"]').click()");
    await waitFor(window, "!document.body.innerText.includes('回复成功·重答')");
    await waitFor(window, usageIs(answerId, 200));
    assert.equal(requests, 2);
    await window.webContents.executeJavaScript('window.caudalflowFlush()');
    const usageAfterVersionSwitch = (await storage.call('load', { id: workspaceId })).data.conversations[nodeId].usage;
    assert.equal(usageAfterVersionSwitch.filter((record) => record.purpose === 'answer').length, 2);
    assert.equal(usageAfterVersionSwitch.reduce((sum, record) => sum + record.inputTokens, 0), 430);

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
    await waitFor(window, usageIs(answerId, 200));
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
    // 只在测试中截获写剪切板请求，不改动用户的真实剪切板；粘贴仍走真实界面处理。
    await window.webContents.executeJavaScript(`(() => {
      const original = window.fetch.bind(window);
      window.fetch = (url, options) => {
        if (url === '/api/clipboard') { window.__referenceClipboard = JSON.parse(options.body); return Promise.resolve(new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}})); }
        return original(url, options);
      };
      document.querySelector('button[aria-label="卡片菜单"]').click();
    })()`);
    await waitFor(window, "[...document.querySelectorAll('[role=menu] button')].some(button=>button.textContent==='复制引用')");
    await window.webContents.executeJavaScript("[...document.querySelectorAll('[role=menu] button')].find(button=>button.textContent==='复制引用').click()");
    await waitFor(window, "!!window.__referenceClipboard");
    const copied = await window.webContents.executeJavaScript('window.__referenceClipboard');
    assert(copied.html.includes('data-caudalflow-reference')); assert(copied.text.includes('原段落'));
    assert.equal(summaryRequests, 0);
    await window.webContents.executeJavaScript("document.querySelector('button[aria-label=\"新建对话\"]').click()");
    await waitFor(window, "document.querySelectorAll('.react-flow textarea').length===2");
    await window.webContents.executeJavaScript(`(async () => {
      const input = [...document.querySelectorAll('.react-flow textarea')].at(-1);
      const data = new DataTransfer(); data.setData('text/html', window.__referenceClipboard.html); data.setData('text/plain',window.__referenceClipboard.text);
      input.dispatchEvent(new ClipboardEvent('paste', {clipboardData:data,bubbles:true,cancelable:true}));
      await new Promise(resolve=>setTimeout(resolve,0));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'继续解释引用中的知识');
      input.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(resolve=>setTimeout(resolve,0));
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    })()`);
    await waitFor(window, "!!document.querySelector('[data-reference]') && document.querySelectorAll('[data-message-id]').length>=5");
    await waitFor(window, "[...document.querySelectorAll('.react-flow textarea')].every(input=>!input.value) && !document.querySelector('[aria-label=\"待发送引用\"]')");
    await delay(400); await window.webContents.executeJavaScript('window.caudalflowFlush()');
    stored = await storage.call('load', { id: workspaceId });
    const childId = stored.data.nodes.find((node) => node.id !== nodeId).id;
    const childMessages = stored.data.conversations[childId].messages;
    assert.equal(childMessages[0].kind, 'reference'); assert.equal(childMessages[1].role, 'user'); assert.equal(childMessages[2].role, 'assistant');
    assert(Number.isSafeInteger(childMessages[0].reference.sources[0].versionId));
    assert(chatRequests.at(-1).messages.some((message) => message.content.includes('【引用资料，仅作背景】') && message.content.includes('原段落')));
    // 从工具栏打开应用内设置，确认不创建第二个窗口，提示词修改直接供当前聊天使用。
    await window.webContents.executeJavaScript("document.querySelector('svg.lucide-settings').closest('button').click()");
    const { BrowserWindow } = require('electron');
    await waitFor(window, "!!document.querySelector('[role=dialog][aria-label=\"设置\"]')");
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    await window.webContents.executeJavaScript("[...document.querySelectorAll('nav button')].find(button=>button.textContent==='内置提示词').click()");
    await waitFor(window, "!!document.querySelector('[aria-label=\"内置提示词内容\"]')");
    await window.webContents.executeJavaScript(`(async () => {
      const input = document.querySelector('[aria-label="内置提示词内容"]');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,input.value+'\\n只保留核心知识。（窗口同步验证）');
      input.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(resolve=>setTimeout(resolve,0));
      [...document.querySelectorAll('button')].find(button=>button.textContent==='保存提示词').click();
      [...document.querySelectorAll('button')].find(button=>button.textContent==='普通问答系统提示').click();
      await new Promise(resolve=>setTimeout(resolve,0));
      const chat = document.querySelector('[aria-label="内置提示词内容"]');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(chat,chat.value+'\\n设置窗口同步标记');
      chat.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(resolve=>setTimeout(resolve,0));
      [...document.querySelectorAll('button')].find(button=>button.textContent==='保存提示词').click();
    })()`);
    await delay(150);
    const settingsScreenshot = path.join(app.getPath('userData'), 'settings-panel-smoke.png');
    await fs.writeFile(settingsScreenshot, (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript("document.querySelector('[role=dialog][aria-label=\"设置\"] > div button[aria-label]').click()");
    await waitFor(window, "!document.querySelector('[role=dialog][aria-label=\"设置\"]')");
    await window.webContents.executeJavaScript("document.querySelector('button[aria-label=\"新建对话\"]').click()");
    await waitFor(window, "document.querySelectorAll('.react-flow textarea').length===3");
    await window.webContents.executeJavaScript(`(async () => {
      const input = [...document.querySelectorAll('.react-flow textarea')].at(-1);
      const copied = ${JSON.stringify(copied)};
      const data = new DataTransfer(); data.setData('text/html',copied.html); data.setData('text/plain',copied.text);
      input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'设置窗口同步测试');
      input.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(resolve=>setTimeout(resolve,0));
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    })()`);
    await waitFor(window, "document.querySelectorAll('[data-reference]').length===2");
    await delay(400); await window.webContents.executeJavaScript('window.caudalflowFlush()');
    assert(chatRequests.at(-1).messages[0].content.includes('设置窗口同步标记'));
    assert(summaryPrompts.at(-1).includes('窗口同步验证'));
    assert(!chatRequests.at(-1).messages.some((message) => message.content.includes('Branched from a conversation')));
    const referenceScreenshot = path.join(app.getPath('userData'), 'reference-smoke.png');
    await fs.writeFile(referenceScreenshot, (await window.webContents.capturePage()).toPNG());
    loaded = once(window.webContents, 'did-finish-load'); window.webContents.reload(); await loaded;
    await waitFor(window, "!!window.caudalflowFlush && !!document.querySelector('[data-reference]')");
    stored = await storage.call('load', { id: workspaceId });
    assert.equal(stored.data.conversations[childId].messages[0].reference.quote, childMessages[0].reference.quote);
    // 重载后从同篇回答的另一选区创建分支，复用磁盘摘要缓存。
    await window.webContents.executeJavaScript(`(() => {
      const source = [...document.querySelectorAll('[data-message-id="${answerId}"] p')].find(element=>element.textContent==='原段落');
      const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
      let leaf; while ((leaf=walker.nextNode()) && !leaf.textContent.includes('原段落')) {}
      const range = document.createRange(); range.setStart(leaf, leaf.textContent.indexOf('原段落')+1); range.setEnd(leaf, leaf.textContent.indexOf('原段落')+2);
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      source.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:700,clientY:400}));
    })()`);
    await waitFor(window, "[...document.querySelectorAll('[role=menu] button')].some(button=>button.textContent==='从选区分支追问')");
    await window.webContents.executeJavaScript("[...document.querySelectorAll('[role=menu] button')].find(button=>button.textContent==='从选区分支追问').click()");
    await waitFor(window, "document.querySelectorAll('[data-reference]').length===3");
    await delay(400); await window.webContents.executeJavaScript('window.caudalflowFlush()');
    stored = await storage.call('load', { id: workspaceId });
    const branch = stored.data.nodes.find((node) => node.data.parentNodeId === nodeId);
    assert(branch);
    const branchMessages = stored.data.conversations[branch.id].messages;
    assert.equal(branchMessages[0].kind, 'reference'); assert.equal(branchMessages[0].reference.quote, '段');
    assert.equal(branchMessages[0].reference.sources[0].length, 1);
    assert.equal(branchMessages[0].reference.sources[0].documentId, answerId);
    assert.equal(summaryRequests, 2);
    assert(chatRequests.at(-1).messages.some((message) => message.content.includes('【引用资料，仅作背景】') && message.content.includes('原段落')));
    // 从非 1 倍缩放点击真实来源按钮，验证溯源不会改变缩放。
    await window.webContents.executeJavaScript("document.querySelector('svg.lucide-zoom-out').closest('button').click()");
    await delay(300);
    const beforeLocate = await window.webContents.executeJavaScript("document.querySelector('.react-flow__viewport').style.transform.split('scale(')[1].split(')')[0]");
    assert(Number(beforeLocate)<1);
    await window.webContents.executeJavaScript(`document.querySelector('[data-id="${branch.id}"] [data-reference] button').click()`);
    await delay(400);
    const afterLocate = await window.webContents.executeJavaScript("document.querySelector('.react-flow__viewport').style.transform.split('scale(')[1].split(')')[0]");
    assert.equal(afterLocate,beforeLocate);
    // 后续滚轮验证在 1 倍下点击目标更稳定；通过用户缩放按钮恢复，溯源本身不改缩放。
    await window.webContents.executeJavaScript("document.querySelector('svg.lucide-zoom-in').closest('button').click()");
    await delay(300);
    // 原生滚轮事件应滚动长输入框，不能改变画布的缩放变换。
    await window.webContents.executeJavaScript("window.dispatchEvent(new CustomEvent('caudalflow:locate-reference',{detail:"+JSON.stringify(branch.id)+"}))");
    await delay(400);
    const wheelTarget = await window.webContents.executeJavaScript(`(async () => {
      const input = document.querySelector('[data-id="${branch.id}"] textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, Array.from({length:30},(_,i)=>'滚动行 '+i).join('\\n'));
      input.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(resolve=>setTimeout(resolve,0));
      input.focus(); input.scrollTop=0;
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const rect=input.getBoundingClientRect();
      if (document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)!==input) throw new Error('Wheel input is occluded');
      return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2),transform:document.querySelector('.react-flow__viewport').style.transform};
    })()`);
    window.webContents.focus();
    window.webContents.sendInputEvent({type:'mouseMove',x:wheelTarget.x,y:wheelTarget.y});
    await delay(50);
    window.webContents.sendInputEvent({type:'mouseWheel',x:wheelTarget.x,y:wheelTarget.y,deltaY:-80,deltaX:0});
    await delay(200);
    const wheelResult = await window.webContents.executeJavaScript(`({scroll:document.querySelector('[data-id="${branch.id}"] textarea').scrollTop,transform:document.querySelector('.react-flow__viewport').style.transform})`);
    assert.equal(wheelResult.transform,wheelTarget.transform); assert(wheelResult.scroll>0,JSON.stringify(wheelResult));
    await window.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('[data-id="${branch.id}"] textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input,''); input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    // 用真实鼠标验证菜单在画布和卡片正文上都能关闭，保留正常的画布事件处理。
    for (const target of ['canvas', 'message']) {
      await window.webContents.executeJavaScript("document.querySelector('div.min-h-9 button').click()");
      await waitFor(window, "!!document.querySelector('div.min-h-9 .max-h-60')");
      const point = await window.webContents.executeJavaScript(`(() => {
        if ('${target}' === 'canvas') {
          const pane = document.querySelector('.react-flow__pane');
          for(let y=100;y<innerHeight-100;y+=80) for(let x=100;x<innerWidth-100;x+=80) {
            if(document.elementFromPoint(x,y)===pane) return {x,y};
          }
        } else {
          for(const content of document.querySelectorAll('.react-flow__node [data-message-content]')) {
            const rect=content.getBoundingClientRect();
            const x=Math.round(rect.x+rect.width/2),y=Math.round(rect.y+rect.height/2);
            if(x>0 && y>40 && x<innerWidth && y<innerHeight && content.contains(document.elementFromPoint(x,y))) return {x,y};
          }
        }
        throw new Error('No visible '+ '${target}' +' target for dropdown test');
      })()`);
      window.webContents.focus();
      window.webContents.sendInputEvent({type:'mouseMove',...point});
      window.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});
      window.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});
      await waitFor(window, "!document.querySelector('div.min-h-9 .max-h-60')");
    }
    for (const entry of ['title', 'dropdown']) {
      await window.webContents.executeJavaScript(`(async () => {
        if ('${entry}' === 'dropdown') { document.querySelector('div.min-h-9 button').click(); await new Promise(resolve=>setTimeout(resolve,0)); }
        const buttons = [...document.querySelectorAll('button')].filter(button=>button.title==='重命名工作区');
        buttons['${entry}' === 'dropdown' ? 1 : 0].click();
      })()`);
      await waitFor(window, "!!document.querySelector('input.w-48')");
      const name = entry === 'dropdown' ? '下拉菜单改名测试' : '标题改名测试';
      await window.webContents.executeJavaScript(`(async () => {
        const input = document.querySelector('input.w-48'); input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(name)}); input.dispatchEvent(new Event('input',{bubbles:true}));
        await new Promise(resolve=>setTimeout(resolve,0));
      })()`);
      // 用原生鼠标点击空白画布；这里会阻止默认失焦，不能用 input.blur() 代替。
      const outsidePoint = await window.webContents.executeJavaScript(`(() => {
        const pane = document.querySelector('.react-flow__pane');
        window.__renameCanvasPointerPrevented = false;
        pane.addEventListener('pointerdown',event=>{window.__renameCanvasPointerPrevented=event.defaultPrevented},{once:true});
        for(let y=100;y<innerHeight-100;y+=80) for(let x=100;x<innerWidth-100;x+=80) {
          if(document.elementFromPoint(x,y)===pane) return {x,y};
        }
        throw new Error('No blank canvas point for rename test');
      })()`);
      window.webContents.focus();
      window.webContents.sendInputEvent({type:'mouseMove',...outsidePoint});
      window.webContents.sendInputEvent({type:'mouseDown',...outsidePoint,button:'left',clickCount:1});
      window.webContents.sendInputEvent({type:'mouseUp',...outsidePoint,button:'left',clickCount:1});
      await waitFor(window, "!document.querySelector('input.w-48') && document.body.innerText.includes("+JSON.stringify(name)+") && !document.body.innerText.includes('正在处理工作区')");
      assert.equal((await storage.call('load',{id:workspaceId})).metadata.name,name);
      assert(await window.webContents.executeJavaScript('window.__renameCanvasPointerPrevented'));
    }
    // 两个完整引用与一个单字引用覆盖同一段落，应显示三个问题，而不是叠加底色。
    const branchQuestionId = branchMessages.find(message=>message.role==='user').id;
    await window.webContents.executeJavaScript("window.dispatchEvent(new CustomEvent('caudalflow:locate-reference',{detail:"+JSON.stringify(nodeId)+"}))");
    await delay(350);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('[data-message-id="${answerId}"] mark').length`),0);
    const backlinkAnchor = await window.webContents.executeJavaScript(`(() => {
      const paragraph=[...document.querySelectorAll('[data-message-id="${answerId}"] p')].find(item=>item.textContent==='原段落');
      const button=paragraph.querySelector('[data-backlink-count]');
      if(getComputedStyle(paragraph).cursor!=='auto') throw new Error('Document must use browser default cursor');
      if(getComputedStyle(button).cursor!=='pointer') throw new Error('Reference button must retain pointer cursor');
      const card=paragraph.closest('.react-flow__node');
      const input=card.querySelector('textarea');
      const inputArea=input.closest('.nodrag');
      for(const element of [inputArea,input.parentElement]) {
        if(getComputedStyle(element).cursor!=='auto') throw new Error('Input padding and button gaps must use browser default cursor');
      }
      if(getComputedStyle(input).cursor!=='auto' && getComputedStyle(input).cursor!=='text') throw new Error('Editor must not inherit canvas grab cursor');
      if(!card.querySelector('.cursor-move')) throw new Error('Card header must retain drag cursor');
      if(button.dataset.backlinkCount!=='3') throw new Error('Expected three distinct referencing questions');
      const rect=button.getBoundingClientRect(); return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)};
    })()`);
    // auto 的实际光标由浏览器按内容决定，不能只检查计算样式里的字符串。
    const textPoint = await window.webContents.executeJavaScript(`(() => {
      const paragraph=[...document.querySelectorAll('[data-message-id="${answerId}"] p')].find(item=>item.textContent==='原段落');
      const walker=document.createTreeWalker(paragraph,NodeFilter.SHOW_TEXT); const text=walker.nextNode();
      const range=document.createRange(); range.selectNodeContents(text); const rect=range.getBoundingClientRect();
      return {x:Math.round(rect.x+2),y:Math.round(rect.y+rect.height/2)};
    })()`);
    let documentCursor;
    const recordCursor = (_event, type) => { documentCursor = type; };
    window.webContents.on('cursor-changed', recordCursor);
    try {
      window.webContents.sendInputEvent({type:'mouseMove',x:100,y:20}); await delay(50);
      window.webContents.sendInputEvent({type:'mouseMove',...textPoint}); await delay(150);
      assert.equal(documentCursor,'text','Native document cursor must be I-beam');
    } finally { window.webContents.removeListener('cursor-changed',recordCursor); }
    window.webContents.sendInputEvent({type:'mouseMove',...backlinkAnchor});
    await waitFor(window,"document.querySelectorAll('[data-backlink-question]').length===3");
    const previewPoint = await window.webContents.executeJavaScript(`(() => {
      const item=document.querySelector('[data-backlink-question="${branchQuestionId}"]'); item.scrollIntoView({block:'nearest'});
      const rect=item.getBoundingClientRect(); return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)};
    })()`);
    window.webContents.sendInputEvent({type:'mouseMove',...previewPoint});
    await waitFor(window,`document.querySelector('[data-message-id="${answerId}"] mark')?.textContent==='段'`);
    assert(await window.webContents.executeJavaScript("!!document.querySelector('[aria-label=\"引用此处的问题\"]')"));
    await delay(220);
    assert(await window.webContents.executeJavaScript("!!document.querySelector('[aria-label=\"引用此处的问题\"]')"));
    window.webContents.sendInputEvent({type:'mouseMove',x:100,y:100});
    await waitFor(window,"!document.querySelector('[aria-label=\"引用此处的问题\"]')");
    assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('[data-message-id="${answerId}"] mark').length`),0);
    // 再验证点击固定列表，便于逐项查看与选择。
    await window.webContents.executeJavaScript(`(() => {
      const paragraph=[...document.querySelectorAll('[data-message-id="${answerId}"] p')].find(item=>item.textContent==='原段落');
      paragraph.querySelector('[data-backlink-count]').click();
    })()`);
    await waitFor(window,"document.querySelectorAll('[data-backlink-question]').length===3");
    window.webContents.sendInputEvent({type:'mouseMove',...previewPoint});
    await waitFor(window,`document.querySelector('[data-message-id="${answerId}"] mark')?.textContent==='段'`);
    // 在实际 Chromium 中核对两种主题的高亮字色与底色，避免只验证类名。
    const highlightScreenshots = [];
    for (const theme of ['light', 'dark']) {
      const colors = await window.webContents.executeJavaScript(`(async () => {
        document.documentElement.dataset.theme = '${theme}';
        await new Promise(resolve => setTimeout(resolve, 250));
        const mark = document.querySelector('[data-message-id="${answerId}"] mark.reference-highlight');
        if (!mark) throw new Error('Missing source reference highlight');
        const style = getComputedStyle(mark);
        return {text: style.color, background: style.backgroundColor, primary: getComputedStyle(document.body).color};
      })()`);
      assert.equal(colors.text, colors.primary);
      const luminance = (value) => {
        const channels = value.match(/[\d.]+/g).slice(0, 3).map(Number).map((channel) => {
          const x = channel / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const a = luminance(colors.text), b = luminance(colors.background);
      assert((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, JSON.stringify(colors));
      await delay(250);
      const filename = path.join(app.getPath('userData'), `reference-highlight-${theme}.png`);
      await fs.writeFile(filename, (await window.webContents.capturePage()).toPNG());
      highlightScreenshots.push(filename);
    }
    await window.webContents.executeJavaScript("document.documentElement.dataset.theme='light'");
    await window.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await waitFor(window,"!document.querySelector('[aria-label=\"引用此处的问题\"]')");
    assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('[data-message-id="${answerId}"] mark').length`),0);
    // 正向定位必须落到具体问题，并与反向来源跳转一样保留缩放。
    await window.webContents.executeJavaScript("document.querySelector('svg.lucide-zoom-out').closest('button').click()"); await delay(300);
    const forwardZoom = await window.webContents.executeJavaScript("document.querySelector('.react-flow__viewport').style.transform.split('scale(')[1].split(')')[0]");
    await window.webContents.executeJavaScript(`(() => {
      const paragraph=[...document.querySelectorAll('[data-message-id="${answerId}"] p')].find(item=>item.textContent==='原段落');
      paragraph.querySelector('[data-backlink-count]').click();
    })()`);
    await waitFor(window,"document.querySelectorAll('[data-backlink-question]').length===3");
    await window.webContents.executeJavaScript(`document.querySelector('[data-backlink-question="${branchQuestionId}"]').click()`);
    await waitFor(window,`!!document.querySelector('[data-message-id="${branchQuestionId}"] [data-message-content]')?.getAnimations().length`);
    await delay(250);
    assert.equal(await window.webContents.executeJavaScript("document.querySelector('.react-flow__viewport').style.transform.split('scale(')[1].split(')')[0]"),forwardZoom);
    assert(!await window.webContents.executeJavaScript("!!document.querySelector('[aria-label=\"引用此处的问题\"]')"));
    // 原生平移和缩放后的视角必须跨重载恢复，各工作区独立保存，且不产生内容历史。
    await window.webContents.executeJavaScript('window.caudalflowFlush()');
    const historyBeforeViewport = (await storage.call('history',{id:workspaceId})).length;
    await window.webContents.executeJavaScript("document.querySelector('svg.lucide-zoom-out').closest('button').click()"); await delay(350);
    const panPoint = await window.webContents.executeJavaScript(`(() => {
      const pane=document.querySelector('.react-flow__pane');
      for(let y=120;y<innerHeight-140;y+=60) for(let x=140;x<innerWidth-240;x+=60) {
        if(document.elementFromPoint(x,y)===pane) return {x,y};
      }
      throw new Error('No blank pane for viewport pan');
    })()`);
    window.webContents.sendInputEvent({type:'mouseDown',...panPoint,button:'middle',clickCount:1});
    window.webContents.sendInputEvent({type:'mouseMove',x:panPoint.x+117,y:panPoint.y+73});
    window.webContents.sendInputEvent({type:'mouseUp',x:panPoint.x+117,y:panPoint.y+73,button:'middle',clickCount:1});
    await delay(150);
    const savedTransform = await window.webContents.executeJavaScript("document.querySelector('.react-flow__viewport').style.transform");
    const localViewport = await window.webContents.executeJavaScript(`JSON.parse(localStorage.getItem('caudalflow-workspaces')).state.viewports[${JSON.stringify(workspaceId)}]`);
    assert(localViewport && localViewport.zoom!==1);
    const otherWorkspace = await storage.call('create',{name:'视角隔离测试',filename:path.join(app.getPath('userData'),'viewport-test.caudalflow')});
    loaded=once(window.webContents,'did-finish-load'); window.webContents.reload(); await loaded;
    await waitFor(window,`!!window.caudalflowFlush && document.querySelector('.react-flow__viewport')?.style.transform===${JSON.stringify(savedTransform)}`);
    const selectWorkspace = async (name) => {
      await window.webContents.executeJavaScript(`document.querySelector('div.min-h-9 button').click()`);
      await window.webContents.executeJavaScript(`[...document.querySelectorAll('div.max-h-60 > button')].find(button=>button.textContent.includes(${JSON.stringify(name)})).click()`);
    };
    await selectWorkspace(otherWorkspace.metadata.name);
    await waitFor(window,"document.querySelector('.react-flow__viewport')?.style.transform==='translate(0px, 0px) scale(1)'");
    await window.webContents.executeJavaScript("document.querySelector('svg.lucide-zoom-in').closest('button').click()"); await delay(350);
    const otherTransform = await window.webContents.executeJavaScript("document.querySelector('.react-flow__viewport').style.transform");
    await selectWorkspace((await storage.call('load',{id:workspaceId})).metadata.name);
    await waitFor(window,`document.querySelector('.react-flow__viewport')?.style.transform===${JSON.stringify(savedTransform)}`);
    await selectWorkspace(otherWorkspace.metadata.name);
    await waitFor(window,`document.querySelector('.react-flow__viewport')?.style.transform===${JSON.stringify(otherTransform)}`);
    await selectWorkspace((await storage.call('load',{id:workspaceId})).metadata.name);
    await waitFor(window,`document.querySelector('.react-flow__viewport')?.style.transform===${JSON.stringify(savedTransform)}`);
    await window.webContents.executeJavaScript('window.caudalflowFlush()');
    assert.equal((await storage.call('history',{id:workspaceId})).length,historyBeforeViewport);
    // 重开缩小的自定义尺寸卡片，再走真实展开入口，不能回退到默认大小。
    stored = await storage.call('load', { id: workspaceId });
    const sizedNode = stored.data.nodes.find(node => node.id === nodeId);
    sizedNode.style = { width: 760, height: 640 };
    sizedNode.data.minimized = true; sizedNode.data.collapsed = false;
    await storage.call('save', { id: workspaceId, data: stored.data, expectedRevision: stored.revision, history: false });
    loaded=once(window.webContents,'did-finish-load'); window.webContents.reload(); await loaded;
    await waitFor(window, `!!window.caudalflowFlush && document.querySelector('.react-flow__node[data-id="${nodeId}"]')?.style.width==='260px'`);
    await window.webContents.executeJavaScript(`document.querySelector('.react-flow__node[data-id="${nodeId}"] > div').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
    await waitFor(window, `document.querySelector('.react-flow__node[data-id="${nodeId}"]')?.style.width==='760px'`);
    await window.webContents.executeJavaScript('window.caudalflowFlush()');
    const expandedNode = (await storage.call('load', { id: workspaceId })).data.nodes.find(node => node.id === nodeId);
    assert.equal(expandedNode.style.width, 760); assert.equal(expandedNode.style.height, 640);
    const destination = path.join(app.getPath('userData'), 'shared.caudalflow');
    await storage.call('export', { id: workspaceId, filename: destination });
    const { DatabaseSync } = require('node:sqlite'); const copy = new DatabaseSync(destination);
    assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='history'").get().n, 0);
    assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM document_versions WHERE typeof(id)<>'integer'").get().n, 0);
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM documents WHERE kind IS NULL').get().n, 0);
    assert.deepEqual(copy.prepare('PRAGMA foreign_key_check').all(), []);
    copy.close();
    // 同一会话第二次回答的用量在重载后仍可读取。
    const previousRequests = requests;
    await window.webContents.executeJavaScript(`(async () => {
      const input = document.querySelector('.react-flow__node[data-id="${nodeId}"] textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'第二问用量验证');
      input.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(resolve=>setTimeout(resolve,0));
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    })()`);
    await waitFor(window, `document.querySelector('.react-flow__node[data-id="${nodeId}"] textarea')?.disabled === false && document.querySelector('.react-flow__node[data-id="${nodeId}"] [data-message-id]:last-child [data-token-usage]')?.textContent.includes('输入 210') && [...document.querySelectorAll('[data-message-id]')].some(element=>element.textContent.includes('第二问用量验证'))`);
    await window.webContents.executeJavaScript('window.caudalflowFlush()');
    assert.equal(requests, previousRequests + 1);
    stored = await storage.call('load', { id: workspaceId });
    const laterQuestion = stored.data.conversations[nodeId].messages.at(-2);
    const laterAnswer = stored.data.conversations[nodeId].messages.at(-1);
    assert.equal(laterQuestion.content, '第二问用量验证');
    loaded = once(window.webContents, 'did-finish-load'); window.webContents.reload(); await loaded;
    await waitFor(window, usageIs(laterAnswer.id, 210));
    assert(await window.webContents.executeJavaScript(`!document.querySelector('[data-message-id="${laterQuestion.id}"] [data-token-usage]')`));
    // 在真实会话和全局样式下跨消息拖选，覆盖辅助信息的选择样式冲突。
    const selectionPoints = await window.webContents.executeJavaScript(`(() => {
      document.querySelector('.react-flow__viewport').style.transform = 'translate(0px,0px) scale(1)';
      for (const node of document.querySelectorAll('.react-flow__node')) {
        if (node.dataset.id === '${nodeId}') { node.style.transform = 'translate(80px,80px)'; node.querySelector('.select-text').scrollTop = 0; }
        else node.style.visibility = 'hidden';
      }
      const first = document.querySelector('[data-message-id="${questionId}"] [data-message-content]');
      const second = document.querySelector('[data-message-id="${laterQuestion.id}"] [data-message-content]');
      const firstText = document.createTreeWalker(first,NodeFilter.SHOW_TEXT).nextNode();
      const lastText = document.createTreeWalker(second,NodeFilter.SHOW_TEXT).nextNode();
      const start = document.createRange(); start.setStart(firstText,0); start.setEnd(firstText,1);
      const end = document.createRange(); end.setStart(lastText,lastText.length-1); end.setEnd(lastText,lastText.length);
      const a = start.getBoundingClientRect(), b = end.getBoundingClientRect();
      return { start: { x:Math.round(a.left+1), y:Math.round(a.top+a.height/2) }, end:{x:Math.round(b.right+1),y:Math.round(b.top+b.height/2)} };
    })()`);
    window.webContents.sendInputEvent({type:'mouseDown',...selectionPoints.start,button:'left',clickCount:1});
    window.webContents.sendInputEvent({type:'mouseMove',...selectionPoints.end});
    window.webContents.sendInputEvent({type:'mouseUp',...selectionPoints.end,button:'left',clickCount:1});
    const selectedText = await window.webContents.executeJavaScript("window.getSelection().toString()");
    assert(selectedText.includes('SQLite 聊天自检')); assert(selectedText.includes('第二问用量验证'));
    assert(selectedText.includes('原段落'));
    assert(!selectedText.includes('本次回答')); assert(!selectedText.includes('缓存命中'));
    assert(await window.webContents.executeJavaScript(`getComputedStyle(document.querySelector('[data-message-id="${answerId}"] [data-token-usage]')).userSelect === 'none'`));
    await window.webContents.executeJavaScript("window.getSelection().removeAllRanges()");
    assert(await window.webContents.executeJavaScript("!document.querySelector('details[data-token-usage], [data-token-usage] summary')"));
    const screenshot = path.join(app.getPath('userData'), 'storage-smoke.png');
    await fs.writeFile(screenshot, (await window.webContents.capturePage()).toPNG());
    console.log(JSON.stringify({ desktopSmoke: 'passed', packaged: app.isPackaged, storage: app.getPath('userData'), screenshot, historyScreenshot, referenceScreenshot, settingsScreenshot, highlightScreenshots, checks: ['SQLite worker', 'native file format', 'streaming and reasoning', 'regeneration and immutable versions', 'version selection undo/redo without new API calls', 'undo/redo done state', 'reload durability', 'restart clears undo stack', 'no localStorage workspace writes', 'independent local history', 'one entry per operation', 'affected question/reply tree', 'raw Markdown URL diff', 'scoped history restore clears undo', 'immediate copy without model request', 'copy reference and paste attachment', 'visible reference/question/reply order', 'snapshot context in real API request', 'reference survives reload', 'in-app settings without a second native window', 'in-app prompt edits applied to next request', 'prompt changes invalidate summary cache', 'portable workspace excludes personal history', 'reference highlights readable in light and dark themes', 'single-character branch range', 'native wheel scrolls input without zoom', 'metadata rename without canvas blocking', 'dropdown rename exits editing and persists', 'native outside click saves rename despite canvas preventDefault', 'native canvas and message clicks close workspace menu', 'source navigation preserves current zoom', 'overlapping references list distinct questions', 'native hover previews only selected range', 'hover popup stays open across the gap and closes on leave', 'no permanent reference highlight', 'forward jump locates exact question without zoom'] }));
    await storage.close(); clearTimeout(timeout); server.close(); app.exit(0);
  } catch (error) {
    console.error(error); clearTimeout(timeout); server.close(); app.exit(1);
  }
}

module.exports = { runSmokeTest };
