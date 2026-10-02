/**
 * Expo inlines `process.env.EXPO_PUBLIC_*` at build time only when accessed as a literal
 * member expression, so the read must stay exactly in this form (no destructuring, no
 * dynamic `process.env[...]`).
 */
const BUILD_TIME_API_URL: string | undefined = process.env.EXPO_PUBLIC_API_URL;

export function normalizeApiUrl(url: string | undefined): string {
  if (!url) {
    throw new Error('EXPO_PUBLIC_API_URL is not set');
  }
  return url.replace(/\/+$/, '');
}

export function getApiUrl(): string {
  return normalizeApiUrl(BUILD_TIME_API_URL);
}
