import { useModelStore } from '../../stores/modelStore';
/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateTitle } from '../llm';
import { cancelAllGenerations } from '../streamLifecycle';

const provider = vi.hoisted(() => ({ streamChat: vi.fn() }));
vi.mock('../providers/registry', () => ({ getProvider: () => provider }));
vi.mock('../../stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ llmConfig: { providerId: 'test', maxTokens: 2048 } }) } }));
beforeEach(() => { cancelAllGenerations(); vi.clearAllMocks();
  useModelStore.setState({ providers: [{ id: 'test', name: 'Test', endpoint: 'https://example.test', apiKey: 'test-key', enabled: true, models: [{ id: 'test', name: 'Test', enabled: true }] }], defaultModel: { providerId: 'test', providerName: 'Test', modelId: 'test' } });
});

describe('background title request lifecycle', () => {
  it('cleans one-line titles and leaves the configured answer token limit unchanged', () => {
    const callback = vi.fn(); generateTitle('怎么命名？', '上下文', callback);
    const [messages, config, callbacks] = provider.streamChat.mock.calls[0];
    expect(messages[1].content).toContain('上下文');
    expect(config.maxTokens).toBe(128);
    expect(config.thinkingMode).toBe('disabled');
    callbacks.onToken('“会话自动命名”\n多余的解释'); callbacks.onDone();
    expect(callback).toHaveBeenCalledWith('会话自动命名');
  });

  it('suppresses a late title after workspace cancellation and silently tolerates errors', () => {
    const callback = vi.fn(); generateTitle('问题', '', callback);
    const [, , callbacks, signal] = provider.streamChat.mock.calls[0];
    cancelAllGenerations(); expect(signal.aborted).toBe(true);
    callbacks.onToken('晚到标题'); callbacks.onDone();
    expect(callback).not.toHaveBeenCalled();
    generateTitle('问题', '', callback);
    provider.streamChat.mock.calls[1][2].onError(new Error('离线'));
    expect(callback).not.toHaveBeenCalled();
  });
});
