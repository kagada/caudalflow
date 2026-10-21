import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Plus, Trash2, Download, Upload, Check, Pencil, Github, FileText } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useFlowStore } from '../../stores/flowStore';
import { useChatStore } from '../../stores/chatStore';
import { exportWorkspace, importWorkspace } from '../../hooks/usePersistence';
import { exportMarkdown } from '../../utils/markdownExport';
import { isSqliteStorage } from '../../services/storage/client';
import { createDesktopWorkspace, deleteDesktopWorkspace, openDesktopWorkspace, renameDesktopWorkspace, switchDesktopWorkspace, useStorageStatus } from '../../services/storage/runtime';
import { isAndroid } from '../../services/platform';
import { StorageControls } from './StorageControls';
import { useCancelLayer } from '../../hooks/useCancelLayer';
import { NewWorkspaceDialog } from './NewWorkspaceDialog';

export function WorkspaceSelector() {
  const { t } = useTranslation();
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const editingSession = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useCancelLayer(dropdownOpen, () => setDropdownOpen(false), 50);
  useCancelLayer(editing, () => { editingSession.current = null; setEditing(false); }, 51);

  const active = workspaces.find((w) => w.id === activeWorkspaceId);

  // 画布和卡片会拦截鼠标事件，外部关闭必须先在捕获阶段识别，不能依赖事件冒泡。
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: PointerEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [dropdownOpen]);

  // Focus input when editing starts
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // 标题与下拉菜单必须共用入口，保存目标固定为开始编辑时的工作区。
  const beginEditing = useCallback((id: string) => {
    const workspace = useWorkspaceStore.getState().workspaces.find((item) => item.id === id);
    if (!workspace) return;
    editingSession.current = id;
    setEditValue(workspace.name);
    setEditing(true);
  }, []);

  const startEditing = useCallback(() => {
    if (active) beginEditing(active.id);
  }, [active, beginEditing]);

  const commitRename = useCallback(() => {
    const id = editingSession.current;
    if (!id) return;
    editingSession.current = null;
    const workspace = useWorkspaceStore.getState().workspaces.find((item) => item.id === id);
    const trimmed = (inputRef.current?.value ?? editValue).trim();
    if (workspace && trimmed && trimmed !== workspace.name) {
      if (isSqliteStorage()) void renameDesktopWorkspace(id, trimmed);
      else renameWorkspace(id, trimmed);
    }
    setEditing(false);
  }, [editValue, renameWorkspace]);

  useEffect(() => {
    if (!editing) return;
    // 画布的框选会阻止默认失焦；在捕获阶段识别外部点击，保存不依赖浏览器是否转移焦点。
    const saveOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !inputRef.current?.contains(event.target)) commitRename();
    };
    document.addEventListener('pointerdown', saveOutside, true);
    window.addEventListener('blur', commitRename);
    return () => {
      document.removeEventListener('pointerdown', saveOutside, true);
      window.removeEventListener('blur', commitRename);
    };
  }, [editing, commitRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        commitRename();
      }
    },
    [commitRename]
  );

  const handleSwitch = useCallback(
    (id: string) => {
      if (id !== activeWorkspaceId) {
        if (isSqliteStorage()) void switchDesktopWorkspace(id);
        else switchWorkspace(id);
      }
      setDropdownOpen(false);
    },
    [activeWorkspaceId, switchWorkspace]
  );

  const handleNew = useCallback(() => {
    if (isAndroid()) setShowNewWorkspace(true);
    else if (isSqliteStorage()) void createDesktopWorkspace();
    else createWorkspace();
    setDropdownOpen(false);
  }, [createWorkspace]);

  const handleDelete = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      if (isSqliteStorage()) {
        if (window.confirm('删除工作区会永久删除工作区文件和此设备上的本地历史，无法撤销。确定删除吗？')) void deleteDesktopWorkspace(id);
      } else deleteWorkspace(id);
    },
    [deleteWorkspace]
  );

  const handleRenameFromDropdown = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setDropdownOpen(false);
      // 等切换确实完成后再编辑，避免固定延时误把名称保存到另一个工作区。
      if (id !== activeWorkspaceId) {
        if (isSqliteStorage()) await switchDesktopWorkspace(id);
        else switchWorkspace(id);
      }
      if (useWorkspaceStore.getState().activeWorkspaceId === id) beginEditing(id);
    },
    [activeWorkspaceId, switchWorkspace, beginEditing]
  );

  const handleImport = useCallback(() => {
    if (isSqliteStorage()) void openDesktopWorkspace();
    else fileRef.current?.click();
  }, []);

  const handleExportMarkdown = useCallback(() => {
    const flow = useFlowStore.getState();
    const chat = useChatStore.getState();
    const workspace = useWorkspaceStore.getState().getActiveWorkspace();
    
    // Get selected nodes
    const selectedNodes = flow.nodes.filter(n => n.selected);
    const selectedIds = selectedNodes.length > 0 ? selectedNodes.map(n => n.id) : undefined;
    
    exportMarkdown(
      flow.nodes,
      flow.edges,
      chat.conversations,
      workspace?.name ?? 'CaudalFlow Workspace',
      { selectedNodeIds: selectedIds }
    );
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) importWorkspace(file);
      e.target.value = '';
    },
    []
  );

  return (
    <><div className={`${isAndroid() ? 'min-h-16 flex-wrap gap-y-1 py-1' : 'h-9'} bg-surface-950 border-b border-border flex items-center px-3 shrink-0 select-none`}>
      {/* Left: workspace name + dropdown */}
      <div className={isAndroid() ? 'relative w-full min-w-0' : 'relative'} ref={dropdownRef}>
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            className="bg-surface-900 border border-border-hover rounded px-2 py-0.5 text-sm text-text-primary outline-none focus:border-accent-500 w-48"
          />
        ) : (
          <div className="flex items-center gap-1 group/name">
            <button
              ref={menuButtonRef}
              onClick={() => setDropdownOpen((o) => !o)}
              className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              <span className={`${isAndroid() ? 'max-w-36' : 'max-w-48'} truncate`} title={active?.filePath}>{active?.name ?? t('workspace.defaultName')}</span>
              <ChevronDown size={14} className={`shrink-0 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            <button
              onClick={startEditing}
              className={`${isAndroid() ? 'opacity-100' : 'opacity-0 group-hover/name:opacity-100'} p-0.5 text-text-muted hover:text-text-primary transition-all`}
              title={t('workspace.renameWorkspace')}
            >
              <Pencil size={12} />
            </button>
          </div>
        )}

        {dropdownOpen && (
          <div className="absolute top-full left-0 mt-1 w-64 bg-surface-900 border border-border rounded-lg shadow-xl z-50 overflow-hidden">
            <div className="max-h-60 overflow-y-auto">
              {workspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => handleSwitch(ws.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:bg-surface-800 transition-colors group"
                >
                  <span className="w-4 shrink-0">
                    {ws.id === activeWorkspaceId && <Check size={14} className="text-accent-400" />}
                  </span>
                  <span className="truncate flex-1 text-left">{ws.name}</span>
                  <button
                    onClick={(e) => handleRenameFromDropdown(e, ws.id)}
                    className={`${isAndroid() ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} p-0.5 text-text-muted hover:text-text-primary transition-all`}
                    title={t('workspace.renameWorkspace')}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={(e) => handleDelete(e, ws.id)}
                    className={`${isAndroid() ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} p-0.5 text-text-muted hover:text-red-400 transition-all`}
                    title={t('workspace.deleteWorkspace')}
                  >
                    <Trash2 size={14} />
                  </button>
                </button>
              ))}
            </div>
            <div className="border-t border-border">
              <button
                onClick={handleNew}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-800 transition-colors"
              >
                <Plus size={14} />
                <span>{t('workspace.newWorkspace')}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Spacer */}
      <div className={isAndroid() ? 'hidden' : 'flex-1'} />

      {/* Right: export + import + github */}
      <div className="flex items-center gap-1">
        {isSqliteStorage() && <StorageControls />}
        <button
          onClick={handleExportMarkdown}
          className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
          title={t('workspace.exportMarkdown')}
        >
          <FileText size={15} />
        </button>
        <button
          onClick={exportWorkspace}
          className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
          title={t('workspace.exportWorkspace')}
        >
          <Download size={15} />
        </button>
        <button
          onClick={handleImport}
          className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
          title={t('workspace.importWorkspace')}
        >
          <Upload size={15} />
        </button>
        <a
          href="https://github.com/yancongya/caudalflow"
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
          title={t('workspace.github')}
        >
          <Github size={15} />
        </a>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    </div>
    {showNewWorkspace && <NewWorkspaceDialog onCreate={async (name) => {
      const workspace = await createDesktopWorkspace(name);
      if (!workspace) throw new Error(useStorageStatus.getState().error ?? t('workspace.createFailed'));
    }} onClose={() => { setShowNewWorkspace(false); menuButtonRef.current?.focus(); }} />}
    </>
  );
}
