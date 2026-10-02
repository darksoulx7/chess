import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './auth-helper.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ CORS_ORIGINS: 'https://app.example.com' });
});
afterAll(() => h.close());

const preflight = (
  method: string,
  origin = 'https://app.example.com',
  headers = 'authorization, content-type',
) =>
  h.app.inject({
    method: 'OPTIONS',
    url: '/api/me/preferences',
    headers: {
      origin,
      'access-control-request-method': method,
      'access-control-request-headers': headers,
    },
  });

// A browser blocks any cross-origin PUT/PATCH/DELETE whose preflight does not allow it, so each method the API uses
// must be allowed explicitly (the library default is GET, HEAD, POST only).
describe('CORS preflight', () => {
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])(
    'allows %s from the configured origin',
    async (method) => {
      const res = await preflight(method);
      expect(res.statusCode).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
      expect(res.headers['access-control-allow-methods']).toContain(method);
      expect(res.headers['access-control-allow-headers']?.toString().toLowerCase()).toContain(
        'authorization',
      );
    },
  );

  it('does not allow other origins', async () => {
    const res = await preflight('PUT', 'https://evil.example.org');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('exposes retry-after so clients can honour rate limits', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://app.example.com' },
    });
    expect(res.headers['access-control-expose-headers']).toContain('retry-after');
  });
});
