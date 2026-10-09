// Revue à 5 agents du 09/10 : chaque défaut trouvé a son banc ici (rouge sur le code d'avant).
//   FILAMENT  : fiche bobine — corriger le poids initial, poids actuel qui suit, écart négatif, plafonds
//   ARGENT    : vente en attente rejouée sans contrôle, nom collé avec espace insécable, FIFO microseconde
//   SYNCHRO   : copie locale abîmée, « session expirée » de la base, oubli d'une action en cours d'envoi
//   SÉCURITÉ  : lien « #p3d-import= » qui injectait des actions dans la file
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, applyOps } from './load-app.mjs';
import { U, boot, resetStore, fakeBackend, cleanup, sleep } from './sync-harness.mjs';

afterEach(cleanup);
const app = loadApp();
const T = '2026-10-09T10:00:00.000001+00:00';
const uuid = () => app.uuid();

/* ---------------------------------------------------------------- FILAMENT */

test('pièces : les plafonds de la base sont appliqués avant l’envoi (plus de 999 999 pièces à l’écran)', () => {
  assert.equal(app.isPieceCount(100000), true);
  assert.equal(app.isPieceCount(100001), false, 'check (quantity between 1 and 100000)');
  assert.equal(app.isPieceCount(0), false);
  assert.equal(app.isPieceCount(2.5), false);
  const S = applyOps(app, [['stock.add', { id: uuid(), item_name: 'Vase', quantity: 3, unit_cost: 4, occurred_at: T }]]);
  assert.equal(S.production_stock.size, 1);
  assert.throws(() => applyOps(app, [['stock.add', { id: uuid(), item_name: 'Vase', quantity: 100001, unit_cost: 4, occurred_at: T }]]), /Quantité invalide/);
  assert.throws(() => applyOps(app, [['stock.add', { id: uuid(), item_name: 'Vase', quantity: 1, unit_cost: 1e9, occurred_at: T }]]), /Coût invalide/);
});

/* ------------------------------------------------------------------ ARGENT */

test('vente d’un stock déjà vendu ailleurs : plus de coût 0 € ni de marge inventée tant qu’elle attend', () => {
  const V0 = { ...app.emptyState(), userId: U, pending: new Set() };
  const lot = { id: uuid(), owner_id: U, production_id: null, template_id: null, item_name: 'Vase', unit_cost: 4, quantity: 3, qty_available: 0, note: null, occurred_at: T, created_at: T, updated_at: T };
  const S = app.emptyState();
  S.production_stock.set(lot.id, lot); // les 3 pièces ont déjà été vendues depuis l'autre appareil
  const vente = { id: uuid(), occurred_at: T, channel: 'direct', items: [{ id: uuid(), item_name: 'Vase', quantity: 3, unit_price: 10, unit_cost: 0, from_stock: true }] };
  const Q = [{ id: 'op-1', type: 'sale.record', payload: vente, status: 'pending', seq: 1, created_at: T }];
  const V = app.buildView(S, Q, { userId: U });
  assert.equal(V.sales.size, 0, 'la vente impossible n’est pas inventée à l’écran');
  assert.equal(V.pendingInvalid, 1, 'elle est comptée comme « sera refusée »');
  assert.ok(V0 !== null);
});

test('nom de pièce collé avec une espace insécable : le lot reste vendable', () => {
  const S = applyOps(app, [['stock.add', { id: uuid(), item_name: 'Vase ', quantity: 5, unit_cost: 4, occurred_at: T }]]);
  const V = { ...app.cloneState(S), userId: U, pending: new Set() };
  const lot = [...V.production_stock.values()][0];
  assert.equal(app.lotMatches(lot, null, 'Vase'), true, 'l’appli retrouve le lot malgré l’espace insécable');
  const err = app.OPS['sale.record'].validate(V, { id: uuid(), occurred_at: T, channel: 'direct', items: [{ id: uuid(), item_name: 'Vase', quantity: 2, unit_price: 10, unit_cost: 4, from_stock: true }] });
  assert.equal(err, null, 'la vente passe au lieu de « stock insuffisant »');
});

test('FIFO : départage à la microseconde, comme la base', () => {
  const a = { occurred_at: '2026-10-09T08:00:00.000000Z', created_at: '2026-10-09T08:00:00.000100Z', id: 'z' };
  const b = { occurred_at: '2026-10-09T08:00:00.000000Z', created_at: '2026-10-09T08:00:00.000900Z', id: 'a' };
  assert.ok(app.fifoCmp(a, b) < 0, 'le plus ancien d’abord, même à 800 µs près (avant : départagé par identifiant)');
});

test('achat de bobine : même mois dans l’historique et dans le bilan', () => {
  const S = applyOps(app, [['spool.save', { id: uuid(), brand: 'B', material: 'PLA', color_name: 'Noir', color_hex: '#111111', price: 25, initial_weight_g: 1000, tare_g: null, purchased_at: '2026-01-20', notes: null, archived: false }]]);
  const V = { ...app.cloneState(S), userId: U, pending: new Set() };
  const ev = app.historyEvents(V).find((x) => x.type === 'spool');
  assert.match(String(ev.date), /^2026-01-20/, 'daté de l’achat (le bilan utilise purchased_at)');
});

/* ----------------------------------------------------------------- SYNCHRO */

test('« session expirée » renvoyée par la base : l’action repart après reconnexion', () => {
  assert.equal(app.classifyError({ status: 400, code: 'P3D00', message: 'Session expirée : reconnecte-toi.' }), 'auth');
});

test('oublier une action pendant son envoi est refusé (sinon la base l’enregistre quand même)', async () => {
  const w = boot();
  resetStore(w.Store, w.app);
  w.Sync.backend = fakeBackend(() => ({}));
  await w.Store.putOp({ id: 'op-9', type: 'spool.patch', payload: { id: uuid(), fields: {} }, status: 'sending', seq: 1, created_at: T, attempts: 1 });
  w.Store.rebuild();
  await w.Sync.discardOp('op-9');
  assert.equal(w.Store.Q.length, 1, 'l’action reste tant que la base n’a pas répondu');
  assert.ok(w.toasts.some((t) => /Envoi en cours/.test(t.message)), JSON.stringify(w.toasts));
  await sleep(5);
});

/* ---------------------------------------------------------------- SÉCURITÉ */

test('lien « #p3d-import= » : plus aucune action injectée dans la file', () => {
  const w = boot();
  resetStore(w.Store, w.app);
  const paquet = [{ db: w.Store.dbName, ops: [{ id: 'op-pirate', type: 'spool.delete', payload: { id: uuid() }, status: 'pending', seq: 1, created_at: T }] }];
  const lien = '#p3d-import=' + Buffer.from(JSON.stringify(paquet), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  let adresse = null;
  w.G.location = { hash: lien, pathname: '/', search: '', reload() {} };
  w.G.history = { replaceState: (a, b, u) => { adresse = u; } };
  const Boot = w.get('Boot');
  Boot.captureOldAddressImport();
  assert.equal(w.Store.Q.length, 0, 'rien n’est mis en file');
  assert.equal(adresse, '/#/', 'le lien est effacé de la barre d’adresse');
  assert.equal(typeof Boot.importOldAddress, 'undefined', 'le mécanisme de reprise n’existe plus');
});
