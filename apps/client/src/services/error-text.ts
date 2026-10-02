import { ApiError } from './api';

const TEXT: Record<string, string> = {
  invalid_credentials: 'Wrong email/username or password.',
  too_many_attempts: 'Too many attempts. Wait a few minutes and try again.',
  email_taken: 'That email is already registered.',
  username_taken: 'That username is taken.',
  unauthorized: 'Please sign in again.',
  limit_reached: 'You have reached the limit of saved games. Delete some first.',
  not_found: 'That item no longer exists.',
  network: 'Cannot reach the server. Check your connection.',
  http_429: 'Too many requests. Wait a moment and try again.',
};

/** Human-readable message for an API failure. Validation errors surface the server's first message. */
export function errorText(
  err: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (!(err instanceof ApiError)) return fallback;
  const issues = (err.body as { issues?: Array<{ message?: string } | string> } | null | undefined)
    ?.issues;
  const first = issues?.[0];
  const issue = typeof first === 'string' ? first : first?.message;
  if (err.code === 'invalid_request' && issue) return issue;
  if (err.code === 'invalid_game')
    return (err.body as { message?: string } | null)?.message ?? fallback;
  return TEXT[err.code] ?? fallback;
}
