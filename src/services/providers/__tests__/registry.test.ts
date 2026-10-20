import { describe, it, expect } from 'vitest';
import { getProvider, listProviders } from '../registry';

describe('provider registry', () => {
  describe('getProvider', () => {
    it('registers Bailian as a separate provider', () => {
      expect(getProvider('bailian')).toMatchObject({ id: 'bailian', name: '阿里云百炼' });
    });
    it('does not register the removed simulated provider', () => { expect(getProvider('mock')).toBeUndefined(); });

    it('returns the openai provider', () => {
      const provider = getProvider('openai');
      expect(provider).toBeDefined();
      expect(provider!.id).toBe('openai');
    });

    it('returns the anthropic provider', () => {
      const provider = getProvider('anthropic');
      expect(provider).toBeDefined();
      expect(provider!.id).toBe('anthropic');
    });

    it('returns undefined for an unknown provider', () => {
      expect(getProvider('unknown-provider')).toBeUndefined();
    });
  });

  describe('listProviders', () => {
    it('returns an array of all registered providers', () => {
      const providers = listProviders();
      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThanOrEqual(3);
    });

    it('includes real providers without simulated responses', () => {
      const ids = listProviders().map((p) => p.id);
      expect(ids).not.toContain('mock');
      expect(ids).toContain('openai');
      expect(ids).toContain('anthropic');
    });

    it('every provider has id, name, and streamChat', () => {
      for (const provider of listProviders()) {
        expect(typeof provider.id).toBe('string');
        expect(typeof provider.name).toBe('string');
        expect(typeof provider.streamChat).toBe('function');
      }
    });
  });
});
