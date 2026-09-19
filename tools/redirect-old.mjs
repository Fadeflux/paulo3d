// Ancienne adresse GitHub Pages (fadeflux.github.io/paulo3d/) → nouvelle adresse Railway.
// docs/ ne contient plus que :
//   - index.html : redirige en GARDANT la fin du lien (#setup=… d'un lien de configuration,
//     #/bobines?peser=… d'une étiquette imprimée) ;
//   - sw.js : remplace l'ancien service worker, efface l'ancienne copie hors-ligne de Paulo3D
//     (caches p3d-* seulement : ceux des autres sites de la même adresse ne sont pas touchés),
//     se désinstalle et recharge les pages ouvertes → elles arrivent sur la redirection.
// Usage : node tools/redirect-old.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = 'https://paulo3d.up.railway.app/';
const OUT = path.join(ROOT, 'docs');

// Avant de partir : efface la session Supabase et les réglages que Paulo3D avait laissés sur cette adresse
// PARTAGÉE avec les autres sites fadeflux.github.io (un autre site de la même adresse pourrait les lire).
// La copie locale (IndexedDB paulo3d:*) est GARDÉE : elle peut contenir des actions faites hors connexion
// et jamais envoyées — les effacer les perdrait pour de bon.
const script = [
  'try{Object.keys(localStorage).forEach(function(k){if(/^p3d[_-]/.test(k))localStorage.removeItem(k)})}catch(e){}',
  'location.replace(' + JSON.stringify(TARGET) + '+location.hash);',
].join('');
const hash = crypto.createHash('sha256').update(script, 'utf8').digest('base64');
const html = `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Paulo3D</title>
<script>${script}</script>
<noscript><meta http-equiv="refresh" content="0;url=${TARGET}"></noscript>
</head>
<body style="background:#05070A;color:#E2E8F0;font-family:system-ui,sans-serif;padding:32px">
<p>O Paulo3D mudou de endereço: <a style="color:#22F2A0" href="${TARGET}">${TARGET.replace(/^https:\/\//, '').replace(/\/$/, '')}</a></p>
</body>
</html>
`;
const sw = `// L'appli a déménagé : efface l'ancienne copie hors-ligne de Paulo3D, se désinstalle, recharge les pages.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('p3d-')) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
  })());
});
`;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), html);
fs.writeFileSync(path.join(OUT, '404.html'), html);
fs.writeFileSync(path.join(OUT, 'sw.js'), sw);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
console.log(`✔ docs/ = redirection vers ${TARGET}`);
