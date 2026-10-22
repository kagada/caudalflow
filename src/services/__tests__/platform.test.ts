import { describe, expect, it } from 'vitest';
import { detectPlatform } from '../platform';

describe('platform routing for SQLite', () => {
  it.each([
    ['android', 'https:', 'localhost', 'android'],
    ['android', 'app:', 'caudalflow', 'android'],
    ['web', 'app:', 'caudalflow', 'desktop'],
    ['web', 'https:', 'localhost', 'web'],
    ['web', 'app:', 'other-host', 'web'],
    ['ios', 'capacitor:', 'localhost', 'unsupported'],
  ])('routes %s / %s / %s to %s', (nativePlatform, protocol, hostname, expected) => {
    expect(detectPlatform(nativePlatform, protocol, hostname)).toBe(expected);
  });
});
