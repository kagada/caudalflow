/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { UsageStatistics } from '../UsageStatistics';
import type { RequestUsage } from '../../../types/chat';

it('shows reported zero, unknown cache usage and partial sums', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'); const root = createRoot(container);
  const record: RequestUsage = { id: 'r1', purpose: 'answer', providerId: 'custom', model: 'test', createdAt: 1, status: 'complete', inputTokens: 100, outputTokens: 0 };
  try {
    act(() => root.render(<UsageStatistics usage={[record]} label="本会话累计" />));
    expect(container.textContent).toContain('输出 0');
    expect(container.textContent).toContain('缓存命中 未提供');
    act(() => root.render(<UsageStatistics usage={[record, { ...record, id: 'r2', purpose: 'title', inputTokens: undefined }]} label="本会话累计" />));
    expect(container.textContent).toContain('输入 ≥ 100');
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});
