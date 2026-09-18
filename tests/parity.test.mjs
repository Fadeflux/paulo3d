// Même scénario joué (1) par l'appli (calcul hors-ligne) et (2) par la vraie base PostgreSQL.
// Les poids restants, stocks, coûts et marges doivent être IDENTIQUES.
// Lancer : node tools/build.mjs --dev && node --test tests/parity.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startPostgres, asUser, SCHEMA_SQL, STUBS_SQL } from './pg-harness.mjs';
import { loadApp, applyOps } from './load-app.mjs';

const app = loadApp();
const USER = randomUUID();
let db;
let client;

before(async () => {
  db = await startPostgres({ port: 54393 });
  client = await db.connect();
  await client.query(STUBS_SQL);
  await client.query(SCHEMA_SQL);
  await client.query('insert into auth.users (id, email) values ($1, $2)', [USER, 'parite@test.local']);
});

after(async () => {
  await client?.end();
  await db?.stop();
});

// Rejoue une action côté base, exactement comme l'appli l'envoie à Supabase (REMOTE)
async function sqlApply(type, p) {
  return asUser(client, USER, async (c) => {
    const rpc = (fn, arg, argName = 'p') => c.query(`select public.${fn}($1::${argName === 'p' ? 'jsonb' : 'uuid'}) as r`, [argName === 'p' ? JSON.stringify(arg) : arg]);
    const upsert = async (table, row, conflict = 'id') => {
      const cols = Object.keys(row);
      const vals = cols.map((k) => (row[k] !== null && typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k]));
      const sql = `insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})
                   on conflict (${conflict}) do update set ${cols.filter((k) => k !== conflict).map((k) => `${k} = excluded.${k}`).join(', ')}`;
      await c.query(sql, vals);
    };
    switch (type) {
      case 'settings.save': return upsert('settings', { owner_id: USER, ...app.pick(p, app.SETTINGS_FIELDS) }, 'owner_id');
      case 'machine.save': return upsert('machines', app.pick(p, app.MACHINE_FIELDS));
      case 'spool.save': return upsert('spools', app.pick(p, app.SPOOL_FIELDS));
      case 'template.save': return upsert('templates', app.pick(p, app.TEMPLATE_FIELDS));
      case 'spool.weigh': return rpc('p3d_weigh_spool', p);
      case 'production.launch': return rpc('p3d_launch_production', p);
      case 'production.delete': return rpc('p3d_delete_production', p.id, 'p_id');
      case 'stock.add': return rpc('p3d_add_stock', p);
      case 'stock.adjust': return rpc('p3d_adjust_stock', p);
      case 'sale.record': return rpc('p3d_record_sale', p);
      case 'sale.delete': return rpc('p3d_delete_sale', p.id, 'p_id');
      case 'order.save': return upsert('orders', app.pick(p, app.ORDER_FIELDS));
      case 'order.patch': {
        // comme REMOTE['order.patch'] : jamais sale_id, et la condition d'état `from` appliquée par la base
        const f = app.pick(p.fields, app.ORDER_FIELDS.filter((k) => k !== 'id' && k !== 'sale_id'));
        const cols = Object.keys(f);
        const cond = Array.isArray(p.from) ? ` and status = any($${cols.length + 2}::text[])` : '';
        return c.query(`update public.orders set ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1${cond}`, [p.id, ...cols.map((k) => f[k]), ...(cond ? [p.from] : [])]);
      }
      case 'order.delete': return c.query('delete from public.orders where id = $1', [p.id]);
      default: throw new Error(`action non gérée : ${type}`);
    }
  });
}

const n = (v) => Math.round(Number(v) * 10000) / 10000;

test('scénario complet : l’appli et la base tombent sur les mêmes chiffres', async () => {
  const ops = [];
  let S = app.emptyState();
  const view = () => ({ ...app.cloneState(S), userId: USER, pending: new Set() });
  const run = async (type, payload) => {
    ops.push([type, payload]);
    S = applyOps(app, ops, USER);
    await sqlApply(type, payload);
  };

  await run('settings.save', { ...app.DEFAULT_SETTINGS, labor_rate: 18.5, machine_rate: 0.27 });
  const M = randomUUID();
  await run('machine.save', { id: M, name: 'P1S', model: 'P1S', hourly_rate: 0.3, is_default: true, archived: false });
  const sp = {};
  for (const [k, material, color, hex, price, w] of [
    ['noir', 'PLA', 'Noir', '#161616', 22.99, 1000], ['blanc', 'PLA', 'Blanc', '#F2F2F2', 19.5, 1000],
    ['or', 'PLA Silk', 'Or', '#C9A227', 26, 750], ['tpu', 'TPU', 'Noir', '#202020', 38.9, 500],
  ]) {
    sp[k] = randomUUID();
    await run('spool.save', { id: sp[k], brand: 'Test', material, color_name: color, color_hex: hex, price, initial_weight_g: w, tare_g: 245.5, purchased_at: '2026-08-01', notes: null, archived: false });
  }
  const T1 = randomUUID();
  const T2 = randomUUID();
  await run('template.save', {
    id: T1, name: 'Support multicolore', description: null, photo: null, machine_id: M, pieces_per_print: 4, purge_g: 7.3, hardware_cost: 0.47, print_time_min: 97.5, labor_min: 11,
    pricing_mode: null, price_coef: null, target_margin_pct: null, catalog_price: 13.9, archived: false,
    materials: [{ material: 'PLA', color_name: 'Noir', color_hex: '#161616', grams: 41.37, spool_id: sp.noir }, { material: 'PLA', color_name: 'Blanc', color_hex: '#F2F2F2', grams: 6.11, spool_id: sp.blanc }, { material: 'PLA Silk', color_name: 'Or', color_hex: '#C9A227', grams: 3.33, spool_id: sp.or }],
  });
  await run('template.save', {
    id: T2, name: 'Coque souple', description: null, photo: null, machine_id: null, pieces_per_print: 1, purge_g: 0, hardware_cost: 0, print_time_min: 55, labor_min: 3,
    pricing_mode: 'margin', price_coef: null, target_margin_pct: 60, catalog_price: null, archived: false,
    materials: [{ material: 'TPU', color_name: 'Noir', color_hex: '#202020', grams: 34.56, spool_id: sp.tpu }],
  });

  const produce = async (tid, quantity, when, kind = 'production', failedPct = 100) => {
    const V = view();
    const { payload } = app.planProduction(V, { template: V.templates.get(tid), quantity, kind, failedPct, occurredAt: when, reason: kind === 'failure' ? 'Spaghetti' : null });
    await run('production.launch', payload);
    return payload;
  };
  const sell = async (items, when, extra = {}) => {
    const V = view();
    const plan = app.planSale(V, { occurred_at: when, ...extra, items: items.map((i) => ({ id: randomUUID(), ...i })) });
    assert.equal(plan.shortages.length, 0, 'le scénario ne doit pas survendre');
    await run('sale.record', plan.payload);
    return plan.payload;
  };

  const pA = await produce(T1, 7, '2026-09-01T08:15:00Z');
  await produce(T1, 1, '2026-09-01T12:00:00Z', 'failure', 35);
  const pB = await produce(T2, 3, '2026-09-02T09:00:00Z');
  await run('spool.weigh', { id: randomUUID(), spool_id: sp.noir, measured_g: 612.4, occurred_at: '2026-09-02T18:00:00Z', note: null });
  await produce(T1, 5, '2026-09-02T10:00:00Z');
  await produce(T1, 3, '2026-09-03T10:00:00Z');
  await run('stock.add', { id: randomUUID(), template_id: T2, item_name: 'Coque souple', unit_cost: 2.1234, quantity: 2, note: 'stock initial', occurred_at: '2026-08-20T10:00:00Z' });
  const s1 = await sell([{ template_id: T1, item_name: 'Support multicolore', quantity: 4, unit_price: 13.9 }, { template_id: T2, item_name: 'Coque souple', quantity: 3, unit_price: 12.5 }], '2026-09-04T10:00:00Z', { channel: 'etsy', shipping_charged: 4.9, shipping_cost: 4.55, packaging_cost: 0.83, platform_fee: 2.37 });
  await sell([{ template_id: T1, item_name: 'Support multicolore', quantity: 6, unit_price: 12 }, { item_name: 'Pièce sur mesure', quantity: 1, unit_price: 35, from_stock: false, unit_cost: 7.77 }], '2026-09-05T10:00:00Z', { channel: 'direct' });
  await run('stock.adjust', { id: randomUUID(), template_id: T1, item_name: 'Support multicolore', quantity: 2, reason: 'casse', note: null, occurred_at: '2026-09-06T10:00:00Z' });
  await run('sale.delete', { id: s1.id });
  await sell([{ template_id: T2, item_name: 'Coque souple', quantity: 4, unit_price: 11 }], '2026-09-07T10:00:00Z');
  // pB a servi à la vente ci-dessus : l'annuler doit être refusé des deux côtés
  const refusJs = app.OPS['production.delete'].validate(view(), { id: pB.id });
  assert.equal(refusJs && refusJs.code, 'P3D02');
  await assert.rejects(sqlApply('production.delete', { id: pB.id }), (e) => e.code === 'P3D02');
  const pD = await produce(T1, 2, '2026-09-08T10:00:00Z');
  await run('production.delete', { id: pD.id });

  // Commandes : créées, prête, livrée (liée à sa vente), annulée, supprimée
  const O1 = randomUUID();
  const O2 = randomUUID();
  const O3 = randomUUID();
  const order = (id, extra) => ({ id, customer: '', template_id: null, item_name: 'Pièce', quantity: 1, unit_price: null, due_date: null, channel: null, note: null, status: 'todo', sale_id: null, ...extra });
  await run('order.save', order(O1, { customer: 'Marie', template_id: T1, item_name: 'Support multicolore', quantity: 2, unit_price: 13.9, due_date: '2026-09-10', channel: 'vinted', note: 'bleu' }));
  await run('order.save', order(O2, { item_name: 'Figurine sur mesure' }));
  await run('order.save', order(O3, { customer: 'Paul', template_id: T2, item_name: 'Coque souple', unit_price: 12.5, due_date: '2026-09-12' }));
  await run('order.patch', { id: O1, fields: { status: 'ready' }, from: ['todo'] });
  // livrer = UNE action : la vente porte la commande, la base livre la commande dans la même transaction
  const planO1 = app.planSale(view(), { occurred_at: '2026-09-09T10:00:00Z', channel: 'vinted', customer: 'Marie', items: [{ id: randomUUID(), template_id: T1, item_name: 'Support multicolore', quantity: 2, unit_price: 13.9 }] });
  const s3 = { ...planO1.payload, order_id: O1 };
  await run('sale.record', s3);
  // deuxième vente de la même commande (autre appareil, action partie en retard) : refusée des deux côtés
  const again = { ...app.planSale(view(), { occurred_at: '2026-09-09T11:00:00Z', channel: 'vinted', items: [{ id: randomUUID(), template_id: T1, item_name: 'Support multicolore', quantity: 1, unit_price: 13.9 }] }).payload, order_id: O1 };
  assert.equal(app.OPS['sale.record'].validate(view(), again).code, 'P3D11', 'appli : double vente refusée');
  await assert.rejects(sqlApply('sale.record', again), (e) => e.code === 'P3D11', 'base : double vente refusée');
  // « prête » partie en retard après la livraison : ignorée des deux côtés (la commande reste livrée)
  await run('order.patch', { id: O1, fields: { status: 'ready' }, from: ['todo'] });
  // modification d'une commande livrée : ses champs changent, pas son état
  await run('order.patch', { id: O1, fields: { note: 'bleu nuit' } });
  await run('order.patch', { id: O2, fields: { status: 'cancelled' }, from: ['todo', 'ready'] });
  // commande livrée puis vente supprimée : la commande redevient « prête », sans vente
  await run('order.patch', { id: O3, fields: { status: 'ready' }, from: ['todo'] });
  const planO3 = app.planSale(view(), { occurred_at: '2026-09-09T12:00:00Z', channel: 'direct', customer: 'Paul', items: [{ id: randomUUID(), template_id: T2, item_name: 'Coque souple', quantity: 1, unit_price: 12.5 }] });
  await run('sale.record', { ...planO3.payload, order_id: O3 });
  await run('sale.delete', { id: planO3.payload.id });
  const O4 = randomUUID();
  await run('order.save', order(O4, { item_name: 'À supprimer' }));
  await run('order.delete', { id: O4 });

  // Comparaison ligne à ligne
  const rows = async (table, order = 'id') => asUser(client, USER, async (c) => (await c.query(`select * from public.${table} order by ${order}`)).rows);

  const dbSpools = await rows('spools');
  for (const r of dbSpools) {
    const js = S.spools.get(r.id);
    assert.equal(n(js.remaining_weight_g), n(r.remaining_weight_g), `poids restant ${r.color_name}`);
    assert.equal(n(js.cost_per_g), n(r.cost_per_g), `coût au gramme ${r.color_name}`);
  }
  const dbLots = await rows('production_stock');
  assert.equal(dbLots.length, S.production_stock.size, 'nombre de lots');
  for (const r of dbLots) {
    const js = S.production_stock.get(r.id);
    assert.ok(js, `lot ${r.id} absent côté appli`);
    assert.equal(js.qty_available, r.qty_available, `stock du lot ${r.item_name} du ${r.occurred_at.toISOString()}`);
    assert.equal(n(js.unit_cost), n(r.unit_cost));
  }
  const dbSales = await rows('sales');
  assert.equal(dbSales.length, S.sales.size, 'nombre de ventes');
  for (const r of dbSales) {
    const js = S.sales.get(r.id);
    for (const k of ['amount', 'cogs', 'net_margin', 'shipping_cost', 'platform_fee']) assert.equal(n(js[k]), n(r[k]), `vente ${k}`);
  }
  const dbItems = await rows('sale_items');
  for (const r of dbItems) {
    const js = S.sale_items.get(r.id);
    assert.equal(n(js.cogs), n(r.cogs), `coût de revient de ${r.item_name}`);
    assert.equal(n(js.unit_cost), n(r.unit_cost));
  }
  const dbProds = await rows('productions');
  assert.equal(dbProds.length, S.productions.size);
  for (const r of dbProds) {
    const js = S.productions.get(r.id);
    for (const k of ['grams_total', 'material_cost', 'purge_cost', 'machine_cost', 'labor_cost', 'total_cost', 'unit_cost']) assert.equal(n(js[k]), n(r[k]), `production ${k}`);
  }
  const dbOrders = await rows('orders');
  assert.equal(dbOrders.length, S.orders.size, 'nombre de commandes (la supprimée absente des deux côtés)');
  const byId = Object.fromEntries(dbOrders.map((r) => [r.id, r]));
  assert.equal(byId[O1].status, 'delivered', 'base : livrée par sa vente, et restée livrée');
  assert.equal(byId[O1].sale_id, s3.id);
  assert.equal(byId[O1].note, 'bleu nuit');
  assert.equal(byId[O3].status, 'ready', 'base : vente supprimée → commande redevenue prête');
  assert.equal(byId[O3].sale_id, null);
  const ymd = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : d);
  for (const r of dbOrders) {
    const js = S.orders.get(r.id);
    assert.ok(js, `commande ${r.item_name} absente côté appli`);
    for (const k of ['status', 'sale_id', 'template_id', 'customer', 'item_name', 'channel', 'note']) assert.equal(js[k] ?? null, r[k] ?? null, `commande ${r.item_name} : ${k}`);
    assert.equal(js.quantity, r.quantity);
    assert.equal(js.unit_price === null ? null : n(js.unit_price), r.unit_price === null ? null : n(r.unit_price));
    assert.equal(js.due_date ?? null, r.due_date ? ymd(r.due_date) : null);
  }
  const adj = await rows('stock_adjustments');
  assert.equal(adj.length, S.stock_adjustments.size);
  const alloc = await rows('sale_allocations');
  assert.equal(alloc.length, S.sale_allocations.size, 'nombre de prélèvements dans le stock');
  const byLot = (list) => {
    const m = {};
    for (const a of list) m[a.lot_id] = (m[a.lot_id] || 0) + a.quantity;
    return m;
  };
  assert.deepEqual(byLot(alloc), JSON.parse(JSON.stringify(byLot([...S.sale_allocations.values()]))), 'mêmes lots prélevés');

  // Et les statistiques de l'appli, recalculées depuis les lignes de la BASE, donnent le même bénéfice
  const fromDb = app.emptyState();
  for (const t of app.TABLES) {
    for (const r of await rows(t, t === 'settings' ? 'owner_id' : 'id')) {
      const plain = JSON.parse(JSON.stringify(r, (k, v) => (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && k !== 'id' ? Number(v) : v)));
      fromDb[t].set(r[app.PK(t)], plain);
    }
  }
  const range = { start: new Date('2026-08-01T00:00:00Z'), end: new Date('2026-10-01T00:00:00Z') };
  const a = app.computeStats({ ...fromDb, userId: USER, pending: new Set() }, range);
  const b = app.computeStats({ ...app.cloneState(S), userId: USER, pending: new Set() }, range);
  for (const k of ['revenue', 'costs', 'net', 'gramsTotal', 'piecesMade', 'piecesFailed', 'piecesSold']) assert.equal(n(a[k]), n(b[k]), `statistique ${k}`);
  assert.ok(pA.total_cost > 0);
});
