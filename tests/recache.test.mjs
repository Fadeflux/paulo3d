// Copie hors-ligne vidée par un autre site : la PAGE doit la faire reconstituer.
// Code RÉEL : .dev/site/sw.js (service worker) + Boot.checkOfflineCache de .dev/app.js (page).
// Seule l'API Cache du navigateur est imitée, avec la sémantique de la spec :
//   caches.open(nom) CRÉE le cache s'il n'existe pas ; cache.addAll est atomique et échoue en bloc.
//
// ⚠️ (18/09) La page ne demandait la réparation que si le cache N'EXISTAIT PAS (caches.has).
// Or le service worker le recrée — VIDE — à chaque requête (caches.open), et une réparation
// ratée (4G faible, Wi-Fi sans internet) laisse aussi un cache vide : la réparation ne partait
// presque jamais, et l'appli ne s'ouvrait plus sans réseau (« pas encore installée »).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://paulo-3d.example';
const SW = fs.readFileSync(path.join(ROOT, '.dev', 'site', 'sw.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, '.dev', 'app.js'), 'utf8');
const VERSION = SW.match(/const VERSION = "([^"]+)"/)[1];
const SHELL = `p3d-shell-${VERSION}`;

function world() {
  const net = { up: true };
  const store = new Map();
  const abs = (u) => new URL(typeof u === 'string' ? u : u.url, `${ORIGIN}/`).href;
  const fetchMock = async (req) => {
    if (!net.up) throw new TypeError('Failed to fetch');
    return new Response(`body of ${abs(req)}`, { status: 200 });
  };
  const cacheObj = (name) => {
    const m = store.get(name);
    return {
      async match(req) { const r = m.get(abs(req)); return r ? r.clone() : undefined; },
      async put(req, res) { m.set(abs(req), res); },
      async addAll(reqs) { // atomique, comme le vrai Cache.addAll
        const got = [];
        for (const r of reqs) { const res = await fetchMock(r); if (!res.ok) throw new TypeError('bad status'); got.push([abs(r), res]); }
        for (const [k, v] of got) m.set(k, v);
      },
    };
  };
  const caches = {
    async open(name) { if (!store.has(name)) store.set(name, new Map()); return cacheObj(name); },
    async has(name) { return store.has(name); },
    async keys() { return [...store.keys()]; },
    async delete(name) { return store.delete(name); },
  };
  const listeners = {};
  const self = { location: new URL(`${ORIGIN}/sw.js`), addEventListener: (t, f) => { listeners[t] = f; }, clients: { claim: async () => {} }, skipWaiting: () => {} };
  class Req { constructor(u, o = {}) { this.url = abs(u); Object.assign(this, o); } }
  vm.runInContext(SW, vm.createContext({ self, caches, fetch: fetchMock, Request: Req, Response, URL, console }));
  const fire = async (type, extra = {}) => {
    let wait = Promise.resolve(); let responded;
    listeners[type]({ ...extra, waitUntil: (x) => { wait = x; }, respondWith: (x) => { responded = x; } });
    await wait;
    return responded ? await responded : undefined;
  };
  const posted = [];
  const enCours = [];     // le vrai postMessage n'attend pas le service worker : on garde sa promesse
  const reg = { waiting: null, active: { postMessage: (data) => { posted.push(data); enCours.push(fire('message', { data })); } } };
  const ctx = vm.createContext({ console, crypto: globalThis.crypto, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL, URLSearchParams, atob, btoa, caches,
    navigator: { onLine: true, serviceWorker: { ready: Promise.resolve(reg) } } });
  vm.runInContext(APP, ctx, { filename: 'app.js' });
  const Boot = vm.runInContext('Boot', ctx);
  const navigate = () => fire('fetch', { request: { method: 'GET', url: `${ORIGIN}/`, mode: 'navigate' } });
  const attendre = () => Promise.all(enCours);
  return { net, store, fire, Boot, posted, navigate, attendre };
}

test('caches vidés par un autre site, réouverture AVEC réseau : la copie hors-ligne est reconstituée', async () => {
  const w = world();
  await w.fire('install'); await w.fire('activate');
  const installes = w.store.get(SHELL).size;
  assert.ok(installes > 0, 'installation normale : la page est en cache');
  w.store.clear();                                   // le service worker d'un autre site efface tout
  const page = await w.navigate();                   // l'utilisateur rouvre Paulo3D, réseau OK
  assert.equal(page.status, 200, 'page servie par le réseau');
  assert.equal(w.store.get(SHELL).size, 0, 'le service worker a recréé le cache… VIDE (caches.open)');
  await w.Boot.checkOfflineCache();                  // contrôle de la page (au chargement)
  await w.attendre();
  assert.equal(w.posted.length, 1, 'la page demande la réparation malgré le cache vide');
  assert.equal(w.store.get(SHELL).size, installes, 'copie hors-ligne reconstituée');
  w.net.up = false;                                  // plus tard, à l'atelier sans réseau
  const off = await w.navigate();
  assert.equal(off.status, 200, 'Paulo3D s’ouvre hors-ligne');
});

test('une réparation ratée (réseau faible) est retentée au retour du réseau', async () => {
  const w = world();
  await w.fire('install'); await w.fire('activate');
  w.store.clear();
  w.net.up = false;                                  // navigator.onLine reste vrai (Wi-Fi sans internet, 4G faible)
  await w.Boot.checkOfflineCache();
  await w.attendre();
  assert.equal(w.posted.length, 1, 'réparation demandée');
  assert.equal(w.store.get(SHELL).size, 0, 'elle a échoué (réseau)');
  w.net.up = true;                                   // réseau revenu
  await w.Boot.checkOfflineCache();
  await w.attendre();
  assert.equal(w.posted.length, 2, 'la réparation est redemandée');
  assert.ok(w.store.get(SHELL).size > 0, 'et cette fois la copie est reconstituée');
});

test('copie complète : aucune réparation inutile', async () => {
  const w = world();
  await w.fire('install'); await w.fire('activate');
  await w.Boot.checkOfflineCache();
  assert.equal(w.posted.length, 0);
});
