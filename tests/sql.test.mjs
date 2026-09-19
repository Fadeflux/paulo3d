// Tests du script SQL sur un vrai PostgreSQL 17 local.
// Lancer : node --test tests/sql.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startPostgres, asUser, SCHEMA_SQL, STUBS_SQL } from './pg-harness.mjs';

let db, admin, other;
const A = randomUUID();
const B = randomUUID();
const ids = {};

const num = (v) => Number(v);
const one = async (c, sql, params) => (await c.query(sql, params)).rows[0];
const rpc = async (c, fn, arg) => (await c.query(`select public.${fn}($1) as r`, [arg])).rows[0].r;
const pgCode = async (promise) => {
  try { await promise; return null; } catch (e) { return e.code; }
};

before(async () => {
  db = await startPostgres({ port: 54391 });
  admin = await db.connect();
  other = await db.connect();
  await admin.query(STUBS_SQL);
  await admin.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [A, 'a@test.local', B, 'b@test.local']);
});

after(async () => {
  await admin?.end();
  await other?.end();
  await db?.stop();
});

test('le script s’exécute, puis se relance sans erreur ni perte', async () => {
  await admin.query(SCHEMA_SQL);
  await asUser(admin, A, (c) => c.query("insert into public.spools (brand, material, color_name, color_hex, price, initial_weight_g) values ('Témoin', 'PLA', 'Rouge', '#FF0000', 10, 500)"));
  await admin.query(SCHEMA_SQL);
  const r = await asUser(admin, A, (c) => one(c, "select count(*)::int as n from public.spools where brand = 'Témoin'"));
  assert.equal(r.n, 1);
  await asUser(admin, A, (c) => c.query("delete from public.spools where brand = 'Témoin'"));
  const v = await asUser(admin, A, (c) => one(c, 'select public.p3d_version() as v'));
  assert.equal(v.v, 3);
});

test('publication temps réel : les 12 tables', async () => {
  const r = await one(admin, "select count(*)::int as n from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'");
  assert.equal(r.n, 12);
});

test('réglages : ligne par défaut pour le compte', async () => {
  const s = await asUser(admin, A, async (c) => {
    await c.query('insert into public.settings default values');
    return one(c, 'select * from public.settings');
  });
  assert.equal(s.owner_id, A);
  assert.equal(num(s.machine_rate), 0.3);
  assert.equal(num(s.labor_rate), 20);
  assert.equal(num(s.spool_critical_g), 150);
  assert.ok(Array.isArray(s.sales_channels) && s.sales_channels.length >= 5);
});

test('machines : une seule par défaut', async () => {
  await asUser(admin, A, async (c) => {
    ids.m1 = (await one(c, "insert into public.machines (name, hourly_rate, is_default) values ('P1S', 0.30, true) returning id")).id;
    ids.m2 = (await one(c, "insert into public.machines (name, hourly_rate, is_default) values ('A1', 0.20, true) returning id")).id;
    const rows = (await c.query('select id, is_default from public.machines order by created_at')).rows;
    assert.deepEqual(rows.map((r) => r.is_default), [false, true]);
  });
});

test('bobines : coût au gramme et poids restant initial', async () => {
  await asUser(admin, A, async (c) => {
    const s1 = await one(c, "insert into public.spools (brand, material, color_name, color_hex, price, initial_weight_g) values ('Bambu', 'PLA', 'Noir', '#111111', 22, 1000) returning *");
    const s2 = await one(c, "insert into public.spools (brand, material, color_name, color_hex, price, initial_weight_g, tare_g) values ('Bambu', 'PLA', 'Blanc', '#FFFFFF', 20, 1000, 250) returning *");
    ids.s1 = s1.id; ids.s2 = s2.id;
    assert.equal(num(s1.cost_per_g), 0.022);
    assert.equal(num(s1.remaining_weight_g), 1000);
    // le poids restant envoyé par un client est ignoré : c'est la base qui calcule
    const s = await one(c, 'update public.spools set remaining_weight_g = 5 where id = $1 returning remaining_weight_g', [ids.s1]);
    assert.equal(num(s.remaining_weight_g), 1000);
  });
});

test('template : matières validées', async () => {
  await asUser(admin, A, async (c) => {
    const materials = [
      { material: 'PLA', color_name: 'Noir', color_hex: '#111111', grams: 30, spool_id: ids.s1 },
      { material: 'PLA', color_name: 'Blanc', color_hex: '#FFFFFF', grams: 10, spool_id: ids.s2 },
    ];
    const t = await one(c, `insert into public.templates (name, machine_id, materials, purge_g, hardware_cost, print_time_min, labor_min, catalog_price)
                            values ('Support Manette Universel', $1, $2, 5, 0.5, 120, 10, 15) returning id`, [ids.m2, JSON.stringify(materials)]);
    ids.t1 = t.id;
  });
  for (const bad of [
    [{ material: 'PLA', color_hex: '#111111', grams: -1 }],
    [{ material: 'PLA', color_hex: 'noir', grams: 1 }],
    [{ material: 'PLA', color_hex: '#111111', grams: '12' }],
    [{ material: 'PLA', color_hex: '#111111', grams: 1, spool_id: 42 }],
    { pas: 'une liste' },
  ]) {
    const code = await pgCode(asUser(admin, A, (c) => c.query("insert into public.templates (name, materials) values ('Mauvais', $1)", [JSON.stringify(bad)])));
    assert.equal(code, '23514', `matières refusées : ${JSON.stringify(bad)}`);
  }
});

function productionPayload({ id = randomUUID(), kind = 'production', qty = 4, failedPct = 100, at, lotId = randomUUID() } = {}) {
  const k = kind === 'failure' ? failedPct / 100 : 1;
  const g1 = (30 + 3.75) * qty * k; // 5 g de purge répartis 3,75 / 1,25
  const g2 = (10 + 1.25) * qty * k;
  const material = (30 * 0.022 + 10 * 0.02) * qty * k;
  const purge = (3.75 * 0.022 + 1.25 * 0.02) * qty * k;
  const hardware = kind === 'production' ? 0.5 * qty : 0;
  const machine = (120 / 60) * 0.2 * qty * k;
  const labor = kind === 'production' ? (10 / 60) * 20 * qty : 0;
  const total = material + purge + hardware + machine + labor;
  return {
    id, kind, lot_id: lotId, template_id: ids.t1, item_name: 'Support Manette Universel', quantity: qty,
    failed_pct: kind === 'failure' ? failedPct : 100, machine_id: ids.m2, machine_rate: 0.2, labor_rate: 20,
    grams_total: g1 + g2, purge_g_total: 5 * qty * k, print_time_min_total: 120 * qty * k, labor_min_total: kind === 'production' ? 10 * qty : 0,
    material_cost: material, purge_cost: purge, hardware_cost: hardware, machine_cost: machine, labor_cost: labor,
    total_cost: total, unit_cost: total / qty, occurred_at: at,
    consumption: [
      { spool_id: ids.s1, grams: g1, cost_per_g: 0.022, movement_id: randomUUID() },
      { spool_id: ids.s2, grams: g2, cost_per_g: 0.02, movement_id: randomUUID() },
    ],
  };
}

test('lancer une production : déduit les bobines et crée le stock', async () => {
  const p = productionPayload({ at: '2026-09-01T10:00:00Z' });
  ids.p1 = p.id; ids.lot1 = p.lot_id; ids.p1Payload = p;
  const r = await asUser(admin, A, (c) => rpc(c, 'p3d_launch_production', p));
  assert.equal(r.productions.length, 1);
  assert.equal(r.spool_movements.length, 2);
  assert.equal(r.production_stock.length, 1);
  assert.equal(r.production_stock[0].id, ids.lot1);
  assert.equal(r.production_stock[0].qty_available, 4);
  const s1 = r.spools.find((s) => s.id === ids.s1);
  const s2 = r.spools.find((s) => s.id === ids.s2);
  assert.equal(num(s1.remaining_weight_g), 865);
  assert.equal(num(s2.remaining_weight_g), 955);
  ids.unit1 = num(r.productions[0].unit_cost);
});

test('rejouer la même production ne compte rien deux fois', async () => {
  const r = await asUser(admin, A, (c) => rpc(c, 'p3d_launch_production', ids.p1Payload));
  assert.equal(r.spool_movements.length, 2);
  const n = await asUser(admin, A, (c) => one(c, 'select count(*)::int as n, (select remaining_weight_g from public.spools where id = $1) as rem from public.spool_movements', [ids.s1]));
  assert.equal(n.n, 2);
  assert.equal(num(n.rem), 865);
});

test('même production envoyée en même temps par deux connexions', async () => {
  const p = productionPayload({ qty: 1, at: '2026-09-01T11:00:00Z' });
  let second;
  try {
    await admin.query('begin');
    await admin.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: A, role: 'authenticated' })]);
    await admin.query('set local role authenticated');
    await rpc(admin, 'p3d_launch_production', p);
    second = asUser(other, A, (c) => rpc(c, 'p3d_launch_production', p));
    await new Promise((r) => setTimeout(r, 300));
    await admin.query('commit');
  } catch (e) {
    await admin.query('rollback').catch(() => {});
    throw e;
  }
  const r = await second;
  assert.equal(r.productions.length, 1);
  assert.equal(r.spool_movements.length, 2);
  const n = await asUser(admin, A, (c) => one(c, 'select count(*)::int as n from public.productions where id = $1', [p.id]));
  assert.equal(n.n, 1);
  ids.p2 = p.id;
  const del = await asUser(admin, A, (c) => rpc(c, 'p3d_delete_production', p.id));
  assert.deepEqual(del.deleted.productions, [p.id]);
  assert.equal(num(del.spools.find((s) => s.id === ids.s1).remaining_weight_g), 865);
});

test('print raté à 50 % : filament déduit, aucun stock créé', async () => {
  const p = productionPayload({ kind: 'failure', qty: 1, failedPct: 50, at: '2026-09-02T10:00:00Z' });
  const r = await asUser(admin, A, (c) => rpc(c, 'p3d_launch_production', p));
  assert.equal(r.production_stock.length, 0);
  assert.equal(num(r.spools.find((s) => s.id === ids.s1).remaining_weight_g), 848.12); // 865 − 16,88
  assert.equal(num(r.productions[0].labor_cost), 0);
  ids.fail1 = p.id;
});

test('pesée : fait foi, les consommations antérieures (rejouées tard) ne comptent plus', async () => {
  await asUser(admin, A, async (c) => {
    let r = await rpc(c, 'p3d_weigh_spool', { id: randomUUID(), spool_id: ids.s1, measured_g: 800, occurred_at: '2026-09-03T10:00:00Z' });
    assert.equal(num(r.spools[0].remaining_weight_g), 800);
    const late = productionPayload({ qty: 1, at: '2026-09-04T10:00:00Z' });
    r = await rpc(c, 'p3d_launch_production', late);
    assert.equal(num(r.spools.find((s) => s.id === ids.s1).remaining_weight_g), 766.25);
    const offline = productionPayload({ qty: 1, at: '2026-09-02T18:00:00Z' });
    r = await rpc(c, 'p3d_launch_production', offline);
    assert.equal(num(r.spools.find((s) => s.id === ids.s1).remaining_weight_g), 766.25);
    ids.late = late; ids.offline = offline;
  });
});

test('vente FIFO : coût de revient et marge nette', async () => {
  const sale = {
    id: randomUUID(), channel: 'etsy', shipping_cost: 4, packaging_cost: 1, platform_fee: 1.5, occurred_at: '2026-09-05T10:00:00Z',
    items: [{ id: randomUUID(), template_id: ids.t1, item_name: 'Support Manette Universel', quantity: 3, unit_price: 15 }],
  };
  const r = await asUser(admin, A, (c) => rpc(c, 'p3d_record_sale', sale));
  ids.sale1 = sale;
  assert.equal(num(r.sales[0].amount), 45);
  const cogs = Math.round(3 * ids.unit1 * 10000) / 10000;
  assert.ok(Math.abs(num(r.sales[0].cogs) - cogs) < 0.001);
  assert.ok(Math.abs(num(r.sales[0].net_margin) - (45 - cogs - 6.5)) < 0.001);
  assert.equal(r.sale_allocations.length, 1);
  assert.equal(r.production_stock.find((l) => l.id === ids.lot1).qty_available, 1);
});

test('vente sur deux lots : le plus ancien part en premier', async () => {
  const lot1Left = 1;
  const r = await asUser(admin, A, (c) => rpc(c, 'p3d_record_sale', {
    id: randomUUID(), channel: 'direct', occurred_at: '2026-09-06T10:00:00Z',
    items: [{ id: randomUUID(), template_id: ids.t1, item_name: 'Support Manette Universel', quantity: 2, unit_price: 14 }],
  }));
  assert.equal(r.sale_allocations.length, 2);
  const byLot = Object.fromEntries(r.sale_allocations.map((a) => [a.lot_id, a.quantity]));
  assert.equal(byLot[ids.lot1], lot1Left);
  ids.sale2 = r.sales[0].id;
});

test('survente refusée, sans rien écrire', async () => {
  const saleId = randomUUID();
  const err = await asUser(admin, A, (c) => rpc(c, 'p3d_record_sale', {
    id: saleId, items: [{ template_id: ids.t1, item_name: 'Support Manette Universel', quantity: 50, unit_price: 10 }],
  })).then(() => null, (e) => e);
  assert.equal(err && err.code, 'P3D01');
  assert.match(err.message, /^Stock insuffisant pour « Support Manette Universel » : il manque \d+ pièces\.$/);
  const n = await asUser(admin, A, (c) => one(c, 'select count(*)::int as n from public.sales where id = $1', [saleId]));
  assert.equal(n.n, 0);
});

test('rejouer une vente ne reprend pas de stock', async () => {
  const before = await asUser(admin, A, (c) => one(c, 'select sum(qty_available)::int as n from public.production_stock'));
  const r = await asUser(admin, A, (c) => rpc(c, 'p3d_record_sale', ids.sale1));
  assert.equal(r.sale_allocations.length, 1);
  const afterRow = await asUser(admin, A, (c) => one(c, 'select sum(qty_available)::int as n from public.production_stock'));
  assert.equal(afterRow.n, before.n);
});

test('vente sur mesure (hors stock) avec coût saisi', async () => {
  const r = await asUser(admin, A, (c) => rpc(c, 'p3d_record_sale', {
    id: randomUUID(), shipping_charged: 5, occurred_at: '2026-09-07T10:00:00Z',
    items: [{ item_name: 'Pièce sur mesure', quantity: 2, unit_price: 20, from_stock: false, unit_cost: 6 }],
  }));
  assert.equal(num(r.sales[0].amount), 45);
  assert.equal(num(r.sales[0].cogs), 12);
  assert.equal(num(r.sales[0].net_margin), 33);
});

test('annuler une production déjà vendue est refusé', async () => {
  const code = await pgCode(asUser(admin, A, (c) => rpc(c, 'p3d_delete_production', ids.p1)));
  assert.equal(code, 'P3D02');
});

test('annuler une vente remet les pièces en stock', async () => {
  const r = await asUser(admin, A, (c) => rpc(c, 'p3d_delete_sale', ids.sale2));
  assert.deepEqual(r.deleted.sales, [ids.sale2]);
  assert.equal(r.deleted.sale_allocations.length, 2);
  assert.equal(r.production_stock.find((l) => l.id === ids.lot1).qty_available, 1);
  const again = await asUser(admin, A, (c) => rpc(c, 'p3d_delete_sale', ids.sale2));
  assert.deepEqual(again.deleted.sales, []);
});

test('ajout de stock existant et retrait (casse)', async () => {
  await asUser(admin, A, async (c) => {
    const lotId = randomUUID();
    let r = await rpc(c, 'p3d_add_stock', { id: lotId, template_id: ids.t1, item_name: 'Support Manette Universel', unit_cost: 3, quantity: 2, occurred_at: '2026-08-01T10:00:00Z' });
    assert.equal(r.production_stock[0].qty_available, 2);
    const group = randomUUID();
    r = await rpc(c, 'p3d_adjust_stock', { id: group, template_id: ids.t1, item_name: 'Support Manette Universel', quantity: 1, reason: 'casse' });
    assert.equal(r.stock_adjustments.length, 1);
    assert.equal(r.stock_adjustments[0].lot_id, lotId, 'le lot le plus ancien est retiré en premier');
    r = await rpc(c, 'p3d_adjust_stock', { id: group, template_id: ids.t1, item_name: 'Support Manette Universel', quantity: 1, reason: 'casse' });
    assert.equal(r.stock_adjustments.length, 1, 'rejoué sans doublon');
  });
  const code = await pgCode(asUser(admin, A, (c) => rpc(c, 'p3d_adjust_stock', { id: randomUUID(), template_id: ids.t1, item_name: 'x', quantity: 999 })));
  assert.equal(code, 'P3D01');
  const lot = await asUser(admin, A, (c) => one(c, 'select coalesce(sum(qty_available), 0)::int as n from public.production_stock where template_id = $1', [ids.t1]));
  const oneMissing = await asUser(admin, A, (c) => rpc(c, 'p3d_adjust_stock', { id: randomUUID(), template_id: ids.t1, item_name: 'x', quantity: lot.n + 1 })).then(() => null, (e) => e);
  assert.match(oneMissing.message, /il manque 1 pièce\.$/, 'singulier quand il manque une seule pièce');
});

test('bobine avec historique : suppression refusée, archivage possible', async () => {
  const code = await pgCode(asUser(admin, A, (c) => c.query('delete from public.spools where id = $1', [ids.s1])));
  assert.equal(code, '23503');
  const s = await asUser(admin, A, (c) => one(c, 'update public.spools set archived = true where id = $1 returning archived, remaining_weight_g', [ids.s1]));
  assert.equal(s.archived, true);
  assert.equal(num(s.remaining_weight_g), 766.25);
});

test('suppression de template/machine : l’historique garde les noms', async () => {
  await asUser(admin, A, async (c) => {
    await c.query('delete from public.machines where id = $1', [ids.m2]);
    assert.equal((await one(c, 'select machine_id from public.templates where id = $1', [ids.t1])).machine_id, null);
    await c.query('delete from public.templates where id = $1', [ids.t1]);
    const p = await one(c, 'select template_id, item_name from public.productions where id = $1', [ids.p1]);
    assert.equal(p.template_id, null);
    assert.equal(p.item_name, 'Support Manette Universel');
    const l = await one(c, 'select template_id, qty_available from public.production_stock where id = $1', [ids.lot1]);
    assert.equal(l.template_id, null);
  });
});

test('sécurité : un autre compte ne voit ni ne modifie rien', async () => {
  await asUser(admin, B, async (c) => {
    for (const t of ['settings', 'machines', 'spools', 'templates', 'productions', 'spool_movements', 'production_stock', 'stock_adjustments', 'sales', 'sale_items', 'sale_allocations']) {
      const r = await one(c, `select count(*)::int as n from public.${t}`);
      assert.equal(r.n, 0, `B ne doit rien voir dans ${t}`);
    }
    const u = await c.query('update public.spools set price = 0 where id = $1', [ids.s2]);
    assert.equal(u.rowCount, 0);
    const d = await c.query('delete from public.sales');
    assert.equal(d.rowCount, 0);
    const r = await rpc(c, 'p3d_delete_sale', ids.sale1.id);
    assert.deepEqual(r.deleted.sales, []);
  });
  const code = await pgCode(asUser(admin, B, (c) => rpc(c, 'p3d_weigh_spool', { spool_id: ids.s2, measured_g: 1 })));
  assert.equal(code, '23503', 'pas de pesée sur la bobine d’un autre');
  const code2 = await pgCode(asUser(admin, B, (c) => c.query("insert into public.spools (owner_id, material, price) values ($1, 'PLA', 1)", [A])));
  assert.equal(code2, '42501', 'impossible d’écrire au nom d’un autre');
  const still = await asUser(admin, A, (c) => one(c, 'select price from public.spools where id = $1', [ids.s2]));
  assert.equal(num(still.price), 20);
});

test('sécurité : un autre compte ne peut pas deviner les chiffres d’un compte par essais d’écriture', async () => {
  // essais « à l'aveugle » avec les identifiants d'un autre compte : la réponse ne doit jamais dépendre de ses données
  const probe = (sql, params) => asUser(admin, B, (c) => c.query(sql, params)).then(() => null, (e) => e.code);
  const lotSmall = await probe("insert into public.production_stock (id, item_name, quantity) values ($1, 'essai', 1)", [ids.lot1]);
  const lotBig = await probe("insert into public.production_stock (id, item_name, quantity) values ($1, 'essai', 100000)", [ids.lot1]);
  assert.equal(lotSmall, lotBig, 'même réponse quelle que soit la quantité essayée (sinon ventes/retraits devinables)');
  const spoolSmall = await probe("insert into public.spools (id, brand, material, price, initial_weight_g) values ($1, 'essai', 'PLA', 0, -99999999)", [ids.s1]);
  const spoolBig = await probe("insert into public.spools (id, brand, material, price, initial_weight_g) values ($1, 'essai', 'PLA', 0, -99990000)", [ids.s1]);
  assert.equal(spoolSmall, spoolBig, 'même réponse quel que soit le poids essayé (sinon consommation devinable)');
});

test('sécurité : sans connexion (anon) tout est refusé', async () => {
  for (const q of ['select * from public.spools', 'select * from public.sales', "select public.p3d_weigh_spool('{}'::jsonb)", "select public.p3d_record_sale('{}'::jsonb)"]) {
    const code = await pgCode(asUser(admin, null, (c) => c.query(q), { role: 'anon' }));
    assert.equal(code, '42501', q);
  }
});

test('heure de modification distincte pour chaque version d’une ligne (même transaction)', async () => {
  const r = await asUser(admin, A, async (c) => {
    const tpl = (await one(c, "insert into public.templates (name, materials) values ('Horodatage', '[]') returning id")).id;
    await rpc(c, 'p3d_add_stock', { id: randomUUID(), template_id: tpl, item_name: 'Horodatage', unit_cost: 1, quantity: 5 });
    const sale = { id: randomUUID(), items: [{ id: randomUUID(), template_id: tpl, item_name: 'Horodatage', quantity: 1, unit_price: 9 }, { id: randomUUID(), template_id: tpl, item_name: 'Horodatage', quantity: 1, unit_price: 9 }] };
    await rpc(c, 'p3d_record_sale', sale);
    return one(c, `select (s.updated_at > s.created_at) as sale_later,
                          bool_and(i.updated_at > i.created_at) as items_later
                     from public.sales s join public.sale_items i on i.sale_id = s.id where s.id = $1 group by s.id`, [sale.id]);
  });
  assert.equal(r.sale_later, true, 'la vente complétée doit être plus récente que la vente créée');
  assert.equal(r.items_later, true);
});

test('une vente supprimée ne revient pas si l’action est rejouée plus tard', async () => {
  await asUser(admin, A, async (c) => {
    const tpl = (await one(c, "insert into public.templates (name, materials) values ('Revenant', '[]') returning id")).id;
    await rpc(c, 'p3d_add_stock', { id: randomUUID(), template_id: tpl, item_name: 'Revenant', unit_cost: 2, quantity: 3 });
    const sale = { id: randomUUID(), items: [{ id: randomUUID(), template_id: tpl, item_name: 'Revenant', quantity: 2, unit_price: 10 }] };
    await rpc(c, 'p3d_record_sale', sale);
    await rpc(c, 'p3d_delete_sale', sale.id);
    const replay = await rpc(c, 'p3d_record_sale', sale);
    assert.equal(replay.tombstoned, true);
    const n = await one(c, 'select count(*)::int as n from public.sales where id = $1', [sale.id]);
    assert.equal(n.n, 0);
    const stock = await one(c, 'select sum(qty_available)::int as n from public.production_stock where template_id = $1', [tpl]);
    assert.equal(stock.n, 3, 'le stock n’est pas repris une deuxième fois');
    const prod = productionPayload({ qty: 1 });
    prod.template_id = tpl;
    prod.machine_id = null;
    prod.consumption = [];
    for (const k of ['material_cost', 'purge_cost', 'hardware_cost', 'machine_cost', 'labor_cost', 'total_cost', 'unit_cost', 'grams_total', 'purge_g_total']) prod[k] = 0;
    await rpc(c, 'p3d_launch_production', prod);
    await rpc(c, 'p3d_delete_production', prod.id);
    const again = await rpc(c, 'p3d_launch_production', prod);
    assert.equal(again.tombstoned, true);
  });
});

test('une bobine supprimée ne revient pas par un enregistrement rejoué', async () => {
  await asUser(admin, A, async (c) => {
    const id = randomUUID();
    const up = "insert into public.spools (id, brand, material, price) values ($1, 'Fantôme', 'PLA', 5) on conflict (id) do update set price = excluded.price";
    await c.query(up, [id]);
    await c.query('delete from public.spools where id = $1', [id]);
    const res = await c.query(up, [id]);
    assert.equal(res.rowCount, 0);
    const n = await one(c, 'select count(*)::int as n from public.spools where id = $1', [id]);
    assert.equal(n.n, 0);
  });
  const seenByB = await asUser(admin, B, (c) => one(c, 'select count(*)::int as n from public.deleted_rows'));
  assert.equal(seenByB.n, 0, 'le registre des suppressions est cloisonné par compte');
  const code = await pgCode(asUser(admin, null, (c) => c.query('select * from public.deleted_rows'), { role: 'anon' }));
  assert.equal(code, '42501');
});

// Transaction ouverte « comme PostgREST », laissée ouverte pour simuler deux appareils au même instant
async function beginAs(client, uid) {
  await client.query('begin');
  await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: 'authenticated' })]);
  await client.query('set local role authenticated');
}
const zeroCosts = (pp) => {
  for (const k of ['material_cost', 'purge_cost', 'hardware_cost', 'machine_cost', 'labor_cost', 'total_cost', 'unit_cost', 'grams_total', 'purge_g_total']) pp[k] = 0;
  pp.consumption = [];
  return pp;
};

test('retrait de stock rejoué après la suppression de sa production : pas refait ailleurs', async () => {
  await asUser(admin, A, async (c) => {
    const tpl = (await one(c, "insert into public.templates (name, materials) values ('Casse rejouée', '[]') returning id")).id;
    const mk = (qty, at) => zeroCosts({ ...productionPayload({ qty, at }), template_id: tpl, item_name: 'Casse rejouée', machine_id: null });
    const p1 = mk(1, '2026-01-01T10:00:00Z');
    const p2 = mk(4, '2026-01-02T10:00:00Z');
    await rpc(c, 'p3d_launch_production', p1);
    await rpc(c, 'p3d_launch_production', p2);
    const adj = { id: randomUUID(), template_id: tpl, item_name: 'Casse rejouée', quantity: 1, reason: 'casse' };
    const first = await rpc(c, 'p3d_adjust_stock', adj);
    assert.equal(first.production_stock[0].production_id, p1.id, 'pris dans le lot le plus ancien');
    await rpc(c, 'p3d_delete_production', p1.id);
    const replay = await rpc(c, 'p3d_adjust_stock', adj);
    assert.equal(replay.tombstoned, true);
    const lot2 = await one(c, 'select qty_available from public.production_stock where production_id = $1', [p2.id]);
    assert.equal(lot2.qty_available, 4, 'le lot suivant n’est pas entamé par le rejeu');
  });
});

test('bobine supprimée PENDANT un enregistrement de la même bobine (deux appareils) : elle ne revient pas', async () => {
  const id = randomUUID();
  await asUser(admin, A, (c) => c.query("insert into public.spools (id, brand, material, price) values ($1, 'Course', 'PLA', 5)", [id]));
  await beginAs(admin, A);
  await admin.query('delete from public.spools where id = $1', [id]);
  await beginAs(other, A);
  let settled = false;
  const pending = other.query("insert into public.spools (id, brand, material, price) values ($1, 'Course', 'PLA', 9) on conflict (id) do update set price = excluded.price", [id])
    .then(() => null, (e) => e)
    .finally(() => { settled = true; });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(settled, false, 'l’enregistrement doit attendre la suppression en cours (sinon le test ne mesure rien)');
  await admin.query('commit');
  const err = await pending;
  await other.query(err ? 'rollback' : 'commit');
  assert.equal(err && err.code, 'P3D10');
  const n = await asUser(admin, A, (c) => one(c, 'select count(*)::int as n from public.spools where id = $1', [id]));
  assert.equal(n.n, 0, 'la bobine supprimée ne revient pas');
});

test('vente rejouée pendant sa suppression sur un autre appareil : stock repris une seule fois', async () => {
  const sale = { id: randomUUID() };
  let tpl;
  await asUser(admin, A, async (c) => {
    tpl = (await one(c, "insert into public.templates (name, materials) values ('Double appareil', '[]') returning id")).id;
    await rpc(c, 'p3d_add_stock', { id: randomUUID(), template_id: tpl, item_name: 'Double appareil', unit_cost: 2, quantity: 3 });
    sale.items = [{ id: randomUUID(), template_id: tpl, item_name: 'Double appareil', quantity: 2, unit_price: 10 }];
    await rpc(c, 'p3d_record_sale', sale);
  });
  await beginAs(admin, A);
  await admin.query('select public.p3d_delete_sale($1)', [sale.id]);
  await beginAs(other, A);
  const replay = (await other.query('select public.p3d_record_sale($1) as r', [sale])).rows[0].r;
  await other.query('commit');
  await admin.query('commit');
  assert.equal(replay.sales.length, 1, 'la vente encore visible est renvoyée telle quelle, sans être refaite');
  const after = await asUser(admin, A, async (c) => ({
    sales: (await one(c, 'select count(*)::int as n from public.sales where id = $1', [sale.id])).n,
    stock: (await one(c, 'select sum(qty_available)::int as n from public.production_stock where template_id = $1', [tpl])).n,
    again: (await rpc(c, 'p3d_record_sale', sale)).tombstoned,
  }));
  assert.deepEqual(after, { sales: 0, stock: 3, again: true });
});

test('action hors-ligne qui vise un template, une machine ou une bobine supprimés entre-temps', async () => {
  await asUser(admin, A, async (c) => {
    const tpl = (await one(c, "insert into public.templates (name, materials) values ('Parent disparu', '[]') returning id")).id;
    const mac = (await one(c, "insert into public.machines (name) values ('Machine disparue') returning id")).id;
    const sp = (await one(c, "insert into public.spools (brand, material, price) values ('Sans historique', 'PLA', 10) returning id")).id;
    await c.query('delete from public.templates where id = $1', [tpl]);
    await c.query('delete from public.machines where id = $1', [mac]);
    await c.query('delete from public.spools where id = $1', [sp]);

    const prod = zeroCosts({ ...productionPayload({ qty: 2 }), template_id: tpl, machine_id: mac, item_name: 'Parent disparu' });
    prod.consumption = [{ spool_id: sp, grams: 12, cost_per_g: 0.01, movement_id: randomUUID() }];
    const r = await rpc(c, 'p3d_launch_production', prod);
    assert.equal(r.productions[0].template_id, null);
    assert.equal(r.productions[0].machine_id, null);
    assert.equal(r.spool_movements.length, 0, 'rien à déduire d’une bobine supprimée');
    assert.equal(r.production_stock[0].quantity, 2);

    const sale = await rpc(c, 'p3d_record_sale', { id: randomUUID(), items: [{ id: randomUUID(), template_id: tpl, item_name: 'Parent disparu', quantity: 1, unit_price: 5 }] });
    assert.equal(sale.sale_allocations.length, 1, 'le stock est retrouvé par son nom');

    const weigh = await rpc(c, 'p3d_weigh_spool', { id: randomUUID(), spool_id: sp, measured_g: 100 });
    assert.equal(weigh.tombstoned, true);
  });
});

test('registre des suppressions : un compte ne peut pas y écrire lui-même', async () => {
  const code = await pgCode(asUser(admin, A, (c) => c.query("insert into public.deleted_rows (owner_id, table_name, row_id) values ($1, 'spools', $2)", [A, ids.s2])));
  assert.equal(code, '42501');
});

test('suppression du compte par Supabase Auth (rôle sans droits sur les tables) : tout part', async () => {
  const C = randomUUID();
  await admin.query('insert into auth.users (id, email) values ($1, $2)', [C, 'c@test.local']);
  await asUser(admin, C, async (c) => {
    await c.query('insert into public.settings default values');
    const mac = (await one(c, "insert into public.machines (name, is_default) values ('P1S', true) returning id")).id;
    const sp = (await one(c, "insert into public.spools (brand, material, price) values ('Bambu', 'PLA', 20) returning id")).id;
    const tpl = (await one(c, "insert into public.templates (name, materials, machine_id) values ('Compte supprimé', '[]', $1) returning id", [mac])).id;
    await rpc(c, 'p3d_weigh_spool', { id: randomUUID(), spool_id: sp, measured_g: 800 });
    const prod = zeroCosts({ ...productionPayload({ qty: 3 }), template_id: tpl, machine_id: mac, item_name: 'Compte supprimé' });
    prod.consumption = [{ spool_id: sp, grams: 30, cost_per_g: 0.02, movement_id: randomUUID() }];
    await rpc(c, 'p3d_launch_production', prod);
    await rpc(c, 'p3d_adjust_stock', { id: randomUUID(), template_id: tpl, item_name: 'Compte supprimé', quantity: 1 });
    await rpc(c, 'p3d_record_sale', { id: randomUUID(), items: [{ id: randomUUID(), template_id: tpl, item_name: 'Compte supprimé', quantity: 1, unit_price: 9 }] });
  });
  await admin.query('do $$ begin create role p3d_auth_admin_test nologin noinherit; exception when duplicate_object then null; end $$');
  await admin.query('grant usage on schema auth to p3d_auth_admin_test');
  await admin.query('grant select, delete on auth.users to p3d_auth_admin_test');
  await admin.query('begin');
  try {
    await admin.query('set local role p3d_auth_admin_test');
    await admin.query('delete from auth.users where id = $1', [C]);
    await admin.query('commit');
  } catch (e) {
    await admin.query('rollback');
    throw e;
  }
  for (const t of ['settings', 'machines', 'spools', 'templates', 'productions', 'spool_movements', 'production_stock', 'stock_adjustments', 'sales', 'sale_items', 'sale_allocations']) {
    const r = await one(admin, `select count(*)::int as n from public.${t} where owner_id = $1`, [C]);
    assert.equal(r.n, 0, `${t} vidée pour le compte supprimé`);
  }
});

test('connecté mais sans identité : action refusée proprement', async () => {
  const code = await pgCode(asUser(admin, null, (c) => rpc(c, 'p3d_record_sale', {})));
  assert.equal(code, 'P3D00');
});

test('pesée : refusée au-delà de 5 % au-dessus du poids initial (même règle que l’appli)', async () => {
  await asUser(admin, A, async (c) => {
    const sp = (await one(c, "insert into public.spools (brand, material, color_name, color_hex, price, initial_weight_g) values ('Essai', 'PETG', 'Ivoire', '#D6C3A1', 12.5, 500) returning id")).id;
    await c.query('savepoint avant');
    const code = await pgCode(rpc(c, 'p3d_weigh_spool', { id: randomUUID(), spool_id: sp, measured_g: 700 }));
    assert.equal(code, 'P3D09');
    await c.query('rollback to savepoint avant');
    const ok = await rpc(c, 'p3d_weigh_spool', { id: randomUUID(), spool_id: sp, measured_g: 525 });
    assert.equal(num(ok.spools[0].remaining_weight_g), 525);
    await c.query('savepoint encore');
    assert.equal(await pgCode(rpc(c, 'p3d_weigh_spool', { id: randomUUID(), spool_id: sp, measured_g: 525.01 })), 'P3D09');
    await c.query('rollback to savepoint encore');
  });
});

test('signe de vie (anti-pause) : appelable sans compte, ne renvoie aucune donnée', async () => {
  const r = await asUser(admin, null, (c) => one(c, 'select public.p3d_ping() as ok'), { role: 'anon' });
  assert.equal(r.ok, true);
  const def = await one(admin, "select pg_get_functiondef('public.p3d_ping()'::regprocedure) as d, p.prosecdef from pg_proc p where p.oid = 'public.p3d_ping()'::regprocedure");
  assert.equal(def.prosecdef, false, 'droits de l’appelant (anon), jamais ceux du propriétaire');
  assert.ok(!/from\s+public\./i.test(def.d), 'ne lit aucune table');
});

test('réglages : date de dernière sauvegarde enregistrée par le compte', async () => {
  const at = '2026-09-18T20:00:00.000Z';
  const r = await asUser(admin, A, async (c) => {
    await c.query('update public.settings set last_backup_at = $1', [at]);
    return one(c, 'select last_backup_at from public.settings');
  });
  assert.equal(new Date(r.last_backup_at).toISOString(), at);
});

test('Security Advisor : aucune fonction « security definer » appelable par l’API, rien d’ouvert sans compte', async () => {
  // les droits que Supabase donne par défaut à tout nouvel objet (imités dans supabase-stubs.sql) sont refermés
  const defs = (await admin.query(`
    select p.oid::regprocedure::text as fn,
           has_function_privilege('anon', p.oid, 'execute') as anon,
           has_function_privilege('authenticated', p.oid, 'execute') as auth
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef`)).rows;
  assert.ok(defs.length >= 4, 'fonctions security definer trouvées (dont rls_auto_enable ajoutée par Supabase)');
  for (const r of defs) {
    assert.equal(r.anon, false, `${r.fn} appelable sans compte`);
    assert.equal(r.auth, false, `${r.fn} appelable directement par un compte connecté`);
  }
  const anonFns = (await admin.query(`
    select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`)).rows;
  assert.deepEqual(anonFns.map((r) => r.fn), ['p3d_ping()'], 'seul le signe de vie (qui ne lit rien) est appelable sans compte');
  const anonTables = (await admin.query(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
      and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
           or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))`)).rows;
  assert.deepEqual(anonTables.map((r) => r.relname), [], 'aucune table accessible sans compte');
  // les automatismes marchent toujours sans ce droit : celui de Supabase (RLS sur toute nouvelle table)…
  await admin.query('create table public.p3d_essai_rls (id int)');
  const rls = await one(admin, "select relrowsecurity as rls from pg_class where relname = 'p3d_essai_rls'");
  await admin.query('drop table public.p3d_essai_rls');
  assert.equal(rls.rls, true);
  // … et ceux de Paulo3D (suppression mémorisée par un déclencheur security definer)
  const gone = await asUser(admin, A, async (c) => {
    const m = await one(c, "insert into public.machines (name) values ('Essai droits') returning id");
    await c.query('delete from public.machines where id = $1', [m.id]);
    return one(c, "select count(*)::int as n from public.deleted_rows where table_name = 'machines' and row_id = $1", [m.id]);
  });
  assert.equal(gone.n, 1);
});

test('double authentification : code exigé pour un compte qui l’a activée (erreur claire, jamais un résultat vide)', async () => {
  // B a des données (une bobine, une machine supprimée) : sans données, Postgres ne consulte même pas la règle
  // et renvoie une liste vide, ce qui est la vérité ; avec des données, c'est un refus explicite
  await asUser(admin, B, async (c) => {
    await c.query("insert into public.spools (brand, material, color_name, color_hex, price, initial_weight_g) values ('B', 'PLA', 'Vert', '#22C55E', 20, 1000)");
    const m = await one(c, "insert into public.machines (name) values ('B1') returning id");
    await c.query('delete from public.machines where id = $1', [m.id]);
  });
  const F = randomUUID();
  await admin.query("insert into auth.mfa_factors (id, user_id, friendly_name, status) values ($1, $2, 'Paulo3D', 'verified')", [F, B]);
  const refus = (sql, aal) => asUser(admin, B, (c) => c.query(sql), aal ? { aal } : {}).then(() => null, (e) => e);
  try {
    // session « mot de passe seul » (aal1) : refus explicite, en lecture comme en écriture
    for (const sql of ['select * from public.spools', 'select * from public.deleted_rows', "insert into public.machines (name) values ('X')"]) {
      const err = await refus(sql, 'aal1');
      assert.ok(err, `refusé : ${sql}`);
      assert.equal(err.code, '42501');
      assert.equal(err.hint, 'P3D2F');
    }
    assert.equal((await refus('select 1 from public.spools')).hint, 'P3D2F', 'jeton sans niveau = mot de passe seul');
    const viaRpc = await asUser(admin, B, (c) => rpc(c, 'p3d_weigh_spool', { id: randomUUID(), spool_id: randomUUID(), measured_g: 1 }), { aal: 'aal1' }).then(() => null, (e) => e);
    assert.equal(viaRpc && viaRpc.hint, 'P3D2F', 'les actions (RPC) aussi');
    // mot de passe + code (aal2) : accès normal
    const r = await asUser(admin, B, (c) => one(c, 'select count(*)::int as n from public.spools'), { aal: 'aal2' });
    assert.equal(typeof r.n, 'number');
    // activation commencée mais jamais confirmée : aucun code exigé
    await admin.query("update auth.mfa_factors set status = 'unverified' where id = $1", [F]);
    assert.equal(await refus('select * from public.spools', 'aal1'), null);
  } finally {
    await admin.query('delete from auth.mfa_factors where id = $1', [F]);
  }
  assert.equal(await asUser(admin, A, (c) => c.query('select * from public.spools'), { aal: 'aal1' }).then(() => null, (e) => e), null, 'compte sans code : rien ne change');
  const priv = await one(admin, "select has_schema_privilege('anon', 'p3d_private', 'usage') as anon_usage, has_function_privilege('anon', 'p3d_private.mfa_ok()', 'execute') as anon_exec");
  assert.deepEqual(priv, { anon_usage: false, anon_exec: false }, 'contrôle hors de portée de l’API');
});

test('commandes : chacun les siennes, états contrôlés, suppression définitive, liens remis à zéro', async () => {
  const O = randomUUID();
  await asUser(admin, A, async (c) => {
    const t = (await one(c, "insert into public.templates (name) values ('Support commande') returning id")).id;
    await c.query("insert into public.orders (id, customer, template_id, item_name, quantity, unit_price, due_date) values ($1, 'Marie', $2, 'Support', 2, 13.9, '2026-09-30')", [O, t]);
  });
  const vueB = await asUser(admin, B, (c) => one(c, 'select count(*)::int as n from public.orders where id = $1', [O]));
  assert.equal(vueB.n, 0, 'un autre compte ne voit pas la commande');
  assert.equal(await pgCode(asUser(admin, null, (c) => c.query('select * from public.orders'), { role: 'anon' })), '42501', 'sans compte : refus');
  assert.equal(await pgCode(asUser(admin, A, (c) => c.query("update public.orders set status = 'perdue' where id = $1", [O]))), '23514', 'état inconnu refusé');
  assert.equal(await pgCode(asUser(admin, A, (c) => c.query('update public.orders set quantity = 0 where id = $1', [O]))), '23514', 'quantité nulle refusée');
  // supprimée : un enregistrement rejoué plus tard ne la fait pas revenir
  await asUser(admin, A, (c) => c.query('delete from public.orders where id = $1', [O]));
  const tomb = await one(admin, "select count(*)::int as n from public.deleted_rows where table_name = 'orders' and row_id = $1", [O]);
  assert.equal(tomb.n, 1, 'suppression mémorisée');
  const rejoue = await asUser(admin, A, (c) => c.query("insert into public.orders (id, item_name) values ($1, 'Support')", [O]));
  assert.equal(rejoue.rowCount, 0, 'la commande supprimée ne revient pas');
  // template supprimé → commande gardée, sans template ; vente annulée → commande redevenue « prête », sans vente
  await asUser(admin, A, async (c) => {
    const t = (await one(c, "insert into public.templates (name) values ('Éphémère') returning id")).id;
    const sale = randomUUID();
    await rpc(c, 'p3d_record_sale', { id: sale, channel: 'direct', occurred_at: '2026-09-18T10:00:00Z', items: [{ id: randomUUID(), item_name: 'Sur mesure', quantity: 1, unit_price: 10, from_stock: false, unit_cost: 1 }] });
    const o2 = (await one(c, "insert into public.orders (customer, template_id, item_name, status, sale_id) values ('Paul', $1, 'Éphémère', 'delivered', $2) returning id", [t, sale])).id;
    await c.query('delete from public.templates where id = $1', [t]);
    await c.query('select public.p3d_delete_sale($1)', [sale]);
    const r = await one(c, 'select template_id, sale_id, status from public.orders where id = $1', [o2]);
    assert.deepEqual(r, { template_id: null, sale_id: null, status: 'ready' });
  });

  // livrer une commande = une seule action : la vente porte order_id, la base livre la commande
  await asUser(admin, A, async (c) => {
    // refus attendus dans la même transaction : point de reprise, sinon PostgreSQL ignore toute la suite
    const refus = async (fn) => {
      await c.query('savepoint refus');
      const code = await pgCode(fn());
      await c.query('rollback to savepoint refus');
      return code;
    };
    const o = (await one(c, "insert into public.orders (customer, item_name, status) values ('Léa', 'Vase', 'ready') returning id")).id;
    const sale = randomUUID();
    const bundle = await rpc(c, 'p3d_record_sale', { id: sale, order_id: o, channel: 'direct', occurred_at: '2026-09-18T11:00:00Z', items: [{ id: randomUUID(), item_name: 'Vase', quantity: 1, unit_price: 20, from_stock: false, unit_cost: 2 }] });
    assert.equal(bundle.orders.length, 1, 'la commande livrée revient avec la vente (l’appareil l’affiche tout de suite)');
    assert.equal(bundle.orders[0].status, 'delivered');
    assert.equal(bundle.orders[0].sale_id, sale);
    // rejouer la même vente (réseau coupé après l'envoi) : pas d'erreur, même paquet
    const replay = await rpc(c, 'p3d_record_sale', { id: sale, order_id: o, channel: 'direct', items: [{ id: randomUUID(), item_name: 'Vase', quantity: 1, unit_price: 20, from_stock: false }] });
    assert.equal(replay.sales[0].id, sale);
    // deuxième vente pour la même commande : refusée, et RIEN n'est enregistré
    const other = randomUUID();
    assert.equal(await refus(() => rpc(c, 'p3d_record_sale', { id: other, order_id: o, channel: 'direct', items: [{ id: randomUUID(), item_name: 'Vase', quantity: 1, unit_price: 20, from_stock: false }] })), 'P3D11');
    assert.equal((await one(c, 'select count(*)::int as n from public.sales where id = $1', [other])).n, 0, 'aucune deuxième vente');
    // commande annulée : la livrer est refusé
    const oc = (await one(c, "insert into public.orders (item_name, status) values ('Lampe', 'cancelled') returning id")).id;
    assert.equal(await refus(() => rpc(c, 'p3d_record_sale', { id: randomUUID(), order_id: oc, channel: 'direct', items: [{ id: randomUUID(), item_name: 'Lampe', quantity: 1, unit_price: 5, from_stock: false }] })), 'P3D11');
    // annuler la vente : la commande redevient « prête » et revient dans la réponse
    const del = await rpc(c, 'p3d_delete_sale', sale, 'p_id');
    assert.equal(del.orders.length, 1);
    assert.equal(del.orders[0].status, 'ready');
    assert.equal(del.orders[0].sale_id, null);
  });
});

test('durcissement.sql : 2FA obligatoire, nouvelles tables fermées et en RLS, données intactes, relançable', async () => {
  const fs = await import('node:fs');
  const DURCI = fs.readFileSync(new URL('../supabase/durcissement.sql', import.meta.url), 'utf8');
  const avant = await one(admin, 'select count(*)::int as n from public.spools');
  await admin.query(DURCI);
  await admin.query(DURCI); // relancé : aucune erreur
  assert.equal((await one(admin, 'select count(*)::int as n from public.spools')).n, avant.n, 'aucune donnée touchée');
  try {
    // compte SANS code, session mot de passe seul : refus explicite qui fait ouvrir l'activation
    const err = await asUser(admin, A, (c) => c.query('select * from public.spools'), { aal: 'aal1' }).then(() => null, (e) => e);
    assert.ok(err, 'refusé sans double authentification');
    assert.equal(err.hint, 'P3D2F');
    assert.match(err.message, /^Double authentification obligatoire/);
    // avec le code : accès normal
    await asUser(admin, A, (c) => c.query('select * from public.spools'), { aal: 'aal2' });
    // schema.sql relancé plus tard : le réglage reste « obligatoire »
    await admin.query(SCHEMA_SQL);
    assert.equal((await one(admin, 'select p3d_private.mfa_obligatoire() as v')).v, true);
    // nouvelle table : RLS active d'office, fermée aux visiteurs sans compte
    await admin.query('create table public.p3d_essai_durci (id int)');
    const t = await one(admin, "select c.relrowsecurity as rls, has_table_privilege('anon', 'public.p3d_essai_durci', 'select') as anon_sel from pg_class c where c.oid = 'public.p3d_essai_durci'::regclass");
    assert.deepEqual(t, { rls: true, anon_sel: false });
    await admin.query('create function public.p3d_essai_fn() returns int language sql as $$ select 1 $$');
    // ⚠️ (19/09) Le script promettait « toute fonction créée plus tard reste fermée aux visiteurs sans
    // compte », mais PostgreSQL donne d'office le droit d'appel à PUBLIC : anon pouvait l'appeler.
    assert.equal((await one(admin, "select has_function_privilege('anon', 'public.p3d_essai_fn()', 'execute') as x")).x, false,
      'nouvelle fonction : fermée aux visiteurs sans compte');
    // … sans rien retirer aux fonctions de l'appli, accordées une à une par schema.sql
    assert.equal((await one(admin, "select has_function_privilege('authenticated', 'public.p3d_record_sale(jsonb)', 'execute') as x")).x, true);
    assert.equal((await one(admin, "select has_function_privilege('anon', 'public.p3d_ping()', 'execute') as x")).x, true, 'le ping public reste public');
  } finally {
    await admin.query('drop table if exists public.p3d_essai_durci; drop function if exists public.p3d_essai_fn();');
    await admin.query("create or replace function p3d_private.mfa_obligatoire() returns boolean language sql immutable set search_path = '' as 'select false'");
  }
});
