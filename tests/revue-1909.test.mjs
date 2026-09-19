// Revue du 19/09 : trois défauts des commits de la nuit. Code RÉEL (.dev/app.js).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { U, boot, resetStore, fakeBackend, cleanup, sleep } from './sync-harness.mjs';

afterEach(cleanup);
const T0 = '2026-09-19T10:48:02.000001+00:00';

test('ouverture : code déjà activé sur ce compte -> aucune attente du réseau avant d’entrer', async () => {
  const { get } = boot();
  get('SITE').mfaRequired = '1';
  const Mfa = get('Mfa');
  let serveur = 0;
  const backend = { sb: { auth: {
    getSession: async () => ({ data: { session: { user: { id: U, factors: [{ id: 'f1', status: 'verified', factor_type: 'totp' }] } } } }),
    mfa: { listFactors: () => { serveur++; return new Promise(() => {}); } },   // 4G faible : ne répond jamais
  } } };
  const t0 = Date.now();
  const r = await Promise.race([Mfa.needsEnroll(backend), sleep(500).then(() => 'bloqué')]);
  assert.equal(r, false, 'pas d’activation à demander, et pas d’attente');
  assert.equal(serveur, 0, 'le serveur n’est même pas interrogé');
  assert.ok(Date.now() - t0 < 200);
  // compte sans code sur cet appareil : on demande bien au serveur (première activation)
  const sans = { sb: { auth: {
    getSession: async () => ({ data: { session: { user: { id: U, factors: [] } } } }),
    mfa: { listFactors: async () => { serveur++; return { data: { totp: [] } }; } },
  } } };
  assert.equal(await Mfa.needsEnroll(sans), true);
  assert.equal(serveur, 1);
});

test('commande livrée ailleurs puis « Annuler » ici : pas de « Commande annulée », l’état réel est dit', async () => {
  const { app, get, Store, Sync, toasts } = boot();
  resetStore(Store, app);
  const O = app.uuid();
  Store.upsertRows('orders', [{ id: O, owner_id: U, status: 'ready', item_name: 'Vase', quantity: 1, sale_id: null, created_at: T0, updated_at: T0 }]);
  Store.rebuild(true);
  // la base : la commande a été livrée sur l'autre appareil -> condition « todo/ready » non remplie
  Sync.backend = fakeBackend((n, op) => (op.type === 'order.patch'
    ? { orders: [{ id: O, owner_id: U, status: 'delivered', item_name: 'Vase', quantity: 1, sale_id: app.uuid(), created_at: T0, updated_at: T0 }], inchange: { status: 'delivered' } }
    : {}));
  const res = await get('runOp')('order.patch', { id: O, fields: { status: 'cancelled' }, from: ['todo', 'ready'] }, { success: 'Commande annulée' });
  assert.equal(res.state, 'confirmed');
  const msgs = toasts.map((t) => t.message);
  assert.ok(!msgs.includes('Commande annulée'), JSON.stringify(msgs));
  assert.ok(msgs.some((m) => /Rien n'a été modifié.*« Livrée »/.test(m)), JSON.stringify(msgs));
  assert.equal(Store.V.orders.get(O).status, 'delivered', 'l’appareil montre l’état réel');
});

test('vente d’une commande livrée supprimée : la commande n’est pas tamponnée à l’heure du téléphone', () => {
  const { app } = boot();
  const V = app.emptyState();
  const S = app.uuid(), O = app.uuid();
  V.sales.set(S, { id: S, owner_id: U, updated_at: T0 });
  V.orders.set(O, { id: O, owner_id: U, status: 'delivered', sale_id: S, updated_at: T0 });
  app.OPS['sale.delete'].apply(V, { id: S }, { now: '2026-09-19T10:50:02.000001+00:00', userId: U });   // téléphone en avance
  const o = V.orders.get(O);
  assert.equal(o.status, 'ready', 'la commande redevient « prête » (même règle que la base)');
  assert.equal(o.sale_id, null);
  assert.equal(o.updated_at, T0, 'la date reste celle de la base : sa version plus récente gagnera');
});
