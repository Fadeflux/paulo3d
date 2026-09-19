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
//
// ⚠️ (19/09) ACTIONS PAS ENCORE ENVOYÉES. Garder la copie locale ne suffisait pas : la nouvelle adresse ne
// peut pas lire le stockage de celle-ci, et l'ancienne appli n'existe plus pour les envoyer — une vente
// faite hors-ligne juste avant le déménagement était perdue sans un mot. La page lit donc la file
// (entrées « op:… » des bases paulo3d:*, en LECTURE SEULE, rien n'est effacé) et l'emporte dans le lien
// (#p3d-import=…) ; la nouvelle appli la remet dans sa file après connexion (Boot.importOldAddress).
// Tant que l'icône installée pointe ici, chaque ouverture refait le transfert : l'appli ignore les
// actions déjà reprises. Lecture impossible ou trop lente (8 s) : redirection simple, comme avant.
const script = [
  '(function(){',
  'var T=' + JSON.stringify(TARGET) + ',fini=false;',
  'function go(h){if(fini)return;fini=true;location.replace(T+(h===undefined?location.hash:h));}',
  'try{Object.keys(localStorage).forEach(function(k){if(/^p3d[_-]/.test(k))localStorage.removeItem(k)})}catch(e){}',
  'if(!window.indexedDB||!indexedDB.databases){go();return;}',
  'setTimeout(function(){go();},8000);',
  'function lire(n){return new Promise(function(res){try{var r=indexedDB.open(n);',
  'r.onupgradeneeded=function(){try{r.transaction.abort()}catch(e){}};r.onerror=r.onblocked=function(){res(null)};',
  'r.onsuccess=function(){var db=r.result;try{if(!db.objectStoreNames.contains("kv")){db.close();return res(null);}',
  'var q=db.transaction("kv","readonly").objectStore("kv").getAll(IDBKeyRange.bound("op:","op:\\uffff"));',
  'q.onsuccess=function(){db.close();res({db:n,ops:q.result||[]})};q.onerror=function(){db.close();res(null)};}',
  'catch(e){try{db.close()}catch(e2){}res(null)}};}catch(e){res(null)}});}',
  'indexedDB.databases().then(function(l){return Promise.all((l||[]).map(function(d){return d.name}).filter(function(n){return n&&n.indexOf("paulo3d:")===0}).map(lire));})',
  '.then(function(p){p=(p||[]).filter(function(x){return x&&x.ops.length});if(!p.length)return go();',
  'var n=p.reduce(function(a,x){return a+x.ops.length},0),m=document.getElementById("m");',
  'if(m)m.textContent="A levar "+n+(n>1?" a\\u00e7\\u00f5es ainda n\\u00e3o enviadas":" a\\u00e7\\u00e3o ainda n\\u00e3o enviada")+" para o novo endere\\u00e7o\\u2026";',
  'var s=btoa(unescape(encodeURIComponent(JSON.stringify(p)))).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");',
  'go("#p3d-import="+s);})["catch"](function(){go();});',
  '})();',
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
<p id="m"></p>
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
