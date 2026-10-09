// Formulaires « Modifier la bobine / le template » : l'enregistrement ne défait plus une tare ou un
// archivage faits ailleurs. Code RÉEL des formulaires (.dev/app.js) : seuls l'affichage (Modal.open),
// la lecture des champs (readForm) et la base (faux client) sont imités.
//
// ⚠️ (18/09) Le formulaire recopiait TOUS les champs à l'ouverture, tare et archivage compris, et les
// renvoyait tous. Le téléphone note la tare pendant une pesée (ou archive la bobine) pendant que la
// fiche est ouverte sur le PC : à l'enregistrement du PC, la tare revenait à vide et la bobine
// était désarchivée.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { U, boot, resetStore, fakeBackend, httpErr, cleanup } from './sync-harness.mjs';

afterEach(cleanup);
const T = '2026-09-18T10:00:00.000001+00:00';
const X = '00000000-0000-4000-8000-0000000000b1';
const TPL = '00000000-0000-4000-8000-0000000000c1';
const BOBINE = { id: X, owner_id: U, brand: 'B', material: 'PLA', color_name: 'Noir', color_hex: '#000000', price: 20, initial_weight_g: 1000, tare_g: null, purchased_at: null, notes: null, remaining_weight_g: 1000, archived: false, created_at: T, updated_at: T };
const TEMPLATE = { id: TPL, owner_id: U, name: 'Vase', description: null, photo: null, machine_id: null, pieces_per_print: 1, materials: [], purge_g: 0, hardware_cost: 0, print_time_min: 60, labor_min: 0, pricing_mode: null, price_coef: null, target_margin_pct: null, catalog_price: 12, archived: false, created_at: T, updated_at: T };
// Ce que l'utilisateur voit dans la fiche bobine (champs lus par readForm)
const champs = (s, modif = {}) => ({ brand: s.brand, material: s.material, color_name: s.color_name, color_hex: s.color_hex, price: s.price, initial_weight_g: s.initial_weight_g, tare_g: s.tare_g, purchased_at: s.purchased_at || '', notes: s.notes || '', ...modif });

function atelier({ reseau = true, refusVisible = false, echo = false } = {}) {
  const { app, G, get, Store, Sync } = boot();
  resetStore(Store, app);
  Store.upsertRows('settings', [{ owner_id: U, ...app.DEFAULT_SETTINGS, updated_at: T }]);
  Store.upsertRows('spools', [BOBINE]);
  Store.upsertRows('templates', [TEMPLATE]);
  Store.rebuild(true);
  const envoyes = [];
  Sync.backend = fakeBackend((n, op) => {
    envoyes.push({ type: op.type, payload: JSON.parse(JSON.stringify(op.payload)) });
    if (!reseau) throw httpErr(0, '', 'Failed to fetch'); // pas de réseau : l'action reste dans la file
    // echo : la base renvoie la ligne enregistrée, comme en vrai. Sans ça, une bobine tout juste
    // ajoutée n'existe plus localement une fois l'action confirmée, et la pesée qui suit est refusée.
    if (echo && op.type === 'spool.save') return { spools: [{ ...BOBINE, ...op.payload, remaining_weight_g: op.payload.initial_weight_g, updated_at: T }] };
    return {};
  });
  let fenetre = null;
  get('Modal').open = (cfg) => { fenetre = cfg; return {}; };
  let refus = null;
  G.setFieldError = (root, name, message) => {
    if (!message) return;                       // effacement d'un message : normal
    if (refusVisible) { refus = { name, message }; return; }
    throw new Error(`champ refusé : ${name} (${message})`);
  };
  let formulaire = {};
  G.readForm = () => ({ ...formulaire });
  const m = { el: {}, close() {}, render() {} };
  const ouvrirBobine = (opts) => { get('openSpoolModal')(opts); assert.ok(fenetre, 'banc : la fiche bobine est ouverte'); };
  const ouvrirTemplate = (opts) => { get('openTemplateModal')(opts); assert.ok(fenetre, 'banc : la fiche template est ouverte'); };
  const enregistrer = async (valeurs) => {
    formulaire = valeurs || {};
    await fenetre.actions.submit({}, {}, m);
    assert.equal(envoyes.length, 1, 'banc : une action envoyée à la base');
    return envoyes[0];
  };
  // Le téléphone a noté la tare et archivé la bobine ; ces changements arrivent sur le PC
  const telephone = () => {
    Store.upsertRows('spools', [{ ...BOBINE, tare_g: 250, archived: true, updated_at: '2026-09-18T10:05:00.000001+00:00' }]);
    Store.upsertRows('templates', [{ ...TEMPLATE, archived: true, updated_at: '2026-09-18T10:05:00.000001+00:00' }]);
    Store.rebuild(true);
  };
  // soumettre sans rien supposer du nombre d'actions (une saisie peut en produire deux :
  // la fiche enregistrée, puis la pesée du poids actuel)
  const soumettre = async (valeurs) => { formulaire = valeurs || {}; await fenetre.actions.submit({}, {}, m); };
  const champRefuse = async (valeurs) => {
    refus = null;
    await soumettre(valeurs);
    assert.ok(refus, 'banc : un champ devait être refusé');
    return refus;
  };
  // saisie d'un champ (onInput du vrai formulaire)
  const saisir = ({ name, value, num = false }) => fenetre.onInput({ target: { name, value, hasAttribute: () => num, checked: false } }, { ...m, q: () => null, update: () => {} });
  const runOp = (type, payload) => get('runOp')(type, payload, {});
  return { app, get, Store, Sync, envoyes, ouvrirBobine, ouvrirTemplate, enregistrer, soumettre, champRefuse, runOp, saisir, telephone };
}

test('bobine modifiée sur le PC sans toucher la tare : ni la tare ni l’archivage ne sont renvoyés', async () => {
  const w = atelier();
  const s = w.Store.V.spools.get(X);
  w.ouvrirBobine({ spool: s });                        // fiche ouverte sur le PC (tare vide, active)
  w.telephone();                                       // pendant ce temps, sur le téléphone
  const { type, payload } = await w.enregistrer(champs(s, { color_name: 'Noir mat' }));
  assert.equal(type, 'spool.save');
  assert.equal(payload.color_name, 'Noir mat', 'la modification du PC part');
  assert.ok(!('tare_g' in payload), 'la tare (vide à l’ouverture) n’écrase pas celle du téléphone');
  assert.ok(!('archived' in payload), 'l’archivage fait sur le téléphone n’est pas défait');
});

test('bobine hors-ligne : la modification en attente ne défait pas non plus la tare arrivée entre-temps', async () => {
  const w = atelier({ reseau: false });
  const s = w.Store.V.spools.get(X);
  w.ouvrirBobine({ spool: s });
  const { payload } = await w.enregistrer(champs(s, { notes: 'rangée en haut' }));
  assert.ok(!('tare_g' in payload) && !('archived' in payload));
  assert.deepEqual(w.Store.Q.map((o) => [o.type, o.status]), [['spool.save', 'pending']], 'banc : la modification attend le réseau');
  w.telephone();                                       // la tare du téléphone arrive pendant que l'action attend
  const apres = w.Store.V.spools.get(X);               // copie locale = base + actions en attente
  assert.equal(apres.tare_g, 250);
  assert.equal(apres.archived, true);
  assert.equal(apres.notes, 'rangée en haut');
});

test('tare changée DANS le formulaire : elle est bien envoyée (et effacée si on la vide)', async () => {
  const w = atelier();
  const s = w.Store.V.spools.get(X);
  w.ouvrirBobine({ spool: s });
  const { payload } = await w.enregistrer(champs(s, { tare_g: 180 }));
  assert.equal(payload.tare_g, 180);
  assert.ok(!('archived' in payload));

  const w2 = atelier();
  w2.Store.upsertRows('spools', [{ ...BOBINE, tare_g: 250 }]);
  w2.Store.rebuild(true);
  const s2 = w2.Store.V.spools.get(X);
  w2.ouvrirBobine({ spool: s2 });
  const r2 = await w2.enregistrer(champs(s2, { tare_g: null }));
  assert.ok('tare_g' in r2.payload, 'tare vidée volontairement : envoyée');
  assert.equal(r2.payload.tare_g, null);
  const w3 = atelier();
  w3.Store.upsertRows('spools', [{ ...BOBINE, tare_g: 250 }]);
  w3.Store.rebuild(true);
  const s3 = w3.Store.V.spools.get(X);
  w3.ouvrirBobine({ spool: s3 });
  const r3 = await w3.enregistrer(champs(s3));
  assert.ok(!('tare_g' in r3.payload), 'tare inchangée (250) : pas renvoyée');
});

test('nouvelle bobine et copie : créées actives, avec leur tare', async () => {
  const w = atelier();
  w.ouvrirBobine({});
  const { payload } = await w.enregistrer(champs({ brand: 'Elegoo', material: 'PETG', color_name: 'Bleu', color_hex: '#0000FF', price: 18, initial_weight_g: 1000, tare_g: 200 }));
  assert.equal(payload.archived, false);
  assert.equal(payload.tare_g, 200);
  assert.notEqual(payload.id, X);

  const w2 = atelier();
  w2.Store.upsertRows('spools', [{ ...BOBINE, archived: true, tare_g: 250 }]);
  w2.Store.rebuild(true);
  const s2 = w2.Store.V.spools.get(X);
  w2.ouvrirBobine({ spool: s2, duplicate: true });
  const r2 = await w2.enregistrer(champs(s2));
  assert.equal(r2.payload.archived, false, 'la copie d’une bobine archivée est active');
  assert.equal(r2.payload.tare_g, 250, 'la copie garde la tare');
  assert.notEqual(r2.payload.id, X);
});

test('template modifié sur le PC : l’archivage fait sur le téléphone n’est pas défait', async () => {
  const w = atelier();
  const t = w.Store.V.templates.get(TPL);
  w.ouvrirTemplate({ template: t });
  w.telephone();
  const { type, payload } = await w.enregistrer();
  assert.equal(type, 'template.save');
  assert.equal(payload.name, 'Vase');
  assert.ok(!('archived' in payload));
  assert.equal(w.Store.V.templates.get(TPL).archived, true);
});

test('nouveau template et copie : créés actifs', async () => {
  const w = atelier();
  w.Store.upsertRows('templates', [{ ...TEMPLATE, archived: true }]);
  w.Store.rebuild(true);
  w.ouvrirTemplate({ template: w.Store.V.templates.get(TPL), duplicate: true });
  const { payload } = await w.enregistrer();
  assert.equal(payload.archived, false);
  assert.notEqual(payload.id, TPL);
});

// ---------------------------------------------------------------------------
// Poids actuel du rouleau (demande d'André, 06/10) : on peut le saisir dans la fiche bobine, à
// l'ajout ET en modification. Il est enregistré comme une pesée : les productions suivantes le font
// baisser toutes seules. Avant, le champ n'existait qu'à l'ajout, derrière une bascule.
const actions = async (w, fenetreValeurs) => { const n = w.envoyes.length; await w.soumettre(fenetreValeurs); return w.envoyes.slice(n); };

test('fiche bobine : le poids actuel saisi part comme une pesée', async () => {
  const w = atelier();
  const s = w.Store.V.spools.get(X);
  assert.equal(Number(s.remaining_weight_g), 1000);
  w.ouvrirBobine({ spool: s });
  const env = await actions(w, champs(s, { remainingNow: 640 }));           // rouleau pesé : 640 g
  assert.deepEqual(env.map((e) => e.type), ['spool.save', 'spool.weigh']);
  assert.equal(env[1].payload.measured_g, 640);
  assert.equal(env[1].payload.spool_id, X);
});

test('fiche bobine : poids actuel inchangé ou vide -> aucune pesée inutile', async () => {
  const w = atelier();
  const s = w.Store.V.spools.get(X);
  w.ouvrirBobine({ spool: s });
  assert.deepEqual((await actions(w, champs(s, { remainingNow: 1000, notes: 'rangée en haut' }))).map((e) => e.type), ['spool.save']);
  const w2 = atelier();
  w2.ouvrirBobine({ spool: w2.Store.V.spools.get(X) });
  assert.deepEqual((await actions(w2, champs(s, { remainingNow: '' }))).map((e) => e.type), ['spool.save']);
});

test('nouvelle bobine déjà entamée : le poids actuel part avec elle ; neuve, rien de plus', async () => {
  const neuve = { brand: 'B', material: 'PLA', color_name: 'Rouge', color_hex: '#FF0000', price: 20, initial_weight_g: 1000, tare_g: null, purchased_at: '', notes: '' };
  const w = atelier({ echo: true });
  w.ouvrirBobine({});
  const entamee = await actions(w, { ...neuve, remainingNow: 300 });
  assert.deepEqual(entamee.map((e) => e.type), ['spool.save', 'spool.weigh']);
  assert.equal(entamee[1].payload.measured_g, 300);
  assert.equal(entamee[1].payload.spool_id, entamee[0].payload.id);
  const w2 = atelier({ echo: true });
  w2.ouvrirBobine({});
  assert.deepEqual((await actions(w2, { ...neuve, remainingNow: '' })).map((e) => e.type), ['spool.save'], 'bobine neuve : pas de pesée');
});

test('fiche bobine : un poids actuel plus lourd que la bobine neuve est refusé', async () => {
  const w = atelier({ refusVisible: true });
  const s = w.Store.V.spools.get(X);
  w.ouvrirBobine({ spool: s });
  const refus = await w.champRefuse(champs(s, { remainingNow: 1600 }));
  assert.equal(refus.name, 'remainingNow');
  assert.match(refus.message, /plus que le poids initial/);
  assert.equal(w.envoyes.length, 0, 'rien n’est envoyé');
});

// Revue du 09/10 : le champ « Filament restant » ne doit jamais empêcher une autre correction.
test('corriger le poids initial à la baisse : plus de refus à cause du champ pré-rempli', async () => {
  const w = atelier();
  const s = w.Store.V.spools.get(X);                       // 1 000 g, 1 000 g restants
  w.ouvrirBobine({ spool: s });
  // l'utilisateur découvre que le rouleau fait 750 g : il ne touche PAS au filament restant
  const env = await actions(w, champs(s, { initial_weight_g: 750, remainingNow: 1000 }));
  assert.deepEqual(env.map((e) => e.type), ['spool.save'], 'la correction part, sans pesée inventée');
  assert.equal(env[0].payload.initial_weight_g, 750);
});

test('bobine en écart négatif : le champ est vide, et taper 0 enregistre vraiment la correction', async () => {
  const w = atelier();
  w.Store.upsertRows('spools', [{ ...BOBINE, remaining_weight_g: -200 }]);
  w.Store.rebuild(true);
  const s = w.Store.V.spools.get(X);
  w.ouvrirBobine({ spool: s });
  const env = await actions(w, champs(s, { remainingNow: 0 }));
  assert.deepEqual(env.map((e) => e.type), ['spool.save', 'spool.weigh'], 'le 0 compte comme une pesée');
  assert.equal(env[1].payload.measured_g, 0);
});

test('le poids initial change sans pesée : le champ suit, il ne ment pas', async () => {
  const w = atelier();
  const s = w.Store.V.spools.get(X);
  w.ouvrirBobine({ spool: s });
  // 1 000 -> 1 200 g : le restant réel passera de 1 000 à 1 200, le champ doit suivre
  w.saisir({ name: 'initial_weight_g', value: '1200', num: true });
  const env = await actions(w, champs(s, { initial_weight_g: 1200, remainingNow: 1200 }));
  assert.deepEqual(env.map((e) => e.type), ['spool.save'], 'aucune pesée : le restant suit le poids initial');
});
