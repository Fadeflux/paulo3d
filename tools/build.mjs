// Construit le site à partir de src/ :
//   docs/index.html (application complète en UN fichier : JS, CSS Tailwind compilé, icônes, logo)
//   + sw.js (hors-ligne) + manifest + icônes
// Usage : node tools/build.mjs                  → Paulo3D (portugais) dans docs/ (production, GitHub Pages)
//         node tools/build.mjs --site anais3d    → Anais3D (français) dans ../Anais3D/docs/
//         node tools/build.mjs --dev             → .dev/site/ (tests locaux, code français tel quel, autorise 127.0.0.1)
//         node tools/build.mjs --dev --site X    → .dev/X/ (le site X tel qu'il sera publié, pour l'essayer en local)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CDN, FONT_CSS } from './cdn.mjs';
import { SITES, DEV_SITE } from './sites.mjs';
import { translate } from './i18n.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV = process.argv.includes('--dev');
const siteArg = process.argv.includes('--site') ? process.argv[process.argv.indexOf('--site') + 1] : null;
if (siteArg && !SITES[siteArg]) {
  console.error(`Site inconnu : ${siteArg} (connus : ${Object.keys(SITES).join(', ')})`);
  process.exit(1);
}
const SITE = siteArg ? SITES[siteArg] : DEV ? DEV_SITE : SITES.paulo3d;
const OUT = DEV ? path.join(ROOT, '.dev', siteArg || 'site') : path.resolve(ROOT, SITE.out);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const fail = (msg) => {
  console.error(`\n✖ BUILD ÉCHOUÉ : ${msg}\n`);
  process.exit(1);
};


fs.mkdirSync(path.join(ROOT, '.dev'), { recursive: true });

// 1. JavaScript : concaténation dans l'ordre des fichiers
const jsDir = path.join(ROOT, 'src', 'js');
const files = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort();
// fins de ligne LF partout : le navigateur calcule l'empreinte du script (CSP) sur du texte en LF
const lf = (t) => t.replace(/\r\n?/g, '\n');
// langue du site : chaque texte visible remplacé par sa traduction (i18n/<langue>.json) ; un texte sans
// traduction fait ÉCHOUER la construction (jamais de français oublié sur le site portugais)
const catalogFile = path.join(ROOT, 'i18n', `${SITE.lang}.json`);
const catalog = SITE.lang === 'fr' ? null : JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
const missingTexts = new Set();
const sources = files.map((f) => {
  const code = fs.readFileSync(path.join(jsDir, f), 'utf8');
  if (!catalog) return [f, code];
  const t = translate(code, catalog, f);
  for (const m of t.missing) missingTexts.add(`${f} : ${JSON.stringify(m)}`);
  return [f, t.code];
});
if (missingTexts.size) fail(`${missingTexts.size} texte(s) sans traduction ${SITE.lang} (node tools/i18n.mjs ${SITE.lang}) :\n  ${[...missingTexts].slice(0, 30).join('\n  ')}`);
// identité du site (voir SITE dans 00-core.js)
const siteMarkers = {
  __SITE_ID__: SITE.id, __SITE_NAME__: SITE.name, __SITE_PREFIX__: SITE.prefix, __SITE_LANG__: SITE.lang, __SITE_LOCALE__: SITE.locale, __SITE_LETTER__: SITE.letter,
  __SITE_SUPA_URL__: SITE.supabase ? SITE.supabase.url : '', __SITE_SUPA_KEY__: SITE.supabase ? SITE.supabase.key : '',
};
if (SITE.supabase && !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(SITE.supabase.url)) fail(`adresse Supabase du site invalide : ${SITE.supabase.url}`);
const withSite = (code) => code.replace(/'(__SITE_[A-Z_]+?__)'/g, (m, k) => (k in siteMarkers ? JSON.stringify(siteMarkers[k]) : m));
let js = withSite(lf(sources.map(([f, code]) => `/* ==== ${f} ==== */\n${code}`).join('\n')));
const htmlTpl = lf(read('src/index.html'));

for (const k of ['jszip', 'qrcode', 'jsqr']) if (!js.includes(CDN[k])) fail(`l'adresse ${k} du code ne correspond pas à tools/cdn.mjs`);
for (const k of ['supabase', 'chart']) if (!htmlTpl.includes(CDN[k])) fail(`l'adresse ${k} de index.html ne correspond pas à tools/cdn.mjs`);

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

// 3. CSS : Tailwind compilé (seulement les classes utilisées) + composants de src/styles.css
const twInput = path.join(ROOT, '.dev', 'tw-input.css');
const twOutput = path.join(ROOT, '.dev', 'tw-output.css');
fs.writeFileSync(twInput, `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n${read('src/styles.css')}`);
try {
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'tailwindcss', 'lib', 'cli.js'), '-c', path.join(ROOT, 'tailwind.config.cjs'), '-i', twInput, '-o', twOutput, '--minify'], { cwd: ROOT, stdio: 'pipe' });
} catch (e) {
  fail(`compilation Tailwind\n${e.stderr || e.message}`);
}
const css = fs.readFileSync(twOutput, 'utf8');
for (const cls of ['.btn-primary', '.card', '.input', '.chip-active', '.nav-active', '.bottom-active', '.toggle']) {
  if (!css.includes(cls)) fail(`classe CSS manquante après compilation : ${cls}`);
}
if (/<\/style/i.test(css)) fail('le CSS contient « </style> »');

// 4. Intégrité des bibliothèques (Subresource Integrity), mise en cache dans tools/sri.json
const sriFile = path.join(ROOT, 'tools', 'sri.json');
const sri = fs.existsSync(sriFile) ? JSON.parse(fs.readFileSync(sriFile, 'utf8')) : {};
for (const k of Object.keys(CDN)) {
  if (sri[CDN[k]]) continue;
  const res = await fetch(CDN[k]);
  if (!res.ok) fail(`téléchargement de ${CDN[k]} impossible (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  sri[CDN[k]] = `sha384-${crypto.createHash('sha384').update(buf).digest('base64')}`;
}
for (const url of Object.keys(sri)) if (!Object.values(CDN).includes(url)) delete sri[url];
fs.writeFileSync(sriFile, `${JSON.stringify(sri, null, 2)}\n`);
js = js.replace("'__SRI_JSZIP__'", () => JSON.stringify(sri[CDN.jszip])).replace("'__SRI_QR__'", () => JSON.stringify(sri[CDN.qrcode])).replace("'__SRI_JSQR__'", () => JSON.stringify(sri[CDN.jsqr]));

// 5. Version = empreinte du contenu (même contenu → même version → pas de fausse mise à jour)
const pkg = JSON.parse(read('package.json'));
const hash = crypto.createHash('sha256')
  .update(js).update(css).update(htmlTpl).update(read('src/sw.js')).update(read('src/manifest.webmanifest')).update(lf(read('tools/build.mjs'))).update(lf(read('tools/cdn.mjs')))
  .update(JSON.stringify(SITE))
  .digest('hex').slice(0, 8);
const version = `${pkg.version}-${hash}`;
js = js.replace(/'__APP_VERSION__'/g, () => JSON.stringify(version));
if (/<\/script/i.test(js)) fail('le code contient « </script> », ce qui casserait la page');
if (/'__[A-Z_]+__'/.test(js)) fail(`marqueur non remplacé dans le code : ${js.match(/'__[A-Z_]+__'/)[0]}`);

// 6. Vérifications : syntaxe, noms jamais définis
// .dev/app.js = le code des tests (construction --dev) ; un site publié a son propre fichier d'analyse
const appPath = path.join(ROOT, '.dev', DEV && !siteArg ? 'app.js' : `app-${SITE.id}.js`);
fs.writeFileSync(appPath, js);
try {
  execFileSync(process.execPath, ['--check', appPath], { stdio: 'pipe' });
} catch (e) {
  fail(`erreur de syntaxe\n${e.stderr}`);
}
try {
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js'), '--no-ignore', '--max-warnings', '0', path.relative(ROOT, appPath)], { cwd: ROOT, stdio: 'pipe' });
} catch (e) {
  fail(`vérification ESLint\n${e.stdout || ''}${e.stderr || ''}${e.stdout || e.stderr ? '' : e.message}`);
}

// 7. Logo de l'écran de chargement (même dessin que dans l'appli)
const ctx = vm.createContext({ Intl, Math, Date, JSON, Object, Array, String, Number, RegExp, Map, Set, Symbol, Uint8Array, console });
vm.runInContext(`${withSite(fs.readFileSync(path.join(jsDir, '00-core.js'), 'utf8'))}\n;globalThis.__logo = String(logoMark(76, { tile: true, animated: true }));`, ctx);
const splashLogo = ctx.__logo;

// 8. Politique de sécurité du contenu (CSP). Seuls peuvent s'exécuter :
//    - le script intégré à CETTE page, reconnu par son empreinte sha256 (calculée après assemblage) ;
//    - les 4 bibliothèques jsdelivr, à leur adresse EXACTE (et vérifiées par leur intégrité).
//    Un code glissé dans la page (attribut onclick, <img onerror>, autre script jsdelivr…) est bloqué.
//    'unsafe-inline' ne sert qu'aux très vieux navigateurs : il est ignoré dès qu'une empreinte est présente.
// site avec sa base inscrite : la page ne peut parler QU'À ce projet Supabase (défense en profondeur)
const supaHosts = SITE.supabase
  ? [SITE.supabase.url, SITE.supabase.url.replace(/^https:/, 'wss:')]
  : ['https://*.supabase.co', 'wss://*.supabase.co', 'https://*.supabase.in', 'wss://*.supabase.in'];
const connect = ["'self'", ...supaHosts, 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
if (DEV) connect.push('http://127.0.0.1:*', 'ws://127.0.0.1:*', 'http://localhost:*', 'ws://localhost:*');
const cspFor = (inlineHashes) => [
  "default-src 'self'",
  `script-src 'self' ${inlineHashes.map((h) => `'${h}'`).join(' ')} 'unsafe-inline' ${Object.values(CDN).join(' ')}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src ${connect.join(' ')}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');
// aucun code dans les attributs HTML (onclick=…, href="javascript:…") : la CSP les bloquerait
for (const [what, text] of [['le code', js], ['index.html', htmlTpl]]) {
  const bad = text.match(/\son[a-z]+\s*=\s*["'`]|javascript:/i);
  if (bad) fail(`${what} contient « ${bad[0].trim()} » : code dans un attribut HTML, bloqué par la CSP (utiliser addEventListener)`);
}

const attr = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let outHtml = htmlTpl
  .replace('{{LANG}}', () => SITE.lang)
  .replace('{{TITLE}}', () => attr(SITE.texts.title))
  .replace('{{DESCRIPTION}}', () => attr(SITE.texts.description))
  .replace('{{NAME}}', () => attr(SITE.name))
  .replace('{{WORD}}', () => attr(SITE.name.replace(/3D$/, '')))
  .replace('{{NOSCRIPT}}', () => attr(SITE.texts.noscript))
  .replace('{{FONT_CSS}}', () => FONT_CSS.replace(/&/g, '&amp;'))
  .replace('{{CSS}}', () => css)
  .replace('{{SPLASH_LOGO}}', () => splashLogo)
  .replace('{{SRI_SUPABASE}}', () => sri[CDN.supabase])
  .replace('{{SRI_CHART}}', () => sri[CDN.chart])
  .replace('{{JS}}', () => js);
// empreinte du texte EXACT de chaque script intégré (le navigateur calcule la même avant de l'exécuter)
const inlineScripts = [...outHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (inlineScripts.length !== 1) fail(`un seul script intégré attendu dans index.html, trouvé ${inlineScripts.length}`);
if ((outHtml.match(/<script\b/g) || []).length !== inlineScripts.length + 2) fail('script inattendu dans index.html (la CSP ne le laisserait pas s’exécuter)');
const csp = cspFor(inlineScripts.map((t) => `sha256-${crypto.createHash('sha256').update(t, 'utf8').digest('base64')}`));
outHtml = outHtml.replace('{{CSP}}', () => csp);
if (/\{\{[A-Z_]+\}\}/.test(outHtml)) fail(`marqueur non remplacé : ${outHtml.match(/\{\{[A-Z_]+\}\}/)[0]}`);

const cdnList = Object.values(CDN).map((url) => ({ url, cors: true }));
const sw = read('src/sw.js')
  .replace("'__APP_VERSION__'", () => JSON.stringify(version))
  .replace("'__SITE_PREFIX__'", () => JSON.stringify(SITE.prefix))
  .replace("'__OFFLINE_TEXT__'", () => JSON.stringify(attr(SITE.texts.offline)))
  .replace('__CDN_URLS__', () => JSON.stringify(cdnList))
  .replace("'__FONT_CSS__'", () => JSON.stringify(FONT_CSS));
if (/__[A-Z_]+__/.test(sw)) fail('marqueur non remplacé dans sw.js');

// 9. Écriture
fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), outHtml);
fs.writeFileSync(path.join(OUT, 'sw.js'), sw);
// manifeste d'installation : nom, langue et raccourcis du site
const manifest = JSON.parse(read('src/manifest.webmanifest'));
manifest.name = SITE.texts.title;
manifest.short_name = SITE.name;
manifest.description = SITE.texts.description;
manifest.lang = SITE.lang;
manifest.shortcuts.forEach((sc, i) => {
  sc.name = SITE.texts.shortcuts[i * 2];
  sc.short_name = SITE.texts.shortcuts[i * 2 + 1];
});
fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
const iconDir = path.join(ROOT, SITE.icons);
if (!fs.existsSync(iconDir)) fail(`icônes absentes : lance d’abord « node tools/icons.mjs ${SITE.id} »`);
for (const f of fs.readdirSync(iconDir)) fs.copyFileSync(path.join(iconDir, f), path.join(OUT, 'icons', f));

const kb = (n) => `${(n / 1024).toFixed(0)} Ko`;
console.log(`✔ ${SITE.name} (${SITE.lang}) ${version} → ${path.relative(ROOT, OUT)}/`);
console.log(`  index.html ${kb(Buffer.byteLength(outHtml))} (CSS ${kb(css.length)}) · ${files.length} fichiers JS · ${Object.keys(icons).length} icônes · CSP ${DEV ? 'dev (127.0.0.1 autorisé)' : 'production'}`);
