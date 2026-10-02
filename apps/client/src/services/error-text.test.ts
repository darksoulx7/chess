import { describe, expect, it, vi } from 'vitest';

vi.mock('./config', () => ({ getApiUrl: () => 'http://api.test' }));
import { ApiError } from './api';
import { errorText } from './error-text';

describe('errorText', () => {
  it('maps known codes', () => {
    expect(errorText(new ApiError(401, 'invalid_credentials'))).toMatch(/Wrong email/);
    expect(errorText(new ApiError(409, 'email_taken'))).toMatch(/already registered/);
    expect(errorText(new ApiError(0, 'network'))).toMatch(/Cannot reach/);
  });
  it('surfaces server validation messages (object and string forms)', () => {
    expect(
      errorText(
        new ApiError(400, 'invalid_request', {
          issues: [{ path: 'password', message: 'Password must be at least 10 characters.' }],
        }),
      ),
    ).toMatch(/at least 10/);
    expect(
      errorText(new ApiError(400, 'invalid_request', { issues: ['Nothing to update.'] })),
    ).toBe('Nothing to update.');
    expect(
      errorText(new ApiError(400, 'invalid_game', { message: 'Bots do not agree to draws.' })),
    ).toBe('Bots do not agree to draws.');
  });
  it('falls back for unknown errors', () => {
    expect(errorText(new ApiError(500, 'http_500'))).toMatch(/Something went wrong/);
    expect(errorText(new Error('x'), 'custom')).toBe('custom');
    expect(errorText('nope')).toMatch(/Something went wrong/);
  });
});
