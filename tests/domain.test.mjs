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
  assert.equal(r.purgeG, 1.5);
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
});

test('icônes : toutes celles demandées sont présentes dans le build', () => {
  for (const n of ['LayoutDashboard', 'Disc3', 'Layers', 'Store', 'Settings', 'Printer', 'ShoppingBag', 'Flame', 'Scale', 'FileUp']) {
    assert.ok(Array.isArray(app.ICONS[n]), n);
  }
  assert.match(app.APP_VERSION, /^\d+\.\d+\.\d+-[0-9a-f]{8}$/);
});
