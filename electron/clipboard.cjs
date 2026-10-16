const { clipboard, ClipboardItem } = require('electron');

// Electron 44 使用异步 ClipboardItem[]；必须等待原生提交完成，不能沿用旧对象签名。
function createReferenceClipboard(nativeClipboard = clipboard, Item = ClipboardItem) {
  return {
  async write({ text, html }) {
    await nativeClipboard.write([new Item({
      'text/plain': new Blob([text], { type: 'text/plain' }),
      'text/html': new Blob([html], { type: 'text/html' }),
    })]);
  },
  readText: () => nativeClipboard.readText(),
  };
}

module.exports = { referenceClipboard: createReferenceClipboard(), createReferenceClipboard };
