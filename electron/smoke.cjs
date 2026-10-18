const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createServer } = require('node:http');
const { once } = require('node:events');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(window, expression) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await delay(100);
  }
  throw new Error(`Desktop UI timed out: ${expression}`);
}

// 使用真实鼠标事件验证跨独立阅读视图的点击，避免脚本 click 漏掉按下和释放阶段。
async function clickElement(window, selector) {
  const point = await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing click target: ' + ${JSON.stringify(selector)});
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  })()`);
  window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  await delay(100);
}

// 在真实 Electron 窗口中验证打包资源、流式聊天、导出和刷新后持久化，不调用付费 API。
async function runSmokeTest(window, app) {
  // 输出渲染端异常，避免界面回归失败时只得到 executeJavaScript 的通用错误。
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error') console.error(event.message);
  });
  const timeout = setTimeout(() => app.exit(1), 60000);
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/chat/completions');
      assert.equal(req.headers.authorization, 'Bearer desktop-test-key');
      let body = '';
      for await (const chunk of req) body += chunk;
      assert.equal(JSON.parse(body).model, 'desktop-test-model');
      // 故意不提供 CORS 响应头，验证桌面转发不依赖服务商的浏览器许可。
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data:{"choices":[{"delta":{"reasoning_content":"桌面思考测试"}}]}\n\n');
      await delay(150);
      res.write('data:{"choices":[{"delta":{"content":"桌面流式"}}]}\n\n');
      await delay(150);
      res.end('data:{"choices":[{"delta":{"content":"回复成功"},"finish_reason":"stop"}]}\n\ndata:[DONE]\n');
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    await waitFor(window, "!!document.querySelector('.react-flow')");
    const config = {
      state: { llmConfig: { providerId: 'custom', providerName: 'Desktop test', endpoint: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'desktop-test-key', model: 'desktop-test-model', temperature: 0.7, maxTokens: 2048, mockDelay: 30 }, welcomeDismissed: true, language: 'zh', theme: 'light' },
      version: 0,
    };
    await window.webContents.executeJavaScript(`localStorage.clear(); localStorage.setItem('caudalflow-settings', ${JSON.stringify(JSON.stringify(config))}); localStorage.setItem('i18nextLng', 'zh');`);
    let loaded = once(window.webContents, 'did-finish-load');
    window.webContents.reload();
    await loaded;
    await waitFor(window, "!!document.querySelector('.react-flow textarea')");
    await window.webContents.executeJavaScript(`(async () => {
      const input = document.querySelector('.react-flow textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '桌面聊天自检');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    await waitFor(window, "document.body.innerText.includes('桌面流式回复成功')");
    assert(await window.webContents.executeJavaScript("document.querySelector('details').textContent.includes('桌面思考测试')"));
    const placement = await window.webContents.executeJavaScript(`(async () => {
      const original = document.querySelector('.react-flow__node.selected');
      const before = original.getBoundingClientRect();
      const zBefore = Number(getComputedStyle(original).zIndex);
      document.querySelector('button[aria-label="新建对话"]').click();
      await new Promise(resolve => setTimeout(resolve, 100));
      const created = document.querySelector('.react-flow__node.selected');
      const after = created.getBoundingClientRect();
      return { offsetX: after.x - before.x, offsetY: after.y - before.y, onTop: Number(getComputedStyle(created).zIndex) > zBefore, differentNode: created !== original };
    })()`);
    assert.equal(placement.offsetX, 48);
    assert.equal(placement.offsetY, 48);
    assert(placement.onTop && placement.differentNode);
    // 制造三节点连线，直接复现大卡片折叠后锚点悬空的问题。
    await window.webContents.executeJavaScript(`(() => {
      window.dispatchEvent(new Event('beforeunload'));
      const key = 'caudalflow-workspace-' + JSON.parse(localStorage.getItem('caudalflow-workspaces')).state.activeWorkspaceId;
      const data = JSON.parse(localStorage.getItem(key));
      const root = data.nodes[0];
      const middle = data.nodes[1];
      root.position = { x: 40, y: 130 }; root.style = { width: 460, height: 600 };
      middle.position = { x: 600, y: 150 }; middle.style = { width: 800, height: 500 }; middle.data.topic = '折叠与连线验证';
      const end = { id: 'smoke-end', type: 'chat', position: { x: 1060, y: 180 }, data: { topic: '末尾节点' }, style: { width: 340, height: 500 } };
      data.nodes.push(end);
      data.edges = [{ id: 'smoke-in', source: root.id, target: middle.id }, { id: 'smoke-out', source: middle.id, target: end.id }].map(edge => ({ ...edge, sourceHandle: 'right', targetHandle: 'left', type: 'topic', data: { label: '' } }));
      data.conversations[end.id] = { nodeId: end.id, messages: [], isStreaming: false };
      localStorage.setItem(key, JSON.stringify(data));
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function(name, value) { if (name !== key) write.call(this, name, value); };
      return middle.id;
    })()`);
    let fixturesLoaded = once(window.webContents, 'did-finish-load');
    window.webContents.reload(); await fixturesLoaded;
    await waitFor(window, "document.querySelectorAll('.react-flow__node').length === 3");
    await window.webContents.executeJavaScript("[...document.querySelectorAll('.react-flow__node')].find(node => node.innerText.includes('折叠与连线验证')).querySelector('button[title=\"关闭\"]').click()");
    await delay(400);
    const compact = await window.webContents.executeJavaScript(`(() => {
      const node = [...document.querySelectorAll('.react-flow__node')].find(node => node.innerText.includes('折叠与连线验证'));
      const handles = [...node.querySelectorAll('.react-flow__handle')].map(handle => { const r = handle.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      const incoming = document.querySelector('[data-id="smoke-in"] path.react-flow__edge-path').getAttribute('d').match(/-?\\d*\\.?\\d+/g).map(Number);
      const outgoing = document.querySelector('[data-id="smoke-out"] path.react-flow__edge-path').getAttribute('d').match(/-?\\d*\\.?\\d+/g).map(Number);
      const canvas = document.querySelector('.react-flow').getBoundingClientRect();
      return { width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, incomingError: Math.abs(incoming.at(-1) + canvas.top - handles[0].y), outgoingError: Math.abs(outgoing[1] + canvas.top - handles[1].y) };
    })()`);
    assert.equal(compact.width, 260); assert.equal(compact.height, 148);
    assert(compact.incomingError < 2 && compact.outgoingError < 2, JSON.stringify(compact));
    // 选区跨越提问和回复时只能出现选区菜单；清除选区后才出现消息操作。
    const menus = await window.webContents.executeJavaScript(`(async () => {
      const messages = document.querySelectorAll('[data-message-id]');
      const range = document.createRange(); range.setStart(messages[0], 0); range.setEnd(messages[1], messages[1].childNodes.length);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
      messages[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 250 }));
      await new Promise(resolve => setTimeout(resolve, 50));
      const selectionOnly = document.querySelector('[role="menu"]').innerText.includes('从选区分支追问') && !document.querySelector('[role="menu"]').innerText.includes('删除这条消息');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); window.getSelection().removeAllRanges();
      await new Promise(resolve => setTimeout(resolve, 50));
      messages[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 250 }));
      await new Promise(resolve => setTimeout(resolve, 50));
      const messageOnly = document.querySelector('[role="menu"]').innerText.includes('重新回答这个问题') && !document.querySelector('[role="menu"]').innerText.includes('从选区分支追问');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { selectionOnly, messageOnly };
    })()`);
    assert(menus.selectionOnly && menus.messageOnly);
    const restored = await window.webContents.executeJavaScript(`(async () => {
      const middle = [...document.querySelectorAll('.react-flow__node')].find(node => node.innerText.includes('折叠与连线验证'));
      const original = middle.getBoundingClientRect();
      middle.querySelector('button[title="展开"]').click(); await new Promise(resolve => setTimeout(resolve, 200));
      const width = middle.getBoundingClientRect().width;
      middle.querySelector('button[title="关闭"]').click(); await new Promise(resolve => setTimeout(resolve, 200));
      const minimizedWidth = middle.getBoundingClientRect().width;
      const minimizedHeight = middle.getBoundingClientRect().height;
      let positionStable = true;
      for (let i = 0; i < 3; i++) {
        middle.querySelector('button[title="展开"]').click(); await new Promise(resolve => setTimeout(resolve, 100));
        const expanded = middle.getBoundingClientRect();
        positionStable = positionStable && expanded.x === original.x && expanded.y === original.y;
        middle.querySelector('button[title="关闭"]').click(); await new Promise(resolve => setTimeout(resolve, 100));
        const compact = middle.getBoundingClientRect();
        positionStable = positionStable && compact.x === original.x && compact.y === original.y;
      }
      return { restoredWidth: width, minimizedWidth, minimizedHeight, positionStable };
    })()`);
    assert.equal(restored.restoredWidth, 800);
    assert.equal(restored.minimizedWidth, 260); assert.equal(restored.minimizedHeight, 148);
    assert(restored.positionStable, 'Small/medium card transitions moved the top-left corner');
    // 最大化覆盖软件内容区，但节点几何和原有画布视野必须保持原样。
    const fullscreen = await window.webContents.executeJavaScript(`(async () => {
      const viewport = document.querySelector('.react-flow__viewport').style.transform;
      const node = document.querySelector('.react-flow__node');
      const geometry = node.style.transform;
      node.querySelector('button[title="最大化"]').click(); await new Promise(resolve => setTimeout(resolve, 100));
      const overlay = document.querySelector('[data-maximized-conversation]');
      const rect = overlay.getBoundingClientRect();
      const fillsWindow = rect.width === innerWidth && rect.height === innerHeight && rect.x === 0 && rect.y === 0;
      overlay.querySelector('button[title="恢复大小"]').click(); await new Promise(resolve => setTimeout(resolve, 100));
      return { fillsWindow, restored: !document.querySelector('[data-maximized-conversation]'), viewportUnchanged: viewport === document.querySelector('.react-flow__viewport').style.transform, geometryUnchanged: geometry === node.style.transform };
    })()`);
    assert(fullscreen.fillsWindow && fullscreen.restored && fullscreen.viewportUnchanged && fullscreen.geometryUnchanged);
    const compactId = await window.webContents.executeJavaScript("[...document.querySelectorAll('.react-flow__node')].find(node => node.innerText.includes('折叠与连线验证')).dataset.id");
    await clickElement(window, `.react-flow__node[data-id="${compactId}"] button[title="展开"]`);
    await clickElement(window, `.react-flow__node[data-id="${compactId}"] button[title="关闭"]`);
    // 模拟切换视图时漏掉修饰键释放，下一次普通点击必须自行恢复单选。
    await window.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true, bubbles: true }))");
    await delay(50);
    for (const selector of ['.react-flow__node[data-id="smoke-end"] [class*="font-semibold"]', '.react-flow__node [class*="font-semibold"]', `.react-flow__node[data-id="${compactId}"] [class*="font-semibold"]`]) {
      await clickElement(window, selector);
      const selectionCount = await window.webContents.executeJavaScript("document.querySelectorAll('.react-flow__node.selected').length");
      assert.equal(selectionCount, 1, 'Ordinary clicks accumulated selection after compact expand and close');
    }
    await window.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft', bubbles: true }))");
    await clickElement(window, '.react-flow__node button[title="最大化"]');
    await waitFor(window, "!!document.querySelector('[data-maximized-conversation]')");
    await clickElement(window, '[data-maximized-conversation] button[title="恢复大小"]');
    await waitFor(window, "!document.querySelector('[data-maximized-conversation]')");
    for (const selector of ['.react-flow__node[data-id="smoke-end"] [class*="font-semibold"]', '.react-flow__node [class*="font-semibold"]', '.react-flow__node[data-id="smoke-end"] [class*="font-semibold"]', '.react-flow__node [data-message-id]']) {
      await clickElement(window, selector);
      const selectionCount = await window.webContents.executeJavaScript("document.querySelectorAll('.react-flow__node.selected').length");
      assert.equal(selectionCount, 1, 'Ordinary clicks accumulated node selection after fullscreen restore');
    }
    const resizePoint = await window.webContents.executeJavaScript(`(() => {
      const rect = document.querySelector('.react-flow__node.selected .react-flow__resize-control.bottom.right').getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    })()`);
    for (const amount of [30, -30]) {
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...resizePoint });
      window.webContents.sendInputEvent({ type: 'mouseMove', x: resizePoint.x + amount, y: resizePoint.y + amount });
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: resizePoint.x + amount, y: resizePoint.y + amount });
      resizePoint.x += amount; resizePoint.y += amount;
      await delay(100);
    }
    await clickElement(window, '.react-flow__node[data-id="smoke-end"] [class*="font-semibold"]');
    assert.equal(await window.webContents.executeJavaScript("document.querySelectorAll('.react-flow__node.selected').length"), 1, 'Resize left additive selection active');
    const independentPanels = await window.webContents.executeJavaScript(`(async () => {
      const node = document.querySelector('.react-flow__node');
      const viewport = document.querySelector('.react-flow__viewport');
      const savedTransform = viewport.style.transform;
      viewport.style.transform = 'translate(0px, 0px) scale(0.35)';
      const openItem = async (text) => {
        node.querySelector('button[title="卡片菜单"]').click(); await new Promise(resolve => setTimeout(resolve, 50));
        [...node.querySelectorAll('[role="menuitem"]')].find(button => button.textContent === text).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 300, clientY: 200 }));
        await new Promise(resolve => setTimeout(resolve, 50));
      };
      await openItem('删除对话');
      const deletion = document.querySelector('[data-floating-node-panel] [role="dialog"]');
      const deleteRect = deletion.getBoundingClientRect();
      const deleteIndependent = !viewport.contains(deletion) && deleteRect.width === 360 && deleteRect.x === 308 && deleteRect.y === 208 && getComputedStyle(deletion.querySelector('#delete-chat-node-title')).fontSize === '18px';
      [...deletion.querySelectorAll('button')].find(button => button.textContent === '取消').click(); await new Promise(resolve => setTimeout(resolve, 50));
      await openItem('添加标签和颜色');
      const labels = document.querySelector('[data-floating-node-panel] [role="dialog"]');
      const labelRect = labels.getBoundingClientRect();
      const labelIndependent = !viewport.contains(labels) && labelRect.width === 360 && labelRect.x === 308 && labelRect.y === 208 && getComputedStyle(labels.querySelector('input')).fontSize === '16px';
      [...labels.querySelectorAll('button')].find(button => button.textContent === '关闭').click();
      viewport.style.transform = savedTransform;
      return { deleteIndependent, labelIndependent };
    })()`);
    assert(independentPanels.deleteIndependent && independentPanels.labelIndependent);
    const promptManager = await window.webContents.executeJavaScript(`(async () => {
      const openMenu = async () => {
        const message = document.querySelector('[data-message-id]');
        const range = document.createRange(); range.selectNodeContents(message);
        window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
        message.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 250 }));
        await new Promise(resolve => setTimeout(resolve, 50));
        [...document.querySelectorAll('[role="menuitem"]')].find(button => button.textContent.includes('用 prompt 追问选区')).click();
        await new Promise(resolve => setTimeout(resolve, 50));
      };
      await openMenu();
      const noAutomaticCopyFocus = document.activeElement.hasAttribute('data-message-menu');
      [...document.querySelectorAll('[role="menuitem"]')].find(button => button.textContent === '管理 prompt').click();
      await new Promise(resolve => setTimeout(resolve, 50));
      const panel = document.querySelector('[role="dialog"][aria-label="管理 prompt"]');
      const name = panel.querySelector('input');
      const content = panel.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, '桌面预设验证');
      name.dispatchEvent(new Event('input', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(content, '保留例子总结选区');
      content.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 50));
      [...panel.querySelectorAll('button')].find(button => button.textContent === '保存').click();
      await new Promise(resolve => setTimeout(resolve, 50));
      const persisted = JSON.parse(localStorage.getItem('caudalflow-settings')).state.promptPresets.some(preset => preset.name === '桌面预设验证');
      [...panel.querySelectorAll('button')].find(button => button.textContent === '关闭').click();
      await new Promise(resolve => setTimeout(resolve, 50));
      await openMenu();
      const presetInMenu = [...document.querySelectorAll('[role="menuitem"]')].some(button => button.textContent === '桌面预设验证');
      const managerAlwaysPresent = [...document.querySelectorAll('[role="menuitem"]')].some(button => button.textContent === '管理 prompt');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { noAutomaticCopyFocus, persisted, presetInMenu, managerAlwaysPresent };
    })()`);
    assert(promptManager.noAutomaticCopyFocus && promptManager.persisted && promptManager.presetInMenu && promptManager.managerAlwaysPresent);
    const drag = async (x, y) => {
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'middle', x, y, clickCount: 1 });
      await delay(50);
      window.webContents.sendInputEvent({ type: 'mouseMove', button: 'middle', x: x + 70, y: y + 50 });
      await delay(100);
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'middle', x: x + 70, y: y + 50, clickCount: 1 });
      await delay(100);
    };
    const beforeCardDrag = await window.webContents.executeJavaScript("document.querySelector('.react-flow__viewport').style.transform");
    const cardPoint = await window.webContents.executeJavaScript("(() => { const rect = document.querySelector('.react-flow__node').getBoundingClientRect(); return { x: Math.round(rect.x + 80), y: Math.round(rect.y + 180) }; })()");
    await drag(cardPoint.x, cardPoint.y);
    assert.equal(await window.webContents.executeJavaScript("document.querySelector('.react-flow__viewport').style.transform"), beforeCardDrag);
    await drag(900, 700);
    assert.notEqual(await window.webContents.executeJavaScript("document.querySelector('.react-flow__viewport').style.transform"), beforeCardDrag);
    await window.webContents.executeJavaScript("document.querySelector('.react-flow__node button[title=\"最大化\"]').click()");
    await waitFor(window, "!!document.querySelector('[data-maximized-conversation]')");
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'W', modifiers: ['control'] });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'W', modifiers: ['control'] });
    await waitFor(window, "!document.querySelector('[data-maximized-conversation]')");
    assert(!window.isDestroyed());
    const keyboardClose = await window.webContents.executeJavaScript("(() => { const node = document.querySelector('.react-flow__node'); return { width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }; })()");
    assert.equal(keyboardClose.width, 260); assert.equal(keyboardClose.height, 148);
    await window.webContents.executeJavaScript("document.querySelector('.react-flow__node button[title=\"展开\"]').click()");
    await delay(100);
    // 立即刷新，验证最后一秒的回复也被关闭前保存处理保留下来。
    loaded = once(window.webContents, 'did-finish-load');
    window.webContents.reload();
    await loaded;
    await waitFor(window, "document.body.innerText.includes('桌面流式回复成功')");
    // 混合小卡片和中卡片反复排列，再刷新确认坐标、连线和对话均保留。
    const arranged = await window.webContents.executeJavaScript(`(async () => {
      for (let pass = 0; pass < 3; pass++) {
        document.querySelector('svg.lucide-network').closest('button').click();
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      window.dispatchEvent(new Event('beforeunload'));
      const key = 'caudalflow-workspace-' + JSON.parse(localStorage.getItem('caudalflow-workspaces')).state.activeWorkspaceId;
      const data = JSON.parse(localStorage.getItem(key));
      const rects = [...document.querySelectorAll('.react-flow__node')].map(node => node.getBoundingClientRect());
      const overlap = rects.some((a, i) => rects.slice(i + 1).some(b => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom));
      const paths = [...document.querySelectorAll('path.react-flow__edge-path')];
      return { positions: data.nodes.map(node => node.position), compact: data.nodes.some(node => node.data.minimized || node.data.collapsed),
        expanded: data.nodes.some(node => !node.data.minimized && !node.data.collapsed), overlap,
        edgesValid: paths.length === data.edges.length && paths.length === 2 && paths.every(path => !/NaN|Infinity/.test(path.getAttribute('d'))),
        busy: document.querySelector('.react-flow').classList.contains('auto-arranging') };
    })()`);
    assert(arranged.compact && arranged.expanded && !arranged.overlap && arranged.edgesValid && !arranged.busy, JSON.stringify(arranged));
    assert(arranged.positions.every(position => Number.isFinite(position.x) && Number.isFinite(position.y)));
    loaded = once(window.webContents, 'did-finish-load');
    window.webContents.reload(); await loaded;
    await waitFor(window, "document.querySelectorAll('path.react-flow__edge-path').length === 2");
    const reloadedPositions = await window.webContents.executeJavaScript(`(() => {
      window.dispatchEvent(new Event('beforeunload'));
      const key = 'caudalflow-workspace-' + JSON.parse(localStorage.getItem('caudalflow-workspaces')).state.activeWorkspaceId;
      return JSON.parse(localStorage.getItem(key)).nodes.map(node => node.position);
    })()`);
    assert.deepEqual(reloadedPositions, arranged.positions);
    // 重载会恢复默认视野，先居中，避免工具栏遮住左上角卡片的菜单按钮。
    await window.webContents.executeJavaScript("document.querySelector('svg.lucide-maximize').closest('button').click()");
    await delay(300);
    // 搞定标记在大小卡片间保留，刷新和导出可恢复，取消标记不能展开或移动卡片。
    const doneId = await window.webContents.executeJavaScript("document.querySelector('.react-flow__node button[title=\"卡片菜单\"]').closest('.react-flow__node').dataset.id");
    await clickElement(window, `.react-flow__node[data-id="${doneId}"] button[title="卡片菜单"]`);
    await clickElement(window, '[role="menu"] button:first-child');
    assert(await window.webContents.executeJavaScript(`!!document.querySelector('.react-flow__node[data-id="${doneId}"] [data-conversation-done]')`));
    await clickElement(window, `.react-flow__node[data-id="${doneId}"] button[title="关闭"]`);
    assert(await window.webContents.executeJavaScript(`!!document.querySelector('.react-flow__node[data-id="${doneId}"] button[data-conversation-done]')`));
    await window.webContents.executeJavaScript("window.dispatchEvent(new Event('beforeunload'))");
    loaded = once(window.webContents, 'did-finish-load');
    window.webContents.reload(); await loaded;
    await waitFor(window, `!!document.querySelector('.react-flow__node[data-id="${doneId}"] button[data-conversation-done]')`);
    await window.webContents.executeJavaScript("document.querySelector('svg.lucide-maximize').closest('button').click()");
    await delay(300);
    await clickElement(window, `.react-flow__node[data-id="${doneId}"] button[title="取消搞定标记"]`);
    assert(await window.webContents.executeJavaScript(`!document.querySelector('.react-flow__node[data-id="${doneId}"] [data-conversation-done]') && !!document.querySelector('.react-flow__node[data-id="${doneId}"] button[title="展开"]')`));
    await clickElement(window, `.react-flow__node[data-id="${doneId}"] button[title="标记为已搞定"]`);
    await window.webContents.executeJavaScript("window.dispatchEvent(new Event('beforeunload'))");
    const exportPath = path.join(app.getPath('userData'), 'desktop-smoke-workspace.json');
    const downloaded = new Promise((resolve, reject) => {
      window.webContents.session.once('will-download', (_event, item) => {
        item.setSavePath(exportPath);
        item.once('done', (_done, state) => state === 'completed' ? resolve() : reject(new Error(`Export ${state}`)));
      });
    });
    await window.webContents.executeJavaScript("document.querySelector('svg.lucide-download').closest('button').click()");
    await downloaded;
    const exported = JSON.parse(await fs.readFile(exportPath, 'utf8'));
    assert.equal(exported.type, 'caudalflow-workspace');
    assert.equal(exported.data.nodes.find(node => node.id === doneId).data.done, true);
    assert.deepEqual(exported.data.nodes.map(node => node.position), arranged.positions);
    const image = await window.webContents.capturePage();
    const screenshot = path.join(app.getPath('userData'), 'desktop-smoke.png');
    await fs.writeFile(screenshot, image.toPNG());
    console.log(JSON.stringify({ desktopSmoke: 'passed', packaged: app.isPackaged, storage: app.getPath('userData'), screenshot, checks: ['bundled UI', 'streaming API without CORS', 'reasoning display', 'new conversation placement and stacking', 'compact node handles and edges', 'restore and minimize dimensions', 'fullscreen conversation and restore', 'selection and message menus', 'prompt manager and preset submenu', 'settings persistence', 'workspace persistence on reload', 'JSON export'] }));
    clearTimeout(timeout);
    server.close();
    await window.webContents.session.flushStorageData();
    app.exit(0);
  } catch (error) {
    console.error(error);
    clearTimeout(timeout);
    server.close();
    app.exit(1);
  }
}

module.exports = { runSmokeTest };
