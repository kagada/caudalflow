const operations = new Set(['load', 'save', 'readRevision', 'referenceCacheGet', 'referenceCachePut', 'listHistory', 'readHistory', 'restoreHistory', 'listVersions', 'readVersion', 'rename', 'exportTo', 'clearHistory', 'close']);

// 队列覆盖整次业务操作，包括保存前读取；内部相互调用不重复入队，避免事务交错或死锁。
export function serializeWorkspace(workspace) {
  let tail = Promise.resolve();
  let closed = false;
  const methods = new Map();
  return new Proxy(workspace, {
    get(target, key) {
      if (!operations.has(key)) return Reflect.get(target, key, target);
      if (!methods.has(key)) methods.set(key, (...args) => {
        const result = tail.then(async () => {
          if (closed) throw new Error('工作区已关闭');
          if (target.broken && key !== 'close') throw new Error('事务回滚失败，请关闭并重新打开工作区');
          const value = await target[key](...args);
          if (key === 'close') closed = true;
          return value;
        });
        tail = result.catch(() => {});
        return result;
      });
      return methods.get(key);
    },
  });
}
