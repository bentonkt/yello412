// Builds the site into ./dist.
//
//   node scripts/build.mjs          build
//   node scripts/build.mjs --prod   build, and warn loudly about anything not ready to ship
//
// Templates in src/*.html can use:
//   {{key}}                       a value from site.config.json (or a derived value below)
//   {{asset:path}}                /path?v=<content hash>, so browsers re-download changed files
//   <!--include:name-->           src/partials/name.html
//   <!--if:key--> … <!--else--> … <!--/if-->   (no nesting)

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as bundle } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const out = join(root, 'dist');
const prod = process.argv.includes('--prod');

const config = JSON.parse(readFileSync(join(root, 'site.config.json'), 'utf8'));

// ---------- derived values ----------

function e164(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) throw new Error(`Not a 10-digit US number: "${raw}"`);
  return '+1' + ten;
}
function pretty(num) {
  const d = num.slice(2);
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

const demo = e164(config.demoNumber);
const cell = e164(config.contactCell);
const partner = e164(config.partnerCell);
const siteUrl = String(config.siteUrl).replace(/\/$/, '');

const values = {
  ...config,
  siteUrl,
  siteHost: siteUrl.replace(/^https?:\/\//, ''),
  demoNumber: demo ? pretty(demo) : '',
  demoTel: demo,
  contactCell: pretty(cell),
  contactTel: cell,
  partnerCell: pretty(partner),
  partnerTel: partner,
  year: String(new Date().getFullYear()),
  firstChargeDay: String(Number(config.trialDays) + 1),
};

const warnings = [];
if (!demo) warnings.push('demoNumber is empty in site.config.json: the demo section says the line goes live soon and points people to your cell.');
const notes = [];
if (!config.cloudflareAnalyticsToken) notes.push('cloudflareAnalyticsToken is empty, so visits are not tracked (optional).');

// ---------- assets ----------

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const staticDirs = ['fonts', 'img'];
const staticFiles = ['styles.css', 'main.js'];
for (const d of staticDirs) cpSync(join(src, d), join(out, d), { recursive: true });
for (const f of staticFiles) cpSync(join(src, f), join(out, f));

// The 3D scene (src/scene/*.js plus three.js) is bundled into one file that the
// home page loads only on browsers that can draw it.
await bundle({
  entryPoints: [join(src, 'scene', 'index.js')],
  outfile: join(out, 'scene.js'),
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2020'],
  legalComments: 'eof',
  logLevel: 'warning',
});

function hashOf(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 10);
}
function assetUrl(path) {
  const file = join(out, path);
  if (!existsSync(file)) throw new Error(`{{asset:${path}}} points at a missing file`);
  return `/${path}?v=${hashOf(file)}`;
}

// ---------- templating ----------

function render(name) {
  let html = readFileSync(join(src, name), 'utf8');

  html = html.replace(/<!--include:([\w-]+)-->/g, (_, part) =>
    readFileSync(join(src, 'partials', `${part}.html`), 'utf8').trim());

  html = html.replace(/<!--if:(\w+)-->([\s\S]*?)(?:<!--else-->([\s\S]*?))?<!--\/if-->/g,
    (_, key, yes, no = '') => (values[key] ? yes : no));

  html = html.replace(/\{\{asset:([^}]+)\}\}/g, (_, path) => assetUrl(path.trim()));

  html = html.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in values)) throw new Error(`${name}: unknown template key {{${key}}}`);
    return escapeHtml(String(values[key]));
  });
  return html;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const pages = { 'index.html': 'index.html', 'privacy.html': 'privacy.html', '404.html': '404.html' };
const inlineScripts = new Set();
for (const [from, to] of Object.entries(pages)) {
  const html = render(from);
  // Collect inline <script> bodies (not JSON-LD) so the CSP can allow exactly those.
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)) {
    inlineScripts.add(m[1]);
  }
  writeFileSync(join(out, to), html);
}

// ---------- robots, sitemap, headers ----------

writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);

const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${siteUrl}/</loc><lastmod>${today}</lastmod></url>
  <url><loc>${siteUrl}/privacy</loc><lastmod>${today}</lastmod></url>
</urlset>
`);

const scriptHashes = [...inlineScripts].map((s) =>
  `'sha256-${createHash('sha256').update(s).digest('base64')}'`);
const analytics = Boolean(config.cloudflareAnalyticsToken);
const csp = [
  "default-src 'self'",
  `script-src 'self' ${scriptHashes.join(' ')}${analytics ? ' https://static.cloudflareinsights.com' : ''}`,
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  `connect-src 'self'${analytics ? ' https://cloudflareinsights.com' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

writeFileSync(join(out, '_headers'), `/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), geolocation=(), microphone=(self)

/fonts/*
  Cache-Control: public, max-age=31536000, immutable

/img/*
  Cache-Control: public, max-age=604800

/styles.css
  Cache-Control: public, max-age=31536000, immutable

/main.js
  Cache-Control: public, max-age=31536000, immutable

/scene.js
  Cache-Control: public, max-age=31536000, immutable
`);

// ---------- report ----------

function sizeOf(dir) {
  let total = 0;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    total += statSync(p).isDirectory() ? sizeOf(p) : statSync(p).size;
  }
  return total;
}
console.log(`Built ${relative(root, out)}/ (${(sizeOf(out) / 1024).toFixed(0)} KB)`);
for (const w of warnings) console.warn(`${prod ? '⚠ NOT READY: ' : 'note: '}${w}`);
for (const n of notes) console.log(`note: ${n}`);
