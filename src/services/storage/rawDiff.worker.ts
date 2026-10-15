import { computeRawDiff } from './rawDiff';

// 差异计算离开界面线程；关闭或切换文档时可直接终止对应工作线程。
self.onmessage = (event: MessageEvent<{ before: string; after: string }>) => {
  self.postMessage(computeRawDiff(event.data.before, event.data.after));
};
