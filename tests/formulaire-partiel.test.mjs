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

function atelier({ reseau = true } = {}) {
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
    return {};
  });
  let fenetre = null;
  get('Modal').open = (cfg) => { fenetre = cfg; return {}; };
  G.setFieldError = (root, name, message) => { throw new Error(`champ refusé : ${name} (${message})`); };
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
  return { app, Store, Sync, envoyes, ouvrirBobine, ouvrirTemplate, enregistrer, telephone };
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
