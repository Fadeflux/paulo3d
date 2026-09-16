// Tests des calculs et de l'import slicer, sur le code réellement assemblé.
// Lancer : node tools/build.mjs --dev && node --test tests/domain.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, applyOps } from './load-app.mjs';

const app = loadApp();
const U = '00000000-0000-4000-8000-000000000001';
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const spaces = (s) => String(s).replace(/[  ]/g, ' ');
// les tableaux créés dans le bac à sable n'ont pas le même prototype : on compare leur contenu
const deepEqual = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, m);

test('nombres saisis à la française', () => {
  assert.equal(app.parseNum('22,50'), 22.5);
  assert.equal(app.parseNum(' 1 000 '), 1000);
  assert.equal(app.parseNum('0,3'), 0.3);
  assert.ok(Number.isNaN(app.parseNum('abc')));
  assert.ok(Number.isNaN(app.parseNum('')));
  assert.ok(Number.isNaN(app.parseNum('1,2,3')));
  assert.equal(spaces(app.fmtEur(1234.5)), '1 234,50 €');
  assert.equal(app.fmtG(1250), '1,25 kg');
  assert.equal(app.fmtDuration(155), '2 h 35');
});

test('arrondi identique à PostgreSQL (moitié loin de zéro)', () => {
  assert.equal(app.roundDb(-16.875, 2), -16.88);
  assert.equal(app.roundDb(16.875, 2), 16.88);
  assert.equal(app.roundDb(2.675, 2), 2.68);
  assert.equal(app.roundDb(1.00005, 4), 1.0001);
});

test('arrondi du prix conseillé', () => {
  assert.equal(app.roundPrice(12.34, 'x.90'), 12.9);
  assert.equal(app.roundPrice(12.95, 'x.90'), 13.9);
  assert.equal(app.roundPrice(13, 'x.90'), 13.9);
  assert.equal(app.roundPrice(12.9, 'x.90'), 12.9);
  assert.equal(app.roundPrice(12.01, '0.50'), 12.5);
  assert.equal(app.roundPrice(12.01, '1'), 13);
  assert.equal(app.roundPrice(12.01, '0.10'), 12.1);
  assert.equal(app.roundPrice(12.1, '0.10'), 12.1);
  assert.equal(app.roundPrice(12.345, 'none'), 12.35);
});

test('HTML sûr : le texte saisi ne peut pas injecter de code', () => {
  const out = String(app.html`<b title="${'"><img src=x onerror=alert(1)>'}">${'<script>alert(1)</script>'}</b>`);
  assert.ok(!out.includes('<img'));
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
  assert.equal(String(app.html`${app.raw('<i>ok</i>')}`), '<i>ok</i>');
});

function fixture() {
  const S1 = '11111111-1111-4111-8111-111111111111';
  const S2 = '22222222-2222-4222-8222-222222222222';
  const M = '33333333-3333-4333-8333-333333333333';
  const T = '44444444-4444-4444-8444-444444444444';
  const ops = [
    ['settings.save', { ...app.DEFAULT_SETTINGS }],
    ['machine.save', { id: M, name: 'A1', hourly_rate: 0.2, is_default: false, archived: false }],
    ['spool.save', { id: S1, brand: 'Bambu', material: 'PLA', color_name: 'Noir', color_hex: '#111111', price: 22, initial_weight_g: 1000, tare_g: null, archived: false }],
    ['spool.save', { id: S2, brand: 'Bambu', material: 'PLA', color_name: 'Blanc', color_hex: '#FFFFFF', price: 20, initial_weight_g: 1000, tare_g: 250, archived: false }],
    ['template.save', {
      id: T, name: 'Support Manette Universel', machine_id: M, pieces_per_print: 1, purge_g: 5, hardware_cost: 0.5, print_time_min: 120, labor_min: 10, catalog_price: 15,
      materials: [{ material: 'PLA', color_name: 'Noir', color_hex: '#111111', grams: 30, spool_id: S1 }, { material: 'PLA', color_name: 'Blanc', color_hex: '#FFFFFF', grams: 10, spool_id: S2 }],
    }],
  ];
  return { S1, S2, M, T, ops };
}

const view = (S) => ({ ...app.cloneState(S), userId: U, pending: new Set() });

test('coût de revient d’un template multi-couleurs', () => {
  const f = fixture();
  const V = view(applyOps(app, f.ops));
  const t = V.templates.get(f.T);
  const c = app.templateCost(V, t);
  close(c.material, 30 * 0.022 + 10 * 0.02);
  close(c.purge, 3.75 * 0.022 + 1.25 * 0.02);
  close(c.machine, 2 * 0.2);
  close(c.labor, (10 / 60) * 20);
  close(c.hardware, 0.5);
  close(c.total, 0.86 + 0.1075 + 0.4 + 10 / 3 + 0.5);
  const st = app.settingsOf(V);
  assert.equal(app.suggestPrice(c.total, app.pricingOf(t, st)).rounded, 13.9);
  assert.equal(app.suggestPrice(c.total, { mode: 'margin', coef: 0, marginPct: 65, rounding: 'x.90' }).rounded, 14.9);
  const p = app.templatePrice(V, t, st);
  assert.equal(p.price, 15);
  close(p.margin.eur, 15 - c.total);
});

test('production : coûts figés, bobines et stock', () => {
  const f = fixture();
  let S = applyOps(app, f.ops);
  const V = view(S);
  const t = V.templates.get(f.T);
  const { payload, warnings } = app.planProduction(V, { template: t, quantity: 4, occurredAt: '2026-09-01T10:00:00Z' });
  assert.equal(warnings.length, 0);
  deepEqual(payload.consumption.map((c) => [c.spool_id, c.grams]), [[f.S1, 135], [f.S2, 45]]);
  close(payload.material_cost, 3.44);
  close(payload.purge_cost, 0.43);
  close(payload.hardware_cost, 2);
  close(payload.machine_cost, 1.6);
  close(payload.labor_cost, 13.3333);
  close(payload.total_cost, 20.8033);
  close(payload.unit_cost, 5.2008);
  S = applyOps(app, [...f.ops, ['production.launch', payload]]);
  assert.equal(S.spools.get(f.S1).remaining_weight_g, 865);
  assert.equal(S.spools.get(f.S2).remaining_weight_g, 955);
  assert.equal(S.production_stock.get(payload.lot_id).qty_available, 4);
});

test('print raté à 50 % : filament au prorata, ni stock ni main-d’œuvre', () => {
  const f = fixture();
  const V = view(applyOps(app, f.ops));
  const { payload } = app.planProduction(V, { template: V.templates.get(f.T), quantity: 1, kind: 'failure', failedPct: 50 });
  assert.equal(payload.consumption[0].grams, 16.88);
  assert.equal(payload.labor_cost, 0);
  assert.equal(payload.hardware_cost, 0);
  close(payload.machine_cost, 0.2);
  assert.equal(payload.lot_id, null);
  const S = applyOps(app, [...f.ops, ['production.launch', payload]]);
  assert.equal(S.production_stock.size, 0);
  assert.equal(S.spools.get(f.S1).remaining_weight_g, 983.12);
});

test('bobine insuffisante : avertissement, mais enregistrement possible', () => {
  const f = fixture();
  const S0 = applyOps(app, [...f.ops, ['spool.weigh', { id: app.uuid(), spool_id: f.S1, measured_g: 50, occurred_at: '2026-09-01T08:00:00Z' }]]);
  const V = view(S0);
  const { payload, warnings } = app.planProduction(V, { template: V.templates.get(f.T), quantity: 4, occurredAt: '2026-09-02T08:00:00Z' });
  assert.equal(warnings.filter((w) => w.type === 'spool_short').length, 1);
  const S = applyOps(app, [...f.ops, ['spool.weigh', { id: app.uuid(), spool_id: f.S1, measured_g: 50, occurred_at: '2026-09-01T08:00:00Z' }], ['production.launch', payload]]);
  assert.equal(S.spools.get(f.S1).remaining_weight_g, -85);
});

test('vente FIFO sur deux lots + marge nette + survente refusée', () => {
  const f = fixture();
  let S = applyOps(app, f.ops);
  let V = view(S);
  const t = V.templates.get(f.T);
  const p1 = app.planProduction(V, { template: t, quantity: 2, occurredAt: '2026-09-01T10:00:00Z' }).payload;
  const ops = [...f.ops, ['production.launch', p1]];
  V = view(applyOps(app, ops));
  const p2 = app.planProduction(V, { template: t, quantity: 3, occurredAt: '2026-09-03T10:00:00Z' }).payload;
  ops.push(['production.launch', { ...p2, unit_cost: 9, total_cost: 27 }]);
  V = view(applyOps(app, ops));
  const plan = app.planSale(V, {
    channel: 'etsy', shipping_cost: 4, packaging_cost: 1, platform_fee: 1.5, shipping_charged: 3,
    items: [
      { id: app.uuid(), template_id: f.T, item_name: t.name, quantity: 1, unit_price: 15 },
      { id: app.uuid(), template_id: f.T, item_name: t.name, quantity: 2, unit_price: 14 },
    ],
  });
  assert.equal(plan.shortages.length, 0);
  close(plan.cogs, p1.unit_cost * 2 + 9);
  close(plan.amount, 15 + 28 + 3);
  close(plan.net, 46 - (p1.unit_cost * 2 + 9) - 6.5);
  ops.push(['sale.record', plan.payload]);
  S = applyOps(app, ops);
  const sale = S.sales.get(plan.payload.id);
  close(sale.amount, 46);
  close(sale.net_margin, plan.net, 1e-3);
  assert.equal(S.production_stock.get(p1.lot_id).qty_available, 0);
  assert.equal(S.production_stock.get(p2.lot_id).qty_available, 2);
  const over = app.planSale(view(S), { items: [{ template_id: f.T, item_name: t.name, quantity: 5, unit_price: 10 }] });
  assert.equal(over.shortages[0].shortage, 3);
  assert.throws(() => applyOps(app, [...ops, ['sale.record', over.payload]]), (e) => e.code === 'P3D01');
});

test('file d’attente : une action déjà confirmée n’est pas comptée deux fois', () => {
  const f = fixture();
  const S0 = applyOps(app, f.ops);
  const V0 = view(S0);
  const { payload } = app.planProduction(V0, { template: V0.templates.get(f.T), quantity: 4 });
  const confirmed = applyOps(app, [...f.ops, ['production.launch', payload]]);
  const V = app.buildView(confirmed, [{ id: 'op1', type: 'production.launch', payload, status: 'sending' }], { userId: U, now: new Date().toISOString() });
  assert.equal(V.spools.get(f.S1).remaining_weight_g, 865);
  assert.equal(V.pendingCount, 1);
  const Vfailed = app.buildView(S0, [{ id: 'op1', type: 'production.launch', payload, status: 'failed' }], { userId: U, now: new Date().toISOString() });
  assert.equal(Vfailed.spools.get(f.S1).remaining_weight_g, 1000, 'une action refusée n’est pas affichée comme faite');
  assert.equal(Vfailed.failedOps.length, 1);
});

test('statistiques : CA, coûts, bénéfice, rebut', () => {
  const f = fixture();
  let V = view(applyOps(app, f.ops));
  const t = V.templates.get(f.T);
  const prod = app.planProduction(V, { template: t, quantity: 4, occurredAt: '2026-09-02T10:00:00Z' }).payload;
  const fail = app.planProduction(V, { template: t, quantity: 1, kind: 'failure', failedPct: 100, occurredAt: '2026-09-02T12:00:00Z' }).payload;
  const ops = [...f.ops, ['production.launch', prod], ['production.launch', fail]];
  V = view(applyOps(app, ops));
  const sale = app.planSale(V, { occurred_at: '2026-09-05T10:00:00Z', shipping_cost: 2, items: [{ id: app.uuid(), template_id: f.T, item_name: t.name, quantity: 2, unit_price: 15 }] }).payload;
  ops.push(['sale.record', sale]);
  V = view(applyOps(app, ops));
  const s = app.computeStats(V, { start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-10-01T00:00:00Z') });
  close(s.revenue, 30);
  close(s.cogs, prod.unit_cost * 2, 1e-3);
  close(s.failureLoss, fail.total_cost);
  close(s.costs, prod.unit_cost * 2 + 2 + fail.total_cost, 1e-3);
  close(s.net, 30 - s.costs);
  close(s.scrapRate, 20);
  close(s.gramsTotal, prod.grams_total + fail.grams_total);
  const b = s.breakdown;
  close(b.material + b.machine + b.labor + b.hardware + b.other, s.cogs, 1e-3);
});

test('courbe mensuelle : aucun mois futur compté à 0 €', () => {
  const f = fixture();
  let V = view(applyOps(app, f.ops));
  const t = V.templates.get(f.T);
  const prod = app.planProduction(V, { template: t, quantity: 4, occurredAt: '2026-09-02T10:00:00Z' }).payload;
  const ops = [...f.ops, ['production.launch', prod]];
  V = view(applyOps(app, ops));
  const sale = app.planSale(V, { occurred_at: '2026-09-05T10:00:00Z', items: [{ id: app.uuid(), template_id: f.T, item_name: t.name, quantity: 2, unit_price: 15 }] }).payload;
  V = view(applyOps(app, [...ops, ['sale.record', sale]]));
  const now = new Date(2026, 8, 16, 12, 0);

  const month = app.monthlySeries(V, 'month', now);
  assert.equal(month.length, 12);
  assert.equal(month[0].label, 'oct. 25');
  assert.equal(month[11].label, 'sept. 26');
  close(month[11].revenue, 30);
  assert.ok(month.every((m) => m.revenue !== null));

  const prev = app.monthlySeries(V, 'prev', now);
  assert.equal(prev[11].label, 'août 26');
  close(prev[11].revenue, 0);

  const year = app.monthlySeries(V, 'year', now);
  deepEqual(year.map((m) => m.label), ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']);
  close(year[8].revenue, 30);
  deepEqual(year.slice(9).map((m) => [m.revenue, m.net]), [[null, null], [null, null], [null, null]]);

  const all = app.monthlySeries(V, 'all', now);
  assert.equal(all.length, 12);
  assert.equal(all[11].label, 'sept. 26');
  const old = app.planSale(V, { occurred_at: '2001-01-10T10:00:00Z', items: [{ id: app.uuid(), item_name: 'Ancienne', quantity: 1, unit_price: 5, from_stock: false }] }).payload;
  const Vold = view(applyOps(app, [...ops, ['sale.record', sale], ['sale.record', old]]));
  const allOld = app.monthlySeries(Vold, 'all', now);
  assert.equal(allOld.length, 120, 'une date très ancienne ne crée pas des centaines de points');
  assert.equal(allOld[119].label, 'sept. 26');
});

test('export CSV : montants au centime arrondis comme l’écran et la base (négatifs compris)', () => {
  const S = applyOps(app, [
    ['stock.add', { id: 'l2', template_id: null, item_name: 'Porte-clés', unit_cost: 3.375, quantity: 5, occurred_at: '2026-09-01T10:00:00Z' }],
    ['sale.record', { id: 's9', channel: 'direct', occurred_at: '2026-09-10T10:00:00Z', shipping_charged: 0, shipping_cost: 0, packaging_cost: 0, platform_fee: 0, items: [{ id: 'i9', item_name: 'Porte-clés', quantity: 1, unit_price: 3.25, from_stock: true }] }],
  ], U);
  const V = { ...S, pending: new Set() };
  close(V.sales.get('s9').net_margin, -0.125);
  const row = app.exportCsvSales(V).split(/\r?\n/)[1].split(';');
  assert.equal(row[6], '3,38', 'coût 3,375 → 3,38');
  assert.equal(row[10], '-0,13', 'marge −0,125 → −0,13 (comme à l’écran)');
  assert.equal(spaces(app.fmtEur(-0.125)), '-0,13 €');
});

test('champs en euros : « 22,50 » affiché, mais 0 et les entiers restent tels quels (frappe au bout du champ)', () => {
  const shown = (v) => /value="([^"]*)"/.exec(String(app.inputNum('x', v, { suffix: '€' })))[1];
  assert.equal(shown(22.5), '22,50');
  assert.equal(shown(1.2345), '1,2345', 'jamais arrondi');
  assert.equal(shown(0), '0');
  assert.equal(shown(20), '20');
  assert.equal(shown(null), '');
  assert.equal(app.parseNum(`${shown(0)}2`), 2, '« 0 » + « 2 » = 2 (et non « 0,002 » = 0)');
  assert.equal(/value="([^"]*)"/.exec(String(app.inputNum('x', 0.3, { suffix: '€/h' })))[1], '0,30');
  assert.equal(/value="([^"]*)"/.exec(String(app.inputNum('x', 2.5, { suffix: '×' })))[1], '2,5', 'pas un montant');
});

test('accords : décidés sur le nombre affiché', () => {
  assert.equal(app.plural(0, 'pièce', 'pièces'), '0 pièce');
  assert.equal(app.plural(1, 'pièce', 'pièces'), '1 pièce');
  assert.equal(app.plural(2, 'pièce', 'pièces'), '2 pièces');
  assert.equal(app.plural(1.5, 'pièce', 'pièces'), '2 pièces');
});

test('export CSV : Excel français et formules neutralisées', () => {
  const csv = app.toCsv(['A', 'B', 'C'], [[1.5, '=SUM(A1)', 'x;y']]);
  assert.ok(csv.startsWith('﻿A;B;C'));
  assert.ok(csv.includes("1,5;'=SUM(A1);\"x;y\""));
});

test('durées du slicer', () => {
  close(app.parseDurationToMin('1h 23m 45s'), 83.75);
  close(app.parseDurationToMin('2h35'), 155);
  close(app.parseDurationToMin('2 h 35 min'), 155);
  close(app.parseDurationToMin('155 min'), 155);
  close(app.parseDurationToMin('1:35:00'), 95);
  close(app.parseDurationToMin('2,5 h'), 150);
  close(app.parseDurationToMin('1d 2h 3m 4s'), 1440 + 123 + 4 / 60);
  close(app.parseDurationToMin('45s'), 0.75);
  close(app.parseDurationToMin('23m 5s'), 23 + 5 / 60);
  assert.ok(Number.isNaN(app.parseDurationToMin('rien')));
});

// Format vérifié dans le code source de Bambu Studio (bbs_3mf.cpp, _add_slice_info_config_file_to_archive)
const SLICE_INFO = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="02.02.01.60"/>
  </header>
  <plate>
    <metadata key="index" value="1"/>
    <metadata key="extruder_type" value="0"/>
    <metadata key="printer_model_id" value="C12"/>
    <metadata key="nozzle_diameters" value="0.4"/>
    <metadata key="timelapse_type" value="0"/>
    <metadata key="prediction" value="5025"/>
    <metadata key="weight" value="23.45"/>
    <metadata key="outside" value="false"/>
    <object identify_id="101" name="Support manette.stl" skipped="false" />
    <object identify_id="102" name="Support manette.stl" skipped="false" />
    <object identify_id="103" name="Support manette.stl" skipped="true" />
    <filament id="1" tray_info_idx="GFA00" type="PLA" color="#161616" used_m="7.53" used_g="22.46" group_id="0" nozzle_diameter="0.40" volume_type="Standard" used_for_object="true" used_for_support="false" total_load_time="0" total_unload_time="0"/>
    <filament id="3" tray_info_idx="GFG99" type="PETG HF" color="#F2F2F2FF" used_m="0.33" used_g="0.99" group_id="0" nozzle_diameter="0.40" volume_type="Standard" used_for_object="true" used_for_support="false" total_load_time="0" total_unload_time="0"/>
    <mixed_filament id="9" type="PLA" color="#000000" components="1,3"/>
  </plate>
  <plate>
    <metadata key="index" value="2"/>
    <metadata key="prediction" value="600"/>
    <metadata key="weight" value="5.00"/>
    <object identify_id="201" name="Cale &amp; clip" skipped="false" />
    <filament id="2" type="PLA-CF" color="#D32F2F" used_m="1.60" used_g="5.00"/>
  </plate>
</config>`;

test('import Bambu Studio : slice_info.config', () => {
  const plates = app.parseBambuSliceInfo(SLICE_INFO);
  assert.equal(plates.length, 2);
  close(plates[0].timeMin, 5025 / 60);
  assert.equal(plates[0].objects.length, 2, 'objets ignorés exclus');
  deepEqual(plates[0].filaments.map((x) => [x.type, x.color, x.grams]), [['PLA', '#161616', 22.46], ['PETG', '#F2F2F2', 0.99]]);
  assert.equal(plates[1].objects[0].name, 'Cale & clip');
  assert.equal(plates[1].filaments[0].type, 'PLA-CF');
  const res = app.parseSlicerText(SLICE_INFO);
  assert.equal(res.purgeIncluded, true);
  assert.equal(res.pieces, 2);
});

test('import Bambu Studio : en-tête G-code', () => {
  const g = `; HEADER_BLOCK_START
; BambuStudio 02.02.01.60
; model printing time: 1h 23m 45s; total estimated time: 1h 30m 10s
; total layer number: 150
; total filament length [mm] : 7530.12,330.45
; total filament volume [cm^3] : 18112.34,794.81
; total filament weight [g] : 22.46,0.99
; filament_density: 1.24,1.24
; HEADER_BLOCK_END
G28
; filament_type = PLA;PETG
; filament_colour = #FFFFFF;#000000
`;
  const r = app.parseGcodeText(g);
  close(r.timeMin, 90 + 10 / 60);
  deepEqual(r.filaments.map((x) => [x.type, x.color, x.grams]), [['PLA', '#FFFFFF', 22.46], ['PETG', '#000000', 0.99]]);
  assert.equal(r.warnings.length, 0);
});

test('import PrusaSlicer / Orca : fin de G-code', () => {
  const g = `; filament used [mm] = 4000.12
; filament used [g] = 12.34
; total filament used for wipe tower [g] = 1.50
; estimated printing time (normal mode) = 1h 2m 3s
; filament_colour = #FF8000
; filament_type = PETG`;
  const r = app.parseGcodeText(g);
  close(r.timeMin, 62.05);
  deepEqual(r.filaments.map((x) => [x.type, x.color, x.grams]), [['PETG', '#FF8000', 12.34]]);
  assert.equal(r.purgeG, 0, 'la tour est déjà dans « filament used [g] » : pas de double comptage');
  assert.equal(r.purgeIncluded, true);
});

test('import texte collé (français)', () => {
  const r = app.parseSlicerText("Support Manette Universel\nPoids : 45,2 g\nTemps d'impression : 2h35");
  assert.equal(r.name, 'Support Manette Universel');
  assert.equal(r.filaments.length, 1);
  close(r.filaments[0].grams, 45.2);
  close(r.timeMin, 155);
  const multi = app.parseSlicerText('Nom : Porte-clés\nPLA #111111 : 30 g\nPLA #FFFFFF : 10 g\nTour de purge : 5 g\nDurée : 2 h 00\nPièces : 4');
  assert.equal(multi.name, 'Porte-clés');
  deepEqual(multi.filaments.map((x) => [x.color, x.grams]), [['#111111', 30], ['#FFFFFF', 10]]);
  assert.equal(multi.purgeG, 5);
  close(multi.timeMin, 120);
  assert.equal(multi.pieces, 4);
});

test('import → fiche par pièce, bobines reconnues par la couleur', () => {
  const f = fixture();
  const V = view(applyOps(app, f.ops));
  const res = app.parseSlicerText(SLICE_INFO);
  res.name = 'Support';
  const t = app.importToTemplate(V, res, { pieces: 2 });
  assert.equal(t.pieces_per_print, 2);
  close(t.print_time_min, 5025 / 60 / 2, 0.01);
  assert.equal(t.materials[0].grams, 11.23);
  assert.equal(t.materials[0].spool_id, f.S1, 'le noir du fichier est relié à la bobine noire');
  assert.equal(t.materials[1].spool_id, null, 'pas de PETG dans le parc');
  const t2 = app.importToTemplate(V, res, { pieces: 1, plateIndex: 2 });
  assert.equal(t2.materials[0].material, 'PLA-CF');
  close(t2.print_time_min, 10);
});

test('clés Supabase : la clé secrète est refusée', () => {
  assert.equal(app.keyProblem('sb_publishable_abc123'), null);
  assert.match(app.keyProblem('sb_secret_abc123'), /SECRÈTE/);
  const jwt = (role) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.sig`;
  assert.equal(app.keyProblem(jwt('anon')), null);
  assert.match(app.keyProblem(jwt('service_role')), /service_role/);
  assert.equal(app.normalizeSupaUrl('abcdefghijklmnopqrst'), 'https://abcdefghijklmnopqrst.supabase.co');
  assert.equal(app.normalizeSupaUrl('http://evil.example.com'), '', 'http refusé hors machine locale');
  assert.equal(app.normalizeSupaUrl('https://abcdefghijklmnopqrst.supabase.co/rest/v1/'), 'https://abcdefghijklmnopqrst.supabase.co');
  assert.equal(app.projectRefFromUrl('https://abcdefghijklmnopqrst.supabase.co'), 'abcdefghijklmnopqrst');
});

test('classement des erreurs réseau / session / refus', () => {
  const e = (props) => Object.assign(new Error(props.message || 'x'), props);
  assert.equal(app.classifyError(e({ message: 'TypeError: Failed to fetch', status: 0 })), 'network');
  assert.equal(app.classifyError(e({ message: 'Load failed', status: 0 })), 'network');
  assert.equal(app.classifyError(e({ message: 'JWT expired', status: 401, code: 'PGRST303' })), 'auth');
  assert.equal(app.classifyError(e({ message: 'Stock insuffisant', status: 400, code: 'P3D01' })), 'business');
  assert.equal(app.classifyError(e({ message: 'Could not find the function', status: 404, code: 'PGRST202' })), 'schema');
  assert.equal(app.classifyError(e({ message: 'upstream', status: 503 })), 'network');
  assert.equal(app.friendlyError(e({ code: '23503' }), { type: 'spool.delete' }), "Impossible de supprimer : cet élément est utilisé dans l'historique. Archive-le plutôt.");
  // un refus de la base dont le texte contient « connexion » ou « time out » reste un refus
  assert.equal(app.classifyError(e({ message: 'Stock insuffisant pour « Boîtier de connexion » : il manque 1 pièce(s).', status: 400, code: 'P3D01' })), 'business');
  assert.equal(app.classifyError(e({ message: 'Stock insuffisant pour « Time Out edition »', status: 400, code: 'P3D01' })), 'business');
  assert.equal(app.classifyError(e({ message: 'permission denied', status: 403, code: '42501' })), 'auth');
  assert.equal(app.classifyError(e({ message: 'quelconque', status: 0 })), 'network');
});

test('horodatage à la microseconde', () => {
  assert.equal(app.tsMicros('2026-09-16T10:00:00.123456+00:00') - app.tsMicros('2026-09-16T10:00:00.123455+00:00'), 1);
  assert.equal(app.tsMicros('2026-09-16T12:00:00.5+02:00'), app.tsMicros('2026-09-16T10:00:00.500000Z'));
  assert.equal(app.tsMicros('2026-09-16 10:00:00+00'), app.tsMicros('2026-09-16T10:00:00Z'));
  assert.equal(app.tsMicros(null), 0);
});

function freshStore() {
  app.Store.S = app.emptyState();
  app.Store.tombstones = new Map();
  app.Store.receivedAt = new Map();
  app.Store.dirty = new Set();
  return app.Store;
}

test('temps réel : une version plus ancienne n’écrase jamais la plus récente', () => {
  const S = freshStore();
  const base = { id: 's1', owner_id: U, channel: 'etsy', amount: 0, cogs: 0, shipping_cost: 4, packaging_cost: 1, platform_fee: 0, shipping_charged: 0, created_at: '2026-09-16T10:00:00.100000+00:00' };
  const insertEvt = { ...base, updated_at: '2026-09-16T10:00:00.100000+00:00' };
  const final = { ...base, amount: 45, cogs: 13.41, net_margin: 26.59, updated_at: '2026-09-16T10:00:00.100734+00:00' };
  // la réponse HTTP (version finale) arrive d'abord, puis l'évènement d'insertion en retard
  S.upsertRows('sales', [final]);
  S.upsertRows('sales', [insertEvt], { source: 'realtime' });
  assert.equal(S.S.sales.get('s1').amount, 45);
  // dans l'autre ordre aussi
  const S2 = freshStore();
  S2.upsertRows('sales', [insertEvt], { source: 'realtime' });
  S2.upsertRows('sales', [{ ...final, net_margin: undefined }], { source: 'realtime' });
  assert.equal(S2.S.sales.get('s1').amount, 45);
  assert.equal(S2.S.sales.get('s1').net_margin, 26.59, 'colonne calculée recalculée si absente');
});

test('temps réel : colonnes absentes gardées, nombres en texte convertis', () => {
  const S = freshStore();
  S.upsertRows('templates', [{ id: 't1', owner_id: U, name: 'Vase', photo: 'data:image/webp;base64,AAAA', catalog_price: 12.9, updated_at: '2026-09-16T10:00:00.000001Z' }]);
  S.upsertRows('templates', [{ id: 't1', owner_id: U, name: 'Vase', archived: true, catalog_price: '13.90', updated_at: '2026-09-16T10:00:01.000001Z' }], { source: 'realtime' });
  const t = S.S.templates.get('t1');
  assert.equal(t.photo, 'data:image/webp;base64,AAAA', 'grande valeur inchangée non renvoyée par le temps réel');
  assert.equal(t.archived, true);
  assert.equal(t.catalog_price, 13.9);
  const rev = S.rev;
  S.upsertRows('templates', [{ ...t }]);
  assert.equal(S.rev, rev, 'même version, même contenu : aucun rafraîchissement inutile');
});

test('suppression : les évènements en retard ne font pas réapparaître la ligne', () => {
  const S = freshStore();
  S.upsertRows('sales', [{ id: 's9', owner_id: U, amount: 10, cogs: 1, updated_at: '2026-09-16T10:00:00.000002Z' }]);
  S.deleteIds('sales', ['s9']);
  S.upsertRows('sales', [{ id: 's9', owner_id: U, amount: 10, cogs: 1, updated_at: '2026-09-16T10:00:00.000002Z' }], { source: 'realtime' });
  assert.equal(S.S.sales.has('s9'), false);
});

test('suppression confirmée appliquée même si la base ne renvoie rien (renvoi)', () => {
  const f = fixture();
  let V = view(applyOps(app, f.ops));
  const t = V.templates.get(f.T);
  const prod = app.planProduction(V, { template: t, quantity: 3, occurredAt: '2026-09-02T10:00:00Z' }).payload;
  const ops = [...f.ops, ['production.launch', prod]];
  V = view(applyOps(app, ops));
  const sale = app.planSale(V, { items: [{ id: app.uuid(), template_id: f.T, item_name: t.name, quantity: 2, unit_price: 15 }] }).payload;
  ops.push(['sale.record', sale]);
  const confirmed = applyOps(app, ops);
  const S = freshStore();
  for (const tb of app.TABLES) S.S[tb] = confirmed[tb];
  assert.equal(S.S.production_stock.get(prod.lot_id).qty_available, 1);
  S.applyConfirmedDelete({ type: 'sale.delete', payload: { id: sale.id } });
  S.mergeBundle({ deleted: { sales: [] } });
  assert.equal(S.S.sales.has(sale.id), false);
  assert.equal([...S.S.sale_items.values()].filter((i) => i.sale_id === sale.id).length, 0);
  assert.equal(S.S.sale_allocations.size, 0);
  assert.equal(S.S.production_stock.get(prod.lot_id).qty_available, 3, 'les pièces reviennent en stock');
});

test('attributs HTML : toujours échappés', () => {
  const out = String(app.attrList({ 'data-key': 'n:Support 27" "><img src=x onerror=alert(1)>', autofocus: true, hidden: false }));
  assert.ok(!out.includes('<img'));
  assert.ok(out.includes('data-key="n:Support 27&quot;'));
  assert.ok(out.includes('autofocus'));
  assert.ok(!out.includes('hidden'));
  assert.throws(() => app.attrList('onclick="x"'));
  assert.throws(() => app.attrList({ 'on click': 'x' }));
});

test('icônes : toutes celles demandées sont présentes dans le build', () => {
  for (const n of ['LayoutDashboard', 'Disc3', 'Layers', 'Store', 'Settings', 'Printer', 'ShoppingBag', 'Flame', 'Scale', 'FileUp']) {
    assert.ok(Array.isArray(app.ICONS[n]), n);
  }
  assert.match(app.APP_VERSION, /^\d+\.\d+\.\d+-[0-9a-f]{8}$/);
});
