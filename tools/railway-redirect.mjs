// Ancienne adresse Railway → adresse GitHub Pages (retour sur GitHub le 19/09).
// Remplace le site servi par Railway par une redirection qui GARDE la fin du lien (#setup=…,
// #/bobines?peser=… d'une étiquette imprimée, lien de mot de passe oublié).
// Le service worker installé sur l'ancienne adresse est remplacé par un « interrupteur » qui efface
// la copie hors-ligne (caches), se désinstalle et recharge les pages ouvertes → elles partent vers la
// nouvelle adresse. La mémoire locale (IndexedDB) est GARDÉE : jamais d'effacement d'actions non envoyées.
// Usage : node tools/railway-redirect.mjs paulo3d|anais3d|nail-studio [--prepare-only]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = {
  paulo3d: { target: 'https://fadeflux.github.io/paulo3d/', name: 'Paulo3D', lang: 'pt-PT', text: 'O Paulo3D mudou de endereço:', cache: 'p3d-', ls: 'p3d', idb: 'paulo3d:', carry: ['A levar ', ' ações ainda não enviadas', ' ação ainda não enviada', ' para o novo endereço…'], railway: ['895bf682-da2c-4849-b161-49837eab4e51', 'e4453a4d-6871-4f9a-bed3-3534e4c14bd2', '66596d19-3063-4777-817f-243e6025d9ec'] },
  anais3d: { target: 'https://fadeflux.github.io/anais3d/', name: 'Anais3D', lang: 'fr', text: 'Anais3D a changé d’adresse :', cache: 'a3d-', ls: 'a3d', idb: 'anais3d:', carry: ['Transfert de ', ' actions pas encore envoyées', ' action pas encore envoyée', ' vers la nouvelle adresse…'], railway: ['0ea4aae7-4cfa-49e3-b555-77a6764be492', '4bf13d83-0d74-48a0-a4cc-781ca7f54dc3', '22ca3a7b-b4b7-4700-be75-7a70b6f8b6c3'] },
  'nail-studio': { target: 'https://fadeflux.github.io/nail-studio/', name: 'Nail Studio', lang: 'fr', text: 'L’atelier a changé d’adresse :', cache: null, railway: ['e9509787-c7ea-4d1a-b30b-dca5144a92bf', '4099601c-7ad9-466d-aa0d-6b7fe6449755', 'a812d73a-39fe-472a-94e2-78d5f4b61fcf'] },
};
const id = process.argv[2];
const T = TARGETS[id];
if (!T) {
  console.error(`Usage : node tools/railway-redirect.mjs ${Object.keys(TARGETS).join('|')}`);
  process.exit(1);
}

// Actions faites hors connexion sur l'ancienne adresse et pas encore envoyées : la page les lit
// (LECTURE SEULE, rien n'est effacé) et les emporte dans le lien (#p3d-import=…) ; l'appli les reprend
// après connexion (Boot.importOldAddress : même compte seulement, jamais deux fois). Même mécanisme que
// tools/redirect-old.mjs. Lecture impossible ou trop lente (8 s) : redirection simple.
const carryScript = (idb, [avant, plusieurs, une, apres]) => [
  '(function(){',
  'var T=' + JSON.stringify(T.target) + ',fini=false;',
  'function go(h){if(fini)return;fini=true;location.replace(T+(h===undefined?location.hash:h));}',
  // session et réglages laissés sur l'ancienne adresse : effacés (la copie locale, elle, est gardée)
  'try{Object.keys(localStorage).forEach(function(k){if(/^' + T.ls + '[_-]/.test(k))localStorage.removeItem(k)})}catch(e){}',
  'if(!window.indexedDB||!indexedDB.databases){go();return;}',
  'setTimeout(function(){go();},8000);',
  'function lire(n){return new Promise(function(res){try{var r=indexedDB.open(n);',
  'r.onupgradeneeded=function(){try{r.transaction.abort()}catch(e){}};r.onerror=r.onblocked=function(){res(null)};',
  'r.onsuccess=function(){var db=r.result;try{if(!db.objectStoreNames.contains("kv")){db.close();return res(null);}',
  'var q=db.transaction("kv","readonly").objectStore("kv").getAll(IDBKeyRange.bound("op:","op:\\uffff"));',
  'q.onsuccess=function(){db.close();res({db:n,ops:q.result||[]})};q.onerror=function(){db.close();res(null)};}',
  'catch(e){try{db.close()}catch(e2){}res(null)}};}catch(e){res(null)}});}',
  'indexedDB.databases().then(function(l){return Promise.all((l||[]).map(function(d){return d.name}).filter(function(n){return n&&n.indexOf(' + JSON.stringify(idb) + ')===0}).map(lire));})',
  '.then(function(p){p=(p||[]).filter(function(x){return x&&x.ops.length});if(!p.length)return go();',
  'var n=p.reduce(function(a,x){return a+x.ops.length},0),m=document.getElementById("m");',
  'if(m)m.textContent=' + JSON.stringify(avant) + '+n+(n>1?' + JSON.stringify(plusieurs) + ':' + JSON.stringify(une) + ')+' + JSON.stringify(apres) + ';',
  'var s=btoa(unescape(encodeURIComponent(JSON.stringify(p)))).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");',
  'go("#p3d-import="+s);})["catch"](function(){go();});',
  '})();',
].join('');
const script = T.idb ? carryScript(T.idb, T.carry) : `location.replace(${JSON.stringify(T.target)} + location.hash);`;
const hash = crypto.createHash('sha256').update(script, 'utf8').digest('base64');
const html = `<!doctype html>
<html lang="${T.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${T.name}</title>
<script>${script}</script>
<noscript><meta http-equiv="refresh" content="0;url=${T.target}"></noscript>
</head>
<body style="background:#05070A;color:#E2E8F0;font-family:system-ui,sans-serif;padding:32px">
<p id="m"></p>
<p>${T.text} <a style="color:#22F2A0" href="${T.target}">${T.target.replace(/^https:\/\//, '').replace(/\/$/, '')}</a></p>
</body>
</html>
`;
const cacheLine = T.cache
  ? `    for (const k of await caches.keys()) if (k.startsWith(${JSON.stringify(T.cache)})) await caches.delete(k);\n`
  : '    for (const k of await caches.keys()) await caches.delete(k);\n';
const sw = `// Le site a déménagé : efface la copie hors-ligne, se désinstalle, recharge les pages (→ redirection).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
${cacheLine}    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
  })());
});
`;
// toute adresse de l'ancien site (sauf sw.js) renvoie la page de redirection
const caddy = `{
	admin off
	auto_https off
}

:{$PORT} {
	root * /srv
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "no-referrer"
		Cache-Control "no-cache"
		-Server
	}
	try_files {path} /index.html
	file_server
}
`;

const stage = path.join(ROOT, '.dev', `redirect-${id}`);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'site'), { recursive: true });
fs.writeFileSync(path.join(stage, 'site', 'index.html'), html);
fs.writeFileSync(path.join(stage, 'site', 'sw.js'), sw);
fs.writeFileSync(path.join(stage, 'site', 'robots.txt'), 'User-agent: *\nDisallow: /\n');
fs.writeFileSync(path.join(stage, 'Caddyfile'), caddy);
fs.copyFileSync(path.join(ROOT, 'tools', 'deploy', 'Dockerfile'), path.join(stage, 'Dockerfile'));
console.log(`✔ ${stage} : redirection vers ${T.target}`);
if (process.argv.includes('--prepare-only')) process.exit(0);
// projet / environnement / service Railway donnés en clair : le dossier n'a pas besoin d'être relié
const [project, environment, service] = T.railway;
execFileSync('railway', ['up', '--detach', '--project', project, '--environment', environment, '--service', service], { cwd: stage, stdio: 'inherit', shell: true });
