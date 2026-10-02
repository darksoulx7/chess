import { describe, expect, it } from 'vitest';
import { normalizeApiUrl } from './config';

describe('normalizeApiUrl', () => {
  it('strips trailing slashes', () => {
    expect(normalizeApiUrl('https://api.example.com//')).toBe('https://api.example.com');
  });
  it('throws when unset', () => {
    expect(() => normalizeApiUrl(undefined)).toThrow(/EXPO_PUBLIC_API_URL/);
  });
});
