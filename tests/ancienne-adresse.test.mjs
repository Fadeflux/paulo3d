// Anciennes adresses Railway (paulo3d / anais3d / nail-studio) → GitHub Pages : la page servie par
// Railway ne fait plus QUE rediriger, en gardant la fin du lien (#setup=…, étiquette QR, lien de mot
// de passe oublié).
//
// ⚠️ (09/10) Elle emportait aussi les actions pas encore envoyées dans « #p3d-import=… », et l'appli
// les remettait dans sa file SANS confirmation : n'importe quel lien pouvait donc faire exécuter des
// suppressions avec la session de l'utilisateur. Le déménagement étant terminé, tout ce mécanisme a
// été retiré des deux côtés (le refus côté appli est vérifié dans tests/revue-0910.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pageDe = (id) => fs.readFileSync(path.join(ROOT, '.dev', `redirect-${id}`, 'site', 'index.html'), 'utf8');

function lancer(id, hash) {
  const html = pageDe(id);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  let cible = null;
  const ctx = vm.createContext({ location: { hash, replace: (u) => { cible = u; } }, document: { getElementById: () => null } });
  vm.runInContext(script, ctx);
  return { cible, html, script };
}

test('redirection : la fin du lien est gardée (étiquette QR, lien de mot de passe oublié)', () => {
  assert.equal(lancer('paulo3d', '#/bobines?peser=abc').cible, 'https://fadeflux.github.io/paulo3d/#/bobines?peser=abc');
  assert.equal(lancer('anais3d', '').cible, 'https://fadeflux.github.io/anais3d/');
  assert.equal(lancer('nail-studio', '#x').cible, 'https://fadeflux.github.io/nail-studio/#x');
});

test('redirection : plus aucune lecture du stockage, plus aucun « #p3d-import »', () => {
  for (const id of ['paulo3d', 'anais3d', 'nail-studio']) {
    const { html, script } = lancer(id, '');
    assert.ok(!/p3d-import|indexedDB|localStorage/.test(script), `${id} : la page ne touche plus au stockage`);
    const empreinte = `sha256-${crypto.createHash('sha256').update(script, 'utf8').digest('base64')}`;
    assert.ok(html.includes(empreinte), `${id} : empreinte du script exacte dans la politique de sécurité`);
    assert.match(html, /<meta name="robots" content="noindex">/);
  }
});
