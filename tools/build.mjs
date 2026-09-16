// Construit le site à partir de src/ :
//   docs/index.html (application complète en UN fichier) + sw.js + manifest + icônes
// Usage : node tools/build.mjs          → docs/ (production, GitHub Pages)
//         node tools/build.mjs --dev    → .dev/site/ (tests locaux, autorise 127.0.0.1)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV = process.argv.includes('--dev');
const OUT = DEV ? path.join(ROOT, '.dev', 'site') : path.join(ROOT, 'docs');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const fail = (msg) => {
  console.error(`\n✖ BUILD ÉCHOUÉ : ${msg}\n`);
  process.exit(1);
};

export const CDN = {
  tailwind: 'https://cdn.tailwindcss.com/3.4.17',
  supabase: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.min.js',
  chart: 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
  jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.2/dist/jszip.min.js',
  qrcode: 'https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.js',
};
export const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap';

// 1. JavaScript : concaténation dans l'ordre des fichiers
const jsDir = path.join(ROOT, 'src', 'js');
const files = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort();
let js = files.map((f) => `/* ==== ${f} ==== */\n${fs.readFileSync(path.join(jsDir, f), 'utf8')}`).join('\n');
const htmlTpl = read('src/index.html');

for (const k of ['jszip', 'qrcode']) if (!js.includes(CDN[k])) fail(`l'adresse ${k} du code ne correspond pas à tools/build.mjs`);
for (const k of ['tailwind', 'supabase', 'chart']) if (!htmlTpl.includes(CDN[k])) fail(`l'adresse ${k} de index.html ne correspond pas à tools/build.mjs`);

// 2. Icônes Lucide : seulement celles utilisées, intégrées au fichier (rapide, marche hors-ligne)
const lucide = require('lucide');
const explicit = new Set();
for (const re of [/icon\(\s*'([A-Za-z0-9]+)'/g, /\b(?:icon|ic):\s*'([A-Za-z0-9]+)'/g, /\b(?:row|item|opt)\(\s*'([A-Z][A-Za-z0-9]+)'/g]) {
  for (const m of js.matchAll(re)) explicit.add(m[1]);
}
const missing = [...explicit].filter((n) => !lucide.icons[n]);
if (missing.length) fail(`icônes inconnues dans Lucide : ${missing.join(', ')}`);
const iconNames = new Set(explicit);
for (const m of js.matchAll(/'([A-Z][A-Za-z0-9]{2,})'/g)) if (lucide.icons[m[1]]) iconNames.add(m[1]);
const icons = Object.fromEntries([...iconNames].sort().map((n) => [n, lucide.icons[n]]));
if (!js.includes('/*@@ICONS@@*/ {}')) fail('marqueur des icônes introuvable');
js = js.replace('/*@@ICONS@@*/ {}', () => JSON.stringify(icons));

// 3. Version = empreinte du contenu (même contenu → même version → pas de fausse mise à jour)
const pkg = JSON.parse(read('package.json'));
const hash = crypto.createHash('sha256')
  .update(js).update(read('src/styles.css')).update(htmlTpl).update(read('src/sw.js')).update(read('src/manifest.webmanifest'))
  .digest('hex').slice(0, 8);
const version = `${pkg.version}-${hash}`;
js = js.replace(/'__APP_VERSION__'/g, () => JSON.stringify(version));
if (/<\/script/i.test(js)) fail('le code contient « </script> », ce qui casserait la page');

// 4. Vérifications : syntaxe, noms jamais définis
fs.mkdirSync(path.join(ROOT, '.dev'), { recursive: true });
const appPath = path.join(ROOT, '.dev', 'app.js');
fs.writeFileSync(appPath, js);
try {
  execFileSync(process.execPath, ['--check', appPath], { stdio: 'pipe' });
} catch (e) {
  fail(`erreur de syntaxe\n${e.stderr}`);
}
try {
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js'), '--no-ignore', '--max-warnings', '0', '.dev/app.js'], { cwd: ROOT, stdio: 'pipe' });
} catch (e) {
  fail(`vérification ESLint\n${e.stdout || ''}${e.stderr || ''}${e.stdout || e.stderr ? '' : e.message}`);
}

// 5. Intégrité des bibliothèques (Subresource Integrity), mise en cache dans tools/sri.json
const sriFile = path.join(ROOT, 'tools', 'sri.json');
const sri = fs.existsSync(sriFile) ? JSON.parse(fs.readFileSync(sriFile, 'utf8')) : {};
for (const k of ['supabase', 'chart']) {
  if (sri[CDN[k]]) continue;
  const res = await fetch(CDN[k]);
  if (!res.ok) fail(`téléchargement de ${CDN[k]} impossible (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  sri[CDN[k]] = `sha384-${crypto.createHash('sha384').update(buf).digest('base64')}`;
}
fs.writeFileSync(sriFile, `${JSON.stringify(sri, null, 2)}\n`);

// 6. Logo de l'écran de chargement (même dessin que dans l'appli)
const ctx = vm.createContext({ Intl, Math, Date, JSON, Object, Array, String, Number, RegExp, Map, Set, Symbol, Uint8Array, console });
vm.runInContext(`${fs.readFileSync(path.join(jsDir, '00-core.js'), 'utf8')}\n;globalThis.__logo = String(logoMark(76, { tile: true, animated: true }));`, ctx);
const splashLogo = ctx.__logo;

// 7. Politique de sécurité du contenu (CSP)
const connect = ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co', 'https://*.supabase.in', 'wss://*.supabase.in', 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
if (DEV) connect.push('http://127.0.0.1:*', 'ws://127.0.0.1:*', 'http://localhost:*', 'ws://localhost:*');
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src ${connect.join(' ')}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const outHtml = htmlTpl
  .replace('{{CSP}}', () => csp)
  .replace('{{FONT_CSS}}', () => FONT_CSS.replace(/&/g, '&amp;'))
  .replace('{{CSS}}', () => read('src/styles.css'))
  .replace('{{SPLASH_LOGO}}', () => splashLogo)
  .replace('{{SRI_SUPABASE}}', () => sri[CDN.supabase])
  .replace('{{SRI_CHART}}', () => sri[CDN.chart])
  .replace('{{JS}}', () => js);
if (/\{\{[A-Z_]+\}\}/.test(outHtml)) fail(`marqueur non remplacé : ${outHtml.match(/\{\{[A-Z_]+\}\}/)[0]}`);

const cdnList = [
  { url: CDN.tailwind, cors: false },
  { url: CDN.supabase, cors: true },
  { url: CDN.chart, cors: true },
  { url: CDN.jszip, cors: true },
  { url: CDN.qrcode, cors: true },
];
const sw = read('src/sw.js')
  .replace("'__APP_VERSION__'", () => JSON.stringify(version))
  .replace('__CDN_URLS__', () => JSON.stringify(cdnList))
  .replace("'__FONT_CSS__'", () => JSON.stringify(FONT_CSS));
if (/__[A-Z_]+__/.test(sw)) fail('marqueur non remplacé dans sw.js');

// 8. Écriture
fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), outHtml);
fs.writeFileSync(path.join(OUT, 'sw.js'), sw);
fs.copyFileSync(path.join(ROOT, 'src', 'manifest.webmanifest'), path.join(OUT, 'manifest.webmanifest'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
const iconDir = path.join(ROOT, 'src', 'icons');
if (!fs.existsSync(iconDir)) fail('icônes absentes : lance d’abord « node tools/icons.mjs »');
for (const f of fs.readdirSync(iconDir)) fs.copyFileSync(path.join(iconDir, f), path.join(OUT, 'icons', f));

const kb = (n) => `${(n / 1024).toFixed(0)} Ko`;
console.log(`✔ Paulo3D ${version} → ${path.relative(ROOT, OUT)}/`);
console.log(`  index.html ${kb(Buffer.byteLength(outHtml))} · ${files.length} fichiers JS · ${Object.keys(icons).length} icônes · CSP ${DEV ? 'dev (127.0.0.1 autorisé)' : 'production'}`);
