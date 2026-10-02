import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

/** Serves a static export with SPA fallback to index.html (mirrors the Vercel rewrite). */
export function serveStatic(root: string, port: number): Promise<Server> {
  const server = createServer(async (req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    try {
      const file = join(root, safe);
      if (!file.startsWith(root)) throw new Error('outside root');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      const body = await readFile(join(root, 'index.html'));
      res.writeHead(200, { 'content-type': TYPES['.html'] as string });
      res.end(body);
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
