// Déménagement fadeflux.github.io -> Railway : une action faite hors-ligne sur l'ancienne adresse et pas
// encore envoyée n'est plus perdue. Code RÉEL des deux côtés :
//   - la page de redirection publiée (docs/index.html, script inline) avec un faux stockage du téléphone ;
//   - la nouvelle appli (.dev/app.js, Boot.captureOldAddressImport / importOldAddress).
//
// ⚠️ (19/09) La redirection gardait la copie locale « pour ne pas perdre les actions », mais la nouvelle
// adresse ne peut pas lire le stockage de l'ancienne : ces actions ne pouvaient plus jamais partir.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { U, boot, resetStore, fakeBackend, cleanup, sleep } from './sync-harness.mjs';

afterEach(cleanup);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

// Faux IndexedDB : { nomDeBase: { cle: valeur } } — juste ce que la page utilise.
function fauxIDB(bases, { sansListe = false } = {}) {
  const ouvertes = [];
  const idb = {
    open(nom) {
      const r = {};
      setTimeout(() => {
        const donnees = bases[nom];
        if (!donnees) { r.transaction = { abort() {} }; if (r.onupgradeneeded) r.onupgradeneeded(); if (r.onerror) r.onerror(); return; }
        const db = {
          objectStoreNames: { contains: (s) => s === 'kv' },
          close() {},
          transaction: () => ({ objectStore: () => ({ getAll(plage) {
            const q = {};
            setTimeout(() => { q.result = Object.keys(donnees).filter((k) => k >= plage.lo && k <= plage.hi).map((k) => donnees[k]); q.onsuccess(); }, 1);
            return q;
          } }) }),
        };
        ouvertes.push(nom);
        r.result = db; r.onsuccess();
      }, 1);
      return r;
    },
  };
  if (!sansListe) idb.databases = async () => Object.keys(bases).map((name) => ({ name, version: 1 }));
  return { idb, ouvertes };
}

async function lancerPage(bases, opts = {}) {
  const { idb, ouvertes } = fauxIDB(bases, opts);
  let cible = null;
  const ls = new Map([['p3d_supabase', 'x'], ['autre_site', 'y']]);
  const ctx = vm.createContext({
    window: {}, indexedDB: idb, IDBKeyRange: { bound: (lo, hi) => ({ lo, hi }) },
    localStorage: { removeItem: (k) => ls.delete(k), getItem: (k) => ls.get(k) },
    location: { hash: opts.hash || '', replace: (u) => { cible = u; } },
    document: { getElementById: () => ({ set textContent(v) { ctx.__msg = v; } }) },
    setTimeout, Promise, JSON, btoa, unescape, encodeURIComponent, Object,
  });
  ctx.window.indexedDB = idb;
  Object.defineProperty(ctx.localStorage, 'keys', { value: () => [...ls.keys()] });
  vm.runInContext('Object.keys = (function(k){ return function(o){ return o && o.keys ? o.keys() : k(o); }; })(Object.keys);', ctx);
  vm.runInContext(SCRIPT, ctx);
  for (let i = 0; i < 100 && !cible; i++) await sleep(5);
  return { cible, ouvertes, ls, msg: ctx.__msg };
}

const b64Decode = (s) => JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
const VENTE = { id: 'op-1', type: 'sale.record', status: 'pending', seq: 3, created_at: '2026-09-18T20:00:00Z',
  payload: { id: 's-1', channel: 'direct', items: [{ id: 'i-1', item_name: 'Vaso ção', quantity: 1, unit_price: 20, unit_cost: 3, from_stock: false }] } };

test('page de l’ancienne adresse : les actions en attente partent avec la redirection', async () => {
  const bases = { 'paulo3d:ref:u1': { 'op:op-1': VENTE, 'meta:x': { a: 1 } }, 'autre-site:z': { 'op:zz': { id: 'zz' } } };
  const r = await lancerPage(bases);
  assert.ok(r.cible && r.cible.startsWith('https://paulo3d.up.railway.app/#p3d-import='), r.cible);
  const p = b64Decode(r.cible.split('#p3d-import=')[1]);
  assert.deepEqual(p, [{ db: 'paulo3d:ref:u1', ops: [VENTE] }], 'seules les actions (op:…) de Paulo3D, accents intacts');
  assert.deepEqual(r.ouvertes, ['paulo3d:ref:u1'], 'les bases des autres sites ne sont jamais ouvertes');
  assert.ok(!r.ls.has('p3d_supabase') && r.ls.has('autre_site'), 'la session partagée est effacée, pas le reste');
  assert.match(r.msg, /1 ação ainda não enviada/);
});

test('page de l’ancienne adresse : rien en attente -> redirection simple, lien d’origine gardé', async () => {
  const r = await lancerPage({ 'paulo3d:ref:u1': { 'meta:x': {} } }, { hash: '#/bobines?peser=abc' });
  assert.equal(r.cible, 'https://paulo3d.up.railway.app/#/bobines?peser=abc');
});

test('page de l’ancienne adresse : navigateur sans liste des bases -> redirection simple (jamais bloquée)', async () => {
  const r = await lancerPage({ 'paulo3d:ref:u1': { 'op:op-1': VENTE } }, { sansListe: true });
  assert.equal(r.cible, 'https://paulo3d.up.railway.app/');
});

function nouvelleAppli(lien) {
  const w = boot();
  resetStore(w.Store, w.app);
  w.Store.dbName = 'paulo3d:ref:u1';
  const envoyes = [];
  // (la relecture d'un compte vide ajoute « réglages par défaut » : on ne compte que les actions reprises)
  w.Sync.backend = fakeBackend((n, op) => { if (String(op.id).startsWith('op-')) envoyes.push(op.id); return { sales: [] }; });
  const ss = new Map();
  w.G.sessionStorage = { getItem: (k) => (ss.has(k) ? ss.get(k) : null), setItem: (k, v) => ss.set(k, String(v)), removeItem: (k) => ss.delete(k) };
  let adresse = null;
  w.G.location = { hash: lien, pathname: '/', search: '', reload() {} };
  w.G.history = { replaceState: (a, b, u) => { adresse = u; } };
  const Boot = w.get('Boot');
  return { ...w, Boot, envoyes, ss, adresse: () => adresse };
}
const lienDe = (paquets) => '#p3d-import=' + Buffer.from(JSON.stringify(paquets), 'utf8').toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

test('nouvelle appli : les actions de l’ancienne adresse reprennent leur place dans la file, et partent', async () => {
  const w = nouvelleAppli(lienDe([{ db: 'paulo3d:ref:u1', ops: [VENTE] }]));
  w.Boot.captureOldAddressImport();
  assert.equal(w.adresse(), '/#/', 'le lien est nettoyé tout de suite (il ne reste pas dans l’historique)');
  await w.Boot.importOldAddress();
  await sleep(30);
  assert.deepEqual(w.envoyes, ['op-1'], 'la vente faite sur l’ancienne adresse est envoyée');
  assert.ok(w.toasts.some((t) => /1 action faite sur l'ancienne adresse a été récupérée/.test(t.message)), JSON.stringify(w.toasts));
  // L'icône installée pointe encore vers l'ancienne adresse : le même paquet revient à la prochaine ouverture.
  w.G.location.hash = lienDe([{ db: 'paulo3d:ref:u1', ops: [VENTE] }]);
  w.Boot.captureOldAddressImport();
  await w.Boot.importOldAddress();
  await sleep(30);
  assert.deepEqual(w.envoyes, ['op-1'], 'une action déjà reprise n’est jamais renvoyée');
});

test('nouvelle appli : actions d’un AUTRE compte -> rien importé, message clair, gardées pour la bonne connexion', async () => {
  const w = nouvelleAppli(lienDe([{ db: 'paulo3d:ref:autre', ops: [VENTE] }]));
  w.Boot.captureOldAddressImport();
  await w.Boot.importOldAddress();
  assert.equal(w.Store.Q.length, 0);
  assert.ok(w.toasts.some((t) => /autre compte/.test(t.message)));
  assert.ok([...w.ss.values()].length === 1, 'le paquet reste en attente (onglet) pour une connexion au bon compte');
});

test('nouvelle appli : lien abîmé ou type d’action inconnu -> ignoré sans planter', async () => {
  const w = nouvelleAppli('#p3d-import=%%%');
  w.Boot.captureOldAddressImport();
  await w.Boot.importOldAddress();
  const w2 = nouvelleAppli(lienDe([{ db: 'paulo3d:ref:u1', ops: [{ ...VENTE, id: 'op-x', type: 'inconnu.bidon' }] }]));
  w2.Boot.captureOldAddressImport();
  await w2.Boot.importOldAddress();
  assert.equal(w2.Store.Q.length, 0);
  assert.equal(U.length > 0, true);
});
