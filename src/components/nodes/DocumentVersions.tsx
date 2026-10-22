import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { listDocumentVersions, selectDocumentVersion } from '../../services/storage/runtime';
import type { DocumentVersion } from '../../services/storage/types';
import { useCancelLayer } from '../../hooks/useCancelLayer';

// 功能版本可直接切换并撤销；这与不可撤销的个人历史恢复是两个入口。
export function DocumentVersions({ nodeId, documentId, close }: { nodeId: string; documentId: string; close: () => void }) {
  useCancelLayer(true, close, 2000);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void listDocumentVersions(documentId).then((items) => { if (active) setVersions(items); }).catch((failure) => { if (active) setError(String(failure)); });
    return () => { active = false; };
  }, [documentId]);
  return createPortal(<div role="dialog" aria-modal="true" aria-label="文档版本" className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-6">
    <div className="max-h-[75vh] w-[560px] overflow-auto rounded-xl border border-border bg-surface-900 p-5 text-text-primary">
      <div className="mb-3 flex justify-between"><h2 className="font-semibold">文档版本</h2><button onClick={close}>关闭</button></div>
      <p className="mb-4 text-sm text-text-secondary">保留当前及最近的旧版本，最多 50 个。切换可撤销，不会重新请求 AI。</p>
      {error && <p role="alert" className="text-red-400">{error}</p>}
      {versions.map((version) => <button key={version.id} className="mb-2 block w-full rounded-lg border border-border p-3 text-left hover:bg-surface-800" onClick={async () => { await selectDocumentVersion(nodeId, documentId, version.id); close(); }}>
        <div className="text-xs text-text-muted">{new Date(version.createdAt).toLocaleString()}</div><div className="line-clamp-3 whitespace-pre-wrap text-sm">{version.preview || '空内容'}</div>
      </button>)}
    </div>
  </div>, document.body);
}
