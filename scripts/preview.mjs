// Serves ./dist on http://localhost:4120 for a quick look (no Cloudflare login needed).
// `npm run dev` runs the real Cloudflare runtime instead, headers included.

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT) || 4120;
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
  '.txt': 'text/plain', '.xml': 'application/xml', '.json': 'application/json',
};

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const clean = normalize(path).replace(/^([/\\])+/, '');
  const candidates = [clean, `${clean}.html`, join(clean, 'index.html')];
  const hit = candidates.map((c) => join(dist, c))
    .find((f) => f.startsWith(dist) && existsSync(f) && statSync(f).isFile());
  const file = hit || join(dist, '404.html');
  res.writeHead(hit ? 200 : 404, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(port, () => console.log(`Preview: http://localhost:${port}`));
