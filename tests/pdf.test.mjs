// PDF fait maison (bilan du mois, étiquettes) : fichier valide, texte français correct, rien de coupé en silence.
// Lancer : node tools/build.mjs --dev && node --test tests/pdf.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadApp, applyOps } from './load-app.mjs';

// QR factice (la vraie bibliothèque vient d'internet) : damier de 21 × 21 modules
const fakeQr = () => ({ addData() {}, make() {}, getModuleCount: () => 21, isDark: (r, c) => (r + c) % 2 === 0 });
const app = loadApp({ qrcode: fakeQr });
const USER = '00000000-0000-4000-8000-000000000001';
// les tableaux de l'appli viennent d'un autre « monde » JavaScript (bac à sable) : on compare leur contenu
const deepEqual = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, m);

// Relit un PDF produit : objets, table xref, flux et textes écrits (décodés depuis WinAnsi)
const WIN_BACK = { 0x80: '€', 0x85: '…', 0x8c: 'Œ', 0x92: '’', 0x96: '–', 0x97: '—', 0x9c: 'œ', 0xa0: '\u00a0' };
function parsePdf(out) {
  assert.ok(out.startsWith('%PDF-1.4\n'), 'en-tête PDF');
  assert.ok(out.endsWith('%%EOF\n'), 'fin de fichier');
  assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(out), 'fichier en ASCII pur (longueurs en caractères = octets)');
  const startxref = +/startxref\n(\d+)\n%%EOF\n$/.exec(out)[1];
  assert.ok(out.startsWith('xref\n', startxref), 'startxref pointe sur la table xref');
  const [, first, count] = /^xref\n(\d+) (\d+)\n/.exec(out.slice(startxref));
  assert.equal(+first, 0);
  const entries = out.slice(startxref).split('\n').slice(2, 2 + +count);
  assert.equal(entries[0], '0000000000 65535 f ');
  for (let i = 1; i < entries.length; i++) {
    assert.match(entries[i], /^\d{10} 00000 n $/, `entrée xref ${i} : 20 octets`);
    assert.ok(out.startsWith(`${i} 0 obj\n`, +entries[i].slice(0, 10)), `objet ${i} à l'endroit annoncé`);
  }
  const streams = [...out.matchAll(/<< \/Length (\d+) >>\nstream\n/g)].map((m) => {
    const start = m.index + m[0].length;
    const len = +m[1];
    assert.ok(out.startsWith('\nendstream', start + len), 'longueur du flux exacte');
    return out.slice(start, start + len);
  });
  const pages = +/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(out)[1];
  // aucun texte hors de la feuille (une page qui ne se coupe pas écrirait SOUS le bas de la page)
  for (const st of streams) {
    for (const [, x, y] of st.matchAll(/ (-?[\d.]+) (-?[\d.]+) Td /g)) {
      assert.ok(+x >= 0 && +x <= 595.28 && +y >= 15 && +y <= 841.89 - 15, `texte hors de la page en (${x}, ${y})`);
    }
  }
  const decode = (s) => s.replace(/\\([0-7]{3}|[()\\])/g, (_, e) => (e.length === 3 ? String.fromCharCode(parseInt(e, 8)) : e))
    .replace(/[\x80-\xff]/g, (ch) => WIN_BACK[ch.charCodeAt(0)] ?? ch);
  const texts = streams.map((st) => [...st.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => decode(m[1])));
  return { pages, streams, texts, all: texts.flat() };
}
const nb = (s) => s.replace(/[\u202f\u00a0]/g, '\u00a0');

test('polices : tables de largeurs complètes, accents et symboles mesurés', () => {
  assert.equal(app.pdfWidth('é', 10), app.pdfWidth('e', 10), 'lettre accentuée = lettre de base');
  assert.equal(app.pdfWidth('€', 10), 5.56);
  assert.equal(app.pdfWidth('W', 10, true), 9.44);
  assert.equal(app.pdfWidth('~', 10), 5.84, 'dernier caractère de la table : la table a bien 95 largeurs');
  assert.equal(app.pdfWidth('~', 10, true), 5.84);
  assert.ok(app.pdfWidth('Illisible', 10, true) > app.pdfWidth('Illisible', 10), 'le gras est plus large');
});

test('encodage : français complet, séparateurs de milliers, émojis remplacés, jamais d’erreur', () => {
  const codes = (s) => app.pdfChars(s).map((c) => c.b);
  deepEqual(codes('Œuf à 1\u202f234,56\u00a0€ — ’'), [0x8c, 0x75, 0x66, 0x20, 0xe0, 0x20, 0x31, 0xa0, 0x32, 0x33, 0x34, 0x2c, 0x35, 0x36, 0xa0, 0x80, 0x20, 0x97, 0x20, 0x92]);
  deepEqual(codes('e\u0301'), [0xe9], 'accent tapé en deux morceaux (macOS) : recomposé');
  deepEqual(codes('👍🏽 ok'), [63, 63, 0x20, 0x6f, 0x6b], 'émoji → « ? », sans planter');
  deepEqual(codes('\u2764\ufe0f'), [63], 'sélecteur de variante ignoré');
  deepEqual(codes('a\tb\nc'), [0x61, 0x20, 0x62, 0x20, 0x63]);
  deepEqual(codes('−5'), [0x2d, 0x35], 'signe moins typographique → tiret');
  deepEqual(codes(null), []);
});

test('coupes : « … » quand ça déborde, lignes jamais plus larges que la colonne', () => {
  const long = 'Support de téléphone articulé « Deluxe » avec rotule et pied lesté (modèle 2026)';
  const fit = app.pdfFit(long, 100, 9);
  assert.ok(fit.endsWith('…') && app.pdfWidth(fit, 9) <= 100, fit);
  assert.equal(app.pdfFit('Court', 100, 9), 'Court');
  assert.equal(app.pdfFit('Texte', 1, 9), '', 'rien ne tient : chaîne vide');

  const lines = app.pdfWrap(long, 120, 8);
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(app.pdfWidth(l, 8) <= 120, `ligne trop large : ${l}`);
  assert.equal(lines.join(' ').replace(/\u00a0/g, ' '), long, 'rien de perdu quand tout tient');
  assert.ok(!lines.some((l) => l.endsWith('«') || l.startsWith('»')), `guillemets séparés de leur mot : ${JSON.stringify(lines)}`);

  const two = app.pdfWrap(long, 60, 8, false, 2);
  assert.equal(two.length, 2);
  assert.ok(two[1].endsWith('…') && app.pdfWidth(two[1], 8) <= 60, 'dernière ligne tronquée proprement');

  // mot sans espace plus large que la colonne : coupé net, et la boucle se termine
  const hard = app.pdfWrap('Supercalifragilisticexpialidocious', 30, 8);
  for (const l of hard) assert.ok(app.pdfWidth(l, 8) <= 30 || [...l].length === 1, l);
  assert.equal(hard.join(''), 'Supercalifragilisticexpialidocious');
  deepEqual(app.pdfWrap('👍', 0.5, 8), ['👍'], 'caractère plus large que la colonne : pas de boucle infinie');
  deepEqual(app.pdfWrap('', 50, 8), ['']);
  assert.equal(app.pdfWrap('1\u202f234,56\u00a0€ payé', 45, 8)[0], '1\u202f234,56\u00a0€', 'un montant n’est jamais coupé en deux');
});

test('fichier PDF : structure exacte, textes échappés, titre lisible', () => {
  const doc = app.pdfDocument('Bilan de février (test)');
  doc.page();
  doc.text('Parenthèses (a) \\ b', 40, 60, { size: 10 });
  doc.rect(40, 80, 100, 50, { stroke: '#9ca3af', dash: [3, 2], radius: 6 });
  doc.circle(60, 160, 5, { fill: '#E11D48', stroke: '#6b7280' });
  doc.line(40, 200, 200, 200);
  doc.page();
  doc.text('Deuxième page', 300, 60, { align: 'right' });
  const out = doc.output();
  const p = parsePdf(out);
  assert.equal(p.pages, 2);
  assert.deepEqual(p.texts, [['Parenthèses (a) \\ b'], ['Deuxième page']]);
  assert.ok(p.streams[0].includes('[3 2] 0 d'), 'pointillés');
  assert.match(out, /\/Title <FEFF0042[0-9A-F]+>/, 'titre en UTF-16 (accents lisibles dans tous les lecteurs)');
  assert.ok(!/NaN|Infinity|undefined|e[+-]\d/.test(p.streams.join('\n')), 'aucun nombre invalide dans les dessins');
  assert.equal(parsePdf(app.pdfDocument('vide').output()).pages, 1, 'jamais de PDF sans page');
});

// Scénario : un mois chargé (plusieurs pages), une commande livrée en août retouchée en septembre
function scenario() {
  const ops = [];
  let S = app.emptyState();
  const view = () => ({ ...app.cloneState(S), userId: USER, pending: new Set() });
  const run = (type, payload) => {
    ops.push([type, payload]);
    S = applyOps(app, ops, USER);
  };
  run('settings.save', { ...app.DEFAULT_SETTINGS, workshop_name: 'Atelier « Paulo » (3D)' });
  const spools = [];
  for (let i = 0; i < 15; i++) {
    const id = randomUUID();
    spools.push(id);
    run('spool.save', { id, brand: 'Bambu Lab', material: 'PLA', color_name: i === 3 ? 'Œuf « Pâques » 👍 édition très très longue' : `Couleur ${i}`, color_hex: '#E11D48', price: 20 + i, initial_weight_g: 1000, tare_g: 245, purchased_at: i === 4 ? 'pas-une-date' : `2026-09-${String(1 + i).padStart(2, '0')}`, notes: null, archived: false });
  }
  const T = randomUUID();
  run('template.save', {
    id: T, name: 'Support « Deluxe » (modèle 2026)', description: null, photo: null, machine_id: null, pieces_per_print: 2, purge_g: 0, hardware_cost: 0, print_time_min: 60, labor_min: 5,
    pricing_mode: null, price_coef: null, target_margin_pct: null, catalog_price: 15, archived: false,
    materials: [{ material: 'PLA', color_name: 'Couleur 0', color_hex: '#E11D48', grams: 10, spool_id: spools[0] }],
  });
  const produce = (when) => {
    const V = view();
    run('production.launch', app.planProduction(V, { template: V.templates.get(T), quantity: 10, kind: 'production', failedPct: 100, occurredAt: when, reason: null }).payload);
  };
  const sell = (when, price = 15, customer = '', orderId = null) => {
    const V = view();
    const plan = app.planSale(V, { occurred_at: when, channel: 'direct', customer, items: [{ id: randomUUID(), template_id: T, item_name: 'Support « Deluxe » (modèle 2026)', quantity: 1, unit_price: price }] });
    assert.equal(plan.shortages.length, 0);
    run('sale.record', orderId ? { ...plan.payload, order_id: orderId } : plan.payload);
    return plan.payload;
  };
  produce('2026-08-01T08:00:00Z');
  // commande livrée en août : la vente porte la commande (une seule action)
  const order = randomUUID();
  run('order.save', { id: order, customer: 'Léa', template_id: T, item_name: 'Support', quantity: 1, unit_price: 15, due_date: null, channel: null, note: null, status: 'todo', sale_id: null });
  sell('2026-08-20T10:00:00Z', 15, 'Léa', order);
  for (let d = 1; d <= 6; d++) produce(`2026-09-0${d}T08:00:00Z`);
  for (let k = 0; k < 50; k++) sell(`2026-09-${String(1 + (k % 28)).padStart(2, '0')}T12:00:00Z`, k === 0 ? 123456.78 : 15, `Client (${k})`);
  const open = randomUUID();
  run('order.save', { id: open, customer: 'Tom', template_id: null, item_name: 'Vase', quantity: 2, unit_price: null, due_date: '2026-09-25', channel: null, note: null, status: 'todo', sale_id: null });
  // la commande livrée en août est retouchée en septembre (note) : elle reste comptée en août
  const later = [['order.patch', { id: order, fields: { note: 'facture envoyée' } }, '2026-09-10T10:00:00Z']];
  S = applyOps(app, [...ops, ...later], USER);
  return { V: view(), spools };
}

test('bilan du mois : bons chiffres, plusieurs pages, montants jamais coupés, pied de page partout', () => {
  const { V } = scenario();
  const now = new Date('2026-09-18T12:00:00Z');
  const sept = app.monthReport(V, '2026-09', now);
  const aout = app.monthReport(V, '2026-08', now);
  assert.equal(sept.sales.length, 50);
  assert.equal(aout.delivered, 1, 'commande livrée comptée au mois de SA vente…');
  assert.equal(sept.delivered, 0, '… même retouchée le mois suivant');
  assert.equal(sept.openOrders, 1, 'mois en cours : commandes en cours d’aujourd’hui');
  assert.equal(aout.openOrders, null, 'mois passé : pas de « commandes en cours » (ce serait l’état d’aujourd’hui)');
  assert.ok(!app.reportKpis(aout).some(([l]) => l === 'Commandes en cours'));
  assert.equal(sept.spools.length, 14, 'bobine à la date d’achat illisible : ignorée, sans planter');

  const p = parsePdf(app.reportPdf(V, sept));
  assert.ok(p.pages >= 2, `50 ventes = plusieurs pages (${p.pages})`);
  p.texts.forEach((t, i) => {
    assert.ok(t.includes(`Page ${i + 1}/${p.pages}`), `numéro de page ${i + 1}`);
    if (i > 0 && t.includes('Articles')) assert.ok(t.includes('Encaissé'), 'en-tête du tableau répété sur la nouvelle page');
  });
  const big = nb(app.fmtEur(123456.78));
  assert.ok(p.all.map(nb).some((s) => s === big), `gros montant écrit en entier (${big})`);
  assert.ok(p.all.map(nb).includes(nb(app.fmtEur(sept.stats.revenue))), 'total des ventes');
  assert.ok(p.all.includes('Bilan de septembre 2026'));
  assert.ok(p.all.some((s) => s.startsWith('Atelier « Paulo » (3D)')), 'parenthèses et guillemets du nom d’atelier');

  const vide = parsePdf(app.reportPdf(V, app.monthReport(V, '2026-03', now)));
  assert.equal(vide.pages, 1);
  assert.ok(vide.all.includes('Aucune vente ce mois-ci.'));
});

test('étiquettes : 14 par page, un QR par bobine avec SON lien, textes trop longs coupés', () => {
  const { V, spools } = scenario();
  const links = [];
  const out = app.labelsPdf(V, spools, (id) => {
    links.push(id);
    return `https://exemple.test/#/bobines?peser=${id}`;
  });
  const p = parsePdf(out);
  assert.equal(app.LABEL_GRID.cols * app.LABEL_GRID.rows, 14);
  assert.equal(p.pages, 2, '15 bobines = 2 pages');
  assert.deepEqual(links, spools, 'un QR par bobine, dans l’ordre choisi');
  assert.equal(p.streams.filter((s) => s.includes(' re\n') || s.includes(' re ')).length, 2);
  assert.equal(p.all.filter((s) => s === 'Scanne pour peser').length, 15);
  const long = p.all.find((s) => s.startsWith('Œuf'));
  assert.ok(long && long.endsWith('…'), `nom trop long coupé : ${long}`);
  assert.ok(p.all.includes('Achat : 1 sept. 2026'));
  assert.equal(app.fmtPlainDate('2026-09-12'), '12 sept. 2026');
  assert.equal(app.fmtPlainDate('2026-13-01'), '');
  assert.equal(app.fmtPlainDate(null), '');

  // sans la bibliothèque QR (hors-ligne la 1re fois) : les étiquettes sortent quand même, sans QR
  const sansQr = loadApp();
  const q = parsePdf(sansQr.labelsPdf(V, spools.slice(0, 2), () => 'x'));
  assert.equal(q.pages, 1);
  assert.ok(!q.streams[0].includes(' re\n'), 'pas de QR dessiné');
});

test('scanner : seul le numéro d’une bobine est lu dans le QR, rien d’autre', () => {
  const id = '3f2b8c1a-9d4e-4b7a-8c21-5e6f7a8b9c0d';
  assert.equal(app.spoolIdFromLabel(`https://fadeflux.github.io/paulo3d/#/bobines?peser=${id}`), id);
  assert.equal(app.spoolIdFromLabel(`https://autre.site/#/bobines?peser=${id.toUpperCase()}`), id, 'majuscules acceptées');
  assert.equal(app.spoolIdFromLabel(`#/bobines?x=1&peser=${id}`), id);
  assert.equal(app.spoolIdFromLabel(`peser=${id}`), null, 'pas un lien d’étiquette');
  assert.equal(app.spoolIdFromLabel(`#/bobines?peser=${id}0`), null, 'identifiant trop long');
  assert.equal(app.spoolIdFromLabel('javascript:alert(1)'), null);
  assert.equal(app.spoolIdFromLabel(null), null);
});

test('commandes : mêmes limites que la base (quantité, textes, prix)', () => {
  const ok = { item_name: 'Vase', quantity: 10000, unit_price: 99999999.99, customer: 'x'.repeat(120), channel: 'etsy', note: 'n'.repeat(1000) };
  assert.equal(app.orderFieldsProblem(ok), null);
  assert.ok(app.orderFieldsProblem({ ...ok, quantity: 10001 }), '> 10 000 pièces refusé (la base refuserait)');
  assert.ok(app.orderFieldsProblem({ ...ok, unit_price: 1e8 }), 'prix trop grand pour numeric(10,2)');
  assert.ok(app.orderFieldsProblem({ ...ok, customer: 'x'.repeat(121) }));
  assert.ok(app.orderFieldsProblem({ ...ok, note: 'n'.repeat(1001) }));
  assert.ok(app.orderFieldsProblem({ ...ok, item_name: '   ' }));
  assert.equal(app.orderFieldsProblem({ note: 'x' }, true), null, 'modification partielle : seuls les champs envoyés comptent');
  assert.ok(app.orderFieldsProblem({ quantity: 0 }, true));
});
