// Tests de la synchronisation réelle (file d'envoi, session expirée, suppressions, copie locale).
// Lancer : node tools/build.mjs --dev && node --test tests/sync.test.mjs
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { boot, resetStore, U, sleep, httpErr, fakeSb, fakeBackend, cleanup } from './sync-harness.mjs';

afterEach(cleanup);

// attend la fin d'un envoi en cours (sa fin est asynchrone : un nouvel envoi lancé trop tôt serait reporté)
const idle = async (Sync) => {
  for (let i = 0; Sync.state.flushing && i < 1000; i++) await sleep(5);
};
const sends = (backend, type = 'sale.record') => backend.calls.filter((t) => t === type).length;

const salePayload = (app) => ({
  id: app.uuid(), channel: 'direct',
  items: [{ id: app.uuid(), item_name: 'Vase', quantity: 1, unit_price: 20, unit_cost: 3, from_stock: false }],
});

test('session expirée puis refus de la base : l’action refusée n’est PAS renvoyée au redémarrage (pas de doublon)', async () => {
  const { app, Store, Sync } = boot();
  resetStore(Store, app);
  const backend = fakeBackend((n) => {
    if (n === 1) throw httpErr(401, 'PGRST303', 'JWT expired');
    if (n === 2) throw httpErr(400, 'P3D01', 'Stock insuffisant');
    return { sales: [] };
  });
  Sync.backend = backend;
  const res = await Sync.enqueue('sale.record', salePayload(app), { wait: 500 });
  assert.equal(res.state, 'failed');
  assert.equal(Store.Q[0].authRetried, false, 'le drapeau de nouvel essai est effacé quand l’action se termine');
  Sync.start(backend);
  await sleep(100);
  await idle(Sync);
  Sync.stop();
  assert.equal(sends(backend), 2, 'aucun envoi de plus');
  assert.equal(Store.Q.find((o) => o.type === 'sale.record').status, 'failed');
});

test('session expirée, coupure réseau, puis nouvelle expiration : la session est de nouveau rafraîchie et l’action part', async () => {
  const { app, Store, Sync } = boot();
  resetStore(Store, app);
  let refreshes = 0;
  const backend = fakeBackend((n) => {
    if (n === 1) throw httpErr(401, 'PGRST303', 'JWT expired');
    if (n === 2) throw httpErr(0, '', 'Failed to fetch');
    if (n === 3) throw httpErr(401, 'PGRST303', 'JWT expired');
    return { sales: [] };
  }, { refreshAuth: async () => { refreshes++; return 'ok'; } });
  Sync.backend = backend;
  const r = await Sync.enqueue('sale.record', salePayload(app), { wait: 200 });
  assert.equal(r.state, 'queued');
  await idle(Sync);
  clearTimeout(Sync.retryTimer);
  Sync.retryDelay = 0;
  await Sync.flush();
  await idle(Sync);
  assert.equal(refreshes, 2, 'chaque expiration a droit à son rafraîchissement');
  assert.equal(Store.Q.length, 0, 'action envoyée');
  assert.equal(Sync.failedWhileAway, 0);
});

test('session expirée (vraie) : l’action repart après reconnexion, une seule fois', async () => {
  const { app, Store, Sync } = boot();
  resetStore(Store, app);
  let sessionOk = false;
  const backend = fakeBackend(() => {
    if (!sessionOk) throw httpErr(401, 'PGRST303', 'JWT expired');
    return { sales: [] };
  }, { refreshAuth: async () => (sessionOk ? 'ok' : 'invalid') });
  Sync.backend = backend;
  const r = await Sync.enqueue('sale.record', salePayload(app), { wait: 300 });
  assert.equal(r.state, 'queued');
  assert.equal(Sync.state.needsLogin, true);
  sessionOk = true;
  await idle(Sync);
  Sync.start(backend);
  await sleep(100);
  await idle(Sync);
  Sync.stop();
  assert.equal(Store.Q.filter((o) => o.type === 'sale.record').length, 0);
  assert.equal(sends(backend), 2);
});

test('modification d’une bobine que la base n’a pas (0 ligne modifiée) : refusée, jamais annoncée « enregistrée »', async () => {
  const { app, get, Store, Sync } = boot();
  resetStore(Store, app);
  const SupabaseBackend = get('SupabaseBackend');
  const sb = fakeSb((q) => {
    const verbs = q.ops.map((o) => o[0]).join('.');
    if (q.table === 'spools' && verbs.startsWith('upsert')) return { data: null, error: { code: '23514', message: 'check constraint' }, status: 400 };
    return { data: [], error: null, status: 200 };
  });
  const b = Object.assign(Object.create(SupabaseBackend.prototype), { kind: 'supabase', userId: null, sb });
  Sync.backend = b;
  const id = app.uuid();
  await Sync.enqueue('spool.save', { id, brand: 'X', material: 'PLA', color_name: 'Noir', color_hex: '#000000', price: 20, initial_weight_g: 1000, archived: false }, { wait: 20 });
  await Sync.enqueue('spool.patch', { id, fields: { archived: true } }, { wait: 20 });
  b.userId = U;
  await idle(Sync);
  await Sync.flush();
  await idle(Sync);
  assert.deepEqual(Store.Q.map((o) => `${o.type}:${o.status}`), ['spool.save:failed', 'spool.patch:failed']);
  assert.equal(Sync.confirmedWhileAway, 0);
  assert.match(Store.Q[1].error.message, /n'existe plus/);

  const saved = await Sync.enqueue('template.save', { id: app.uuid(), name: 'T', materials: [] }, { wait: 500 });
  assert.equal(saved.state, 'failed', 'enregistrement bloqué par le registre des suppressions (0 ligne) = refus');
});

test('bobine supprimée sur un autre appareil puis modifiée ici : refus expliqué et bobine retirée de l’écran', async () => {
  const { app, get, Store, Sync } = boot();
  resetStore(Store, app);
  const SupabaseBackend = get('SupabaseBackend');
  const sb = fakeSb(() => ({ data: [], error: null, status: 200 }));
  Sync.backend = Object.assign(Object.create(SupabaseBackend.prototype), { kind: 'supabase', userId: U, sb });
  const X = app.uuid();
  Store.upsertRows('spools', [{ id: X, owner_id: U, brand: 'B', material: 'PLA', color_name: 'Rouge', color_hex: '#FF0000', price: 20, initial_weight_g: 1000, archived: false, updated_at: '2026-09-16T10:00:00.000001Z' }]);
  Store.rebuild();
  assert.equal(Store.V.spools.has(X), true);
  const r = await Sync.enqueue('spool.patch', { id: X, fields: { archived: true } }, { wait: 500 });
  assert.equal(r.state, 'failed');
  assert.match(r.error.message, /Cette bobine n'existe plus \(supprimée sur un autre appareil/);
  assert.equal(Store.V.spools.has(X), false, 'plus affichée');
});

test('action rejouée sur un élément supprimé ailleurs : annoncée comme ignorée, pas comme enregistrée', async () => {
  const { app, get, Store, Sync, toasts } = boot();
  resetStore(Store, app);
  Sync.backend = fakeBackend(() => ({ tombstoned: true }));
  const runOp = get('runOp');
  const res = await runOp('sale.record', salePayload(app), { success: 'Vente enregistrée' });
  assert.equal(res.tombstoned, true);
  assert.equal(toasts.at(-1).tone, 'warn');
  assert.doesNotMatch(toasts.at(-1).message, /Vente enregistrée/);

  // réponse arrivée plus tard (plus personne n'attend) : compteur « ignorées », pas « enregistrées »
  Sync.backend = fakeBackend(() => { throw httpErr(0, '', 'Failed to fetch'); });
  await Sync.enqueue('sale.record', salePayload(app), { wait: 50 });
  await idle(Sync);
  clearTimeout(Sync.retryTimer);
  Sync.backend = fakeBackend(() => ({ tombstoned: true }));
  Sync.confirmedWhileAway = 0;
  await Sync.flush();
  await idle(Sync);
  assert.equal(Sync.skippedWhileAway, 1);
  assert.equal(Sync.confirmedWhileAway, 0);
});

test('ligne supprimée pendant une relecture qui en avait lu une version plus récente : elle ne revient pas', async () => {
  const { app, Store, Sync } = boot();
  resetStore(Store, app);
  const X = app.uuid();
  const base = { id: X, owner_id: U, brand: 'B', material: 'PLA', color_name: 'Noir', color_hex: '#000000', price: 20, initial_weight_g: 1000, tare_g: null, remaining_weight_g: 1000, archived: false, created_at: '2026-09-16T10:00:00.000001Z' };
  const t1 = '2026-09-16T10:00:00.000001+00:00';
  const t2 = '2026-09-16T10:05:00.000001+00:00';
  Store.upsertRows('spools', [{ ...base, updated_at: t1 }]);
  Store.upsertRows('settings', [{ owner_id: U, ...app.DEFAULT_SETTINGS, updated_at: t1 }]);
  Store.meta = { lastPull: { spools: t1 }, lastReconcile: 0 };
  Store.rebuild(true);
  let release;
  const gate = new Promise((r) => { release = r; });
  Sync.backend = fakeBackend(() => ({}), {
    async pullTable(t) {
      if (t === 'spools') {
        await gate;
        return [{ ...base, archived: true, updated_at: t2 }];
      }
      return [];
    },
    async pullIds(t) { return t === 'settings' ? new Set([U]) : new Set(); },
  });
  const pulling = Sync.pull();
  await sleep(5);
  Sync.onRealtime({ table: 'spools', eventType: 'DELETE', old: { id: X } });
  release();
  await pulling;
  await sleep(200);
  Sync.stop();
  assert.equal(Store.S.spools.has(X), false);
  assert.equal(Store.V.spools.has(X), false);
  // et une version encore plus récente juste après ne la fait pas revenir non plus
  assert.equal(Store.upsertRows('spools', [{ ...base, updated_at: '2026-09-16T10:06:00.000001+00:00' }]), 0);
});

test('copie locale : chaque table est écrite avec SON repère de relecture (deux onglets ne se mélangent pas)', async () => {
  const { app, get, Store } = boot();
  resetStore(Store, app);
  const IDB = get('IDB');
  const writes = [];
  IDB.setMany = async (db, entries) => { writes.push(entries); };
  Store.db = {};
  Store.meta = { lastPull: { sales: '2026-09-16T10:00:00.000001Z', spools: '2026-09-16T09:00:00.000001Z' }, lastReconcile: 123 };
  Store.upsertRows('sales', [{ id: app.uuid(), owner_id: U, amount: 10, cogs: 1, updated_at: '2026-09-16T10:00:00.000001Z' }]);
  await Store.persistSnapshotNow();
  const keys = Object.fromEntries(writes[0]);
  assert.ok(Array.isArray(keys['snap:sales']));
  assert.equal(keys['pull:sales'], '2026-09-16T10:00:00.000001Z');
  assert.equal(keys['snap:spools'], undefined, 'table inchangée : ni lignes ni repère réécrits');
  assert.equal(keys['pull:spools'], undefined);
  assert.equal(keys.meta.lastPull, undefined, 'plus de repères globaux dans « meta »');
  assert.equal(keys.meta.lastReconcile, 123);
});

test('file d’envoi : une action que l’appareil n’a pas pu garder n’est jamais envoyée', async () => {
  const { app, get, Store, Sync } = boot();
  resetStore(Store, app);
  const IDB = get('IDB');
  IDB.setMany = async () => { throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); };
  Store.db = {};
  Store.volatile = false;
  const backend = fakeBackend(() => ({ sales: [] }));
  Sync.backend = backend;
  const res = await Sync.enqueue('sale.record', salePayload(app), { wait: 100 });
  assert.equal(res.state, 'rejected');
  assert.equal(Store.Q.length, 0);
  await idle(Sync);
  await Sync.flush();
  await idle(Sync);
  assert.equal(backend.calls.length, 0);
});

test('file d’envoi : une action en cours d’écriture (qui va échouer) n’est pas prise par un envoi déjà lancé', async () => {
  const { app, get, Store, Sync } = boot();
  resetStore(Store, app);
  const IDB = get('IDB');
  const disk = new Map();
  let failKey = null;
  IDB.setMany = async (db, entries) => {
    for (const [k] of entries) {
      if (k === failKey) {
        await sleep(60); // écriture lente qui finit en échec (mémoire pleine)
        throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
      }
    }
    for (const [k, v] of entries) disk.set(k, v);
  };
  IDB.delMany = async (db, keys) => { for (const k of keys) disk.delete(k); };
  IDB.getPrefix = async (db, prefix) => [...disk.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
  Store.db = {};
  Store.volatile = false;
  const backend = fakeBackend(async () => {
    await sleep(25); // premier envoi en cours pendant l'écriture de la seconde action
    return { sales: [] };
  });
  Sync.backend = backend;
  const first = Sync.enqueue('sale.record', salePayload(app), { wait: 1000 });
  await sleep(5);
  const second = salePayload(app);
  const realUuid = app.uuid;
  let nextId = null;
  // identifiant de l'action connu d'avance pour faire échouer SON écriture
  const F = app.uuid.constructor;
  new F('u', 'set', 'globalThis.__p3dUuid = u; uuid = () => { const id = u(); set(id); return id; }')(realUuid, (id) => { if (!nextId) { nextId = id; failKey = `op:${id}`; } });
  const res = await Sync.enqueue('sale.record', second, { wait: 300 });
  new F('uuid = globalThis.__p3dUuid')();
  await first;
  await idle(Sync);
  assert.equal(res.state, 'rejected');
  assert.equal(sends(backend), 1, 'seule l’action réellement gardée est envoyée');
});

test('démo : un échec pendant le remplissage des exemples ne bloque pas le démarrage', async () => {
  const { app, get, ls, toasts, Sync } = boot();
  const Boot = get('Boot');
  const App = get('App');
  const Screens = get('Screens');
  App.start = () => {};
  Screens.hide = () => {};
  ls.set('p3d_mode', JSON.stringify('demo'));
  let writes = 0;
  app.DemoBackend.prototype.save = async function save() {
    writes++;
    if (writes === 12) throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
  };
  await Boot.route();
  Sync.stop();
  assert.equal(ls.get('p3d_demo_seeded'), undefined, 'pas marqué « rempli » : réessayé à la prochaine ouverture si la démo est vide');
  assert.ok(toasts.some((t) => t.tone === 'warn' && /exemples/.test(t.message)));
});
