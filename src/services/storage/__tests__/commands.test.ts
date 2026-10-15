import { describe, expect, it } from 'vitest';
import type { WorkspaceData } from '../../../types/workspace';
import { createContentHistory } from '../commands';

function state(content = '回答'): WorkspaceData {
  return { nodes: [{ id: 'c1', type: 'chat', position: { x: 0, y: 0 }, data: { topic: '主题' } }], edges: [], conversations: { c1: { nodeId: 'c1', messages: [{ id: 'a1', role: 'assistant', timestamp: 1, content }], isStreaming: false } } };
}

describe('content command history', () => {
  it('merges only an adjacent empty creation with its first question and replays the saved question', () => {
    const history = createContentHistory();
    const empty: WorkspaceData = { nodes: [], edges: [], conversations: {} };
    const created = state(); created.conversations.c1.messages = [];
    history.record(empty, created, '创建会话或分支');
    const asked = structuredClone(created); asked.nodes[0].data.topic = '临时题目';
    asked.conversations.c1.messages.push({ id: 'q1', role: 'user', content: '首次提问', timestamp: 1 });
    history.record(created, asked, '首次提问', 'c1');
    expect(history.mergedCreationId).toBe('c1');
    const undone = history.undo(asked)!;
    expect(undone.data.nodes).toHaveLength(0); expect(history.canUndo).toBe(false);
    const redone = history.redo(undone.data)!;
    expect(redone.data.conversations.c1.messages[0].content).toBe('首次提问');
  });

  it('keeps creation separate when another content operation intervenes', () => {
    const history = createContentHistory(); const empty: WorkspaceData = { nodes: [], edges: [], conversations: {} };
    const created = state(); created.conversations.c1.messages = [];
    history.record(empty, created, '创建会话或分支');
    const renamed = structuredClone(created); renamed.nodes[0].data.label = '先修改标签';
    history.record(created, renamed, '修改会话标签');
    const asked = structuredClone(renamed); asked.conversations.c1.messages.push({ id: 'q1', role: 'user', content: '首次提问', timestamp: 1 });
    history.record(renamed, asked, '首次提问', 'c1');
    expect(history.mergedCreationId).toBeUndefined();
    expect(history.undo(asked)!.data.nodes).toHaveLength(1);
  });

  it('retains branch relationships through a merged creation undo and redo', () => {
    const history = createContentHistory(); const parent = state();
    const branch = structuredClone(parent);
    branch.nodes.push({ id: 'child', type: 'chat', position: { x: 500, y: 0 }, data: { topic: '分支', parentNodeId: 'c1' } });
    branch.conversations.child = { nodeId: 'child', messages: [], isStreaming: false };
    branch.edges.push({ id: 'edge', source: 'c1', target: 'child', data: { label: '追问' } });
    history.record(parent, branch, '创建会话或分支');
    const asked = structuredClone(branch); asked.conversations.child.messages.push({ id: 'q2', role: 'user', content: '为什么？', timestamp: 2 });
    history.record(branch, asked, '首次提问', 'child');
    expect(history.mergedCreationId).toBe('child');
    const undone = history.undo(asked)!.data;
    expect(undone.nodes.map((node) => node.id)).toEqual(['c1']); expect(undone.edges).toHaveLength(0);
    const redone = history.redo(undone)!.data;
    expect(redone.edges).toEqual(branch.edges); expect(redone.conversations.child.messages[0].content).toBe('为什么？');
  });
  it('ignores layout, size, selection and collapse changes', () => {
    const history = createContentHistory(); const a = state(); const b = state();
    b.nodes[0].position.x = 100; b.nodes[0].style = { width: 800 }; b.nodes[0].selected = true; b.nodes[0].data.collapsed = true;
    expect(history.record(a, b)).toBe(false); expect(history.canUndo).toBe(false);
  });
  it('undoes content while retaining newer layout and redoes saved text', () => {
    const history = createContentHistory(); history.record(state('旧'), state('新'));
    const current = state('新'); current.nodes[0].position = { x: 800, y: 600 };
    const undone = history.undo(current)!;
    expect(undone.data.conversations.c1.messages[0].content).toBe('旧');
    expect(undone.data.nodes[0].position).toEqual({ x: 800, y: 600 });
    expect(history.redo(undone.data)!.data.conversations.c1.messages[0].content).toBe('新');
  });
  it('restores deleted conversations, messages and relationships as one operation', () => {
    const history = createContentHistory(); const original = state();
    original.nodes.push({ id: 'c2', type: 'chat', position: { x: 10, y: 10 }, data: { topic: '子分支', parentNodeId: 'c1' } });
    original.edges.push({ id: 'e1', source: 'c1', target: 'c2', data: { label: '分支' } });
    const removed: WorkspaceData = { nodes: [original.nodes[1]], edges: [], conversations: {} };
    history.record(original, removed);
    const restored = history.undo(removed)!.data;
    expect(restored.nodes).toHaveLength(2); expect(restored.edges).toHaveLength(1);
    expect(restored.conversations.c1.messages[0].content).toBe('回答');
  });
  it('records labels and done state and clears redo after a new content operation', () => {
    const history = createContentHistory(); const next = state(); next.nodes[0].data.label = '标签'; next.nodes[0].data.done = true;
    history.record(state(), next); const previous = history.undo(next)!.data;
    expect(previous.nodes[0].data.label).toBeUndefined(); expect(previous.nodes[0].data.done).toBeUndefined();
    expect(history.canRedo).toBe(true); history.record(previous, state('另一个修改')); expect(history.canRedo).toBe(false);
    history.clear(); expect(history.canUndo).toBe(false);
  });
});
