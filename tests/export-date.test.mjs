// Noms des fichiers d'export : date du jour LOCALE. Code RÉEL (.dev/app.js), horloge et fuseau imposés.
//
// ⚠️ (18/09) Le nom prenait la date UTC : un export fait à 00 h 30 en France (22 h 30 UTC la veille)
// était daté de la veille, et pouvait écraser/embrouiller la sauvegarde faite ce jour-là.
process.env.TZ = 'Europe/Paris';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { boot, resetStore, cleanup } from './sync-harness.mjs';

afterEach(cleanup);

test('export à 00 h 30 (heure de Paris) : fichiers datés du jour, pas de la veille', async () => {
  const { app, G, get, Store } = boot();
  resetStore(Store, app);
  const MAINTENANT = Date.parse('2026-09-18T22:30:00Z'); // = 19/09 à 00 h 30 à Paris (heure d'été)
  const VraieDate = get('Date');
  G.Date = class extends VraieDate {
    constructor(...a) { super(...(a.length ? a : [MAINTENANT])); }
    static now() { return MAINTENANT; }
  };
  assert.equal(new G.Date().getDate(), 19, 'banc : fuseau de Paris et horloge imposés');
  let fenetre = null;
  get('Modal').open = (cfg) => { fenetre = cfg; return {}; };
  const fichiers = [];
  G.saveFile = async (nom) => { fichiers.push(nom); };
  get('Actions')['export-open']();
  assert.ok(fenetre, 'banc : fenêtre d’export ouverte');
  for (const a of ['x-json', 'x-journal', 'x-sales', 'x-prod', 'x-spools']) await fenetre.actions[a]();
  assert.equal(fichiers.length, 5);
  for (const nom of fichiers) assert.match(nom, /-2026-09-19\.(json|csv)$/, nom);
});
