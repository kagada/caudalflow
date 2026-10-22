// 两端都以字节存储图片；共用业务不依赖 Node Buffer。
export function decodeBase64(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

export function encodeBase64(value) {
  const bytes = value instanceof Uint8Array ? value : Uint8Array.from(value);
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}

export function utf8Length(value) { return new TextEncoder().encode(value).length; }

// 历史仍按工作区身份命名，保持与已有桌面个人历史文件兼容。
export async function workspaceHistoryKey(id) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
