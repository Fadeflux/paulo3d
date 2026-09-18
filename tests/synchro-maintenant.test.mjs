// Bouton « Synchroniser maintenant » (panneau Synchronisation) : le message annonce ce qui est VRAI.
// Code RÉEL (.dev/app.js) ; faux client de base piloté par le test.
//
// ⚠️ (18/09) Le bouton affichait « Synchronisation terminée » dès que la connexion semblait bonne :
// pendant qu'une vente lente partait encore (elle pouvait ensuite échouer), et même quand RIEN
// n'était parti (session expirée) — l'utilisateur fermait l'appli en croyant tout enregistré.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { U, boot, resetStore, sleep, fakeBackend, httpErr, cleanup } from './sync-harness.mjs';

afterEach(cleanup);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Compte déjà réglé (sinon la relecture ajoute « réglages par défaut » à la file et fausse les comptes)
const T = '2026-09-18T10:00:00.000001+00:00';
function monde(script) {
  const { app, Store, Sync } = boot();
  resetStore(Store, app);
  const reglages = () => [{ owner_id: U, ...app.DEFAULT_SETTINGS, updated_at: T }];
  Store.upsertRows('settings', reglages());
  Store.rebuild(true);
  const backend = fakeBackend(script, {
    pullTable: async (t) => (t === 'settings' ? reglages() : []),
    pullIds: async (t) => (t === 'settings' ? new Set([U]) : new Set()),
  });
  Sync.backend = backend;
  return { app, Store, Sync, backend };
}
const vente = (app) => ({ id: app.uuid(), channel: 'direct', items: [{ id: app.uuid(), item_name: 'Vase', quantity: 1, unit_price: 20, unit_cost: 3, from_stock: false }] });
// Banc : la file ne contient que la vente du test (rien d'ajouté en douce par la relecture)
const seuleLaVente = (Store) => assert.deepEqual(Store.Q.map((o) => o.type), ['sale.record']);

test('envoi lent déjà en cours : le bouton attend sa fin avant d’annoncer « terminée »', async () => {
  let liberer;
  const { app, Store, Sync, backend } = monde(() => new Promise((r) => { liberer = () => r({ sales: [] }); }));
  const r = await Sync.enqueue('sale.record', vente(app), { wait: 50 });
  assert.equal(r.state, 'queued', 'la base répond lentement');
  seuleLaVente(Store);
  setTimeout(() => liberer(), 400);                   // la base finit par répondre
  const v = await Sync.syncNow({ maxWait: 5000 });
  assert.equal(backend.calls.length, 1);
  assert.equal(Store.Q.length, 0, 'la vente est enregistrée au moment du message');
  assert.deepEqual({ ...v }, { tone: 'ok', message: 'Synchronisation terminée' });
});

test('envoi bloqué : pas de « terminée », le bouton dit que c’est toujours en cours', async () => {
  let liberer;
  const { app, Store, Sync } = monde(() => new Promise((r) => { liberer = () => r({ sales: [] }); }));
  await Sync.enqueue('sale.record', vente(app), { wait: 50 });
  const v = await Sync.syncNow({ maxWait: 300 });
  seuleLaVente(Store);
  assert.equal(Store.Q[0].status, 'sending');
  assert.deepEqual({ ...v }, { tone: 'warn', message: 'Toujours en cours : la base répond lentement' });
  liberer(); await sleep(20);
});

test('session expirée : rien n’est parti, le bouton demande de se reconnecter', async () => {
  const { app, Store, Sync, backend } = monde(() => ({ sales: [] }));
  Sync.state.needsLogin = true;
  await Sync.enqueue('sale.record', vente(app), { wait: 50 });
  const v = await Sync.syncNow({ maxWait: 1000 });
  seuleLaVente(Store);
  assert.equal(backend.calls.length, 0, 'aucun envoi');
  assert.deepEqual({ ...v }, { tone: 'bad', message: "Reconnecte-toi : 1 action en attente, rien n'est parti" });
});

test('pas de réseau : « Toujours pas de connexion » avec le nombre d’actions en attente', async () => {
  const { app, Store, Sync } = monde(() => { throw httpErr(0, '', 'Failed to fetch'); });
  await Sync.enqueue('sale.record', vente(app), { wait: 50 });
  const v = await Sync.syncNow({ maxWait: 1000 });
  seuleLaVente(Store);
  assert.deepEqual({ ...v }, { tone: 'warn', message: 'Toujours pas de connexion · 1 action en attente' });
});

test('action refusée par la base : annoncée, pas de « terminée » tout court', async () => {
  const { app, Store, Sync } = monde(() => { throw httpErr(400, 'P3D01', 'Stock insuffisant'); });
  await Sync.enqueue('sale.record', vente(app), { wait: 50 });
  const v = await Sync.syncNow({ maxWait: 1000 });
  seuleLaVente(Store);
  assert.equal(Store.Q[0].status, 'failed');
  assert.deepEqual({ ...v }, { tone: 'bad', message: '1 action refusée : voir ci-dessous' });
});

test('tout est parti : « Synchronisation terminée »', async () => {
  const { app, Store, Sync } = monde(() => ({ sales: [] }));
  await Sync.enqueue('sale.record', vente(app), { wait: 2000 });
  const v = await Sync.syncNow({ maxWait: 1000 });
  assert.equal(Store.Q.length, 0);
  assert.deepEqual({ ...v }, { tone: 'ok', message: 'Synchronisation terminée' });
});

test('le bouton du panneau affiche bien ce verdict (et plus son ancien calcul)', () => {
  const src = fs.readFileSync(path.join(ROOT, '.dev', 'app.js'), 'utf8');
  const i = src.indexOf("btn('Synchroniser maintenant'");
  assert.ok(i > 0, 'bouton trouvé');
  const bloc = src.slice(src.indexOf('now: async (el) => {', i), src.indexOf('retry: (el) =>', i));
  assert.ok(bloc.includes('await Sync.syncNow()'), bloc);
  assert.ok(bloc.includes('toast(v.message, { tone: v.tone })'), bloc);
  assert.ok(!bloc.includes('Sync.state.online ?'), 'ancien message « terminée » dès que la connexion semble bonne');
});
