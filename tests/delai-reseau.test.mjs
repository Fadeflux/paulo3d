// Délai réseau : un téléchargement qui AVANCE n'est jamais coupé ; un téléchargement BLOQUÉ l'est.
// Code RÉEL (.dev/app.js), seul le délai est mis à l'échelle (30 s -> 1 s). Serveur local 127.0.0.1.
//
// ⚠️ (18/09) Le délai de 30 s couvrait TOUT le téléchargement : la première synchro d'un appareil
// (des Mo de modèles avec photos) sur une 4G faible était coupée à 30 s alors que les données
// arrivaient sans interruption — « Hors-ligne », et le même téléchargement recommencé sans fin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ECHELLE = 30;                                   // 30 s réelles -> 1 s ici
const SRC = fs.readFileSync(path.join(ROOT, '.dev', 'app.js'), 'utf8');
assert.ok(SRC.includes('const REQUEST_TIMEOUT_MS = 30000;'), 'délai de 30 s trouvé dans le code');
const ctx = vm.createContext({ fetch, Response, AbortController, setTimeout, clearTimeout, console, crypto: globalThis.crypto,
  TextEncoder, TextDecoder, URL, URLSearchParams, atob, btoa });
vm.runInContext(SRC.replace('const REQUEST_TIMEOUT_MS = 30000;', `const REQUEST_TIMEOUT_MS = ${30000 / ECHELLE};`)
  + '\n;globalThis.__f = fetchWithTimeout;', ctx, { filename: 'app.js' });
const fetchWithTimeout = ctx.__f;

const serveur = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  if (req.url === '/lent') {
    // 3 s de données continues (= 90 s réelles), un morceau toutes les 100 ms
    let i = 0;
    const t = setInterval(() => {
      res.write(`${i === 0 ? '[' : ','}"${'x'.repeat(1000)}"`);
      if (++i === 30) { clearInterval(t); res.end(']'); }
    }, 100);
    req.on('close', () => clearInterval(t));
  } else {
    res.write('["debut"');                            // puis plus rien : téléchargement bloqué
  }
});
await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${serveur.address().port}`;

test('téléchargement lent mais CONTINU (90 s réelles) : il va jusqu’au bout', async () => {
  const res = await fetchWithTimeout(`${base}/lent`, {});
  const lignes = await res.json();
  assert.equal(lignes.length, 30);
});

test('téléchargement BLOQUÉ à mi-chemin : abandonné (traité comme une coupure)', async () => {
  const t0 = Date.now();
  await assert.rejects(async () => { const r = await fetchWithTimeout(`${base}/bloque`, {}); await r.text(); },
    (e) => e && e.name === 'AbortError');
  assert.ok(Date.now() - t0 < 5000, 'abandon rapide (délai d’inactivité)');
});

test.after(() => { serveur.closeAllConnections?.(); serveur.close(); });
