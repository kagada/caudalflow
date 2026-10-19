import { expect, it } from 'vitest';
import { sortThinkingEfforts, thinkingEffortLabel, thinkingEffortOptions } from '../modelThinking';

it('translates common strength names and preserves unknown names', () => {
  expect(['minimal', 'very-low', 'low', 'medium', 'high', 'xhigh', 'ultra', 'max'].map(thinkingEffortLabel))
    .toEqual(['最低', '很低', '低', '中', '高', '很高', '极高', '最高']);
  expect(['minimum', 'moderate', 'Very High', 'maximum'].map(thinkingEffortLabel)).toEqual(['最低', '中', '很高', '最高']);
  expect(thinkingEffortLabel('vendor-adaptive')).toBe('vendor-adaptive');
});

it('orders recognized strengths, retains raw parameter values and preserves unknown relative order', () => {
  const levels = ['custom-b', 'MAX', 'ultra', 'high', 'medium', 'low', 'minimal', 'custom-a', 'xhigh', 'very-low', 'MAX'];
  expect(sortThinkingEfforts(levels)).toEqual(['minimal', 'very-low', 'low', 'medium', 'high', 'xhigh', 'ultra', 'MAX', 'custom-b', 'custom-a']);
  expect(levels[0]).toBe('custom-b');
  expect(thinkingEffortOptions({ id: 'test', name: 'test', enabled: true, effort: { supportedLevels: ['max', 'high', 'low'] } }))
    .toEqual(['auto', 'none', 'low', 'high', 'max']);
});
