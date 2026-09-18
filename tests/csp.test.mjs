// Politique de sécurité de la page (CSP) du site RÉEL construit (.dev/site/index.html) :
// seul le script de la page (reconnu par son empreinte) et les 4 bibliothèques prévues peuvent s'exécuter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDN } from '../tools/cdn.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, '.dev', 'site', 'index.html'), 'utf8');
const CSP = (HTML.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/) || [])[1];
const directive = (name) => {
  const d = CSP.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${name} `));
  return d ? d.split(/\s+/).slice(1) : null;
};

test('CSP présente, avant tout script', () => {
  assert.ok(CSP, 'balise CSP trouvée');
  assert.ok(HTML.indexOf('Content-Security-Policy') < HTML.indexOf('<script'), 'la CSP doit précéder les scripts');
});

test('script de la page : autorisé par son empreinte exacte (un seul script intégré)', () => {
  const inline = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(inline.length, 1);
  assert.ok(!inline[0].includes('\r'), 'fins de ligne LF (le navigateur calcule l’empreinte sur du LF)');
  const hash = `'sha256-${crypto.createHash('sha256').update(inline[0], 'utf8').digest('base64')}'`;
  assert.ok(directive('script-src').includes(hash), 'empreinte du script présente dans script-src');
});

test('bibliothèques : seulement les 4 adresses exactes, jamais tout jsdelivr', () => {
  const src = directive('script-src');
  for (const url of Object.values(CDN)) assert.ok(src.includes(url), url);
  assert.ok(!src.includes('https://cdn.jsdelivr.net') && !src.some((s) => /^https:\/\/cdn\.jsdelivr\.net\/?$/.test(s)), 'pas d’autorisation de tout le CDN');
  assert.ok(!src.includes("'unsafe-eval'"));
  assert.ok(!src.includes('*') && !src.includes('https:') && !src.includes('data:'), 'aucun joker');
  for (const m of HTML.matchAll(/<script src="([^"]+)" integrity="(sha384-[^"]+)" crossorigin="anonymous"><\/script>/g)) {
    assert.ok(Object.values(CDN).includes(m[1]), `${m[1]} est une bibliothèque prévue`);
  }
  assert.equal((HTML.match(/<script\b/g) || []).length, 3, '1 script intégré + 2 bibliothèques chargées au démarrage');
});

test('ni code dans les attributs HTML, ni cadre, ni plugin', () => {
  assert.ok(!/\son[a-z]+\s*=\s*["'`]/i.test(HTML), 'aucun attribut onclick/onerror…');
  assert.ok(!/javascript:/i.test(HTML));
  assert.deepEqual(directive('object-src'), ["'none'"]);
  assert.deepEqual(directive('frame-src'), ["'none'"]);
  assert.deepEqual(directive('base-uri'), ["'self'"]);
  assert.deepEqual(directive('form-action'), ["'self'"]);
});

test('données : seulement vers Supabase (le site ne peut rien envoyer ailleurs)', () => {
  const connect = directive('connect-src').filter((s) => !/127\.0\.0\.1|localhost/.test(s)); // build de test : base locale en plus
  assert.deepEqual(connect.filter((s) => !/^(https|wss):\/\/\*\.supabase\.(co|in)$/.test(s)).sort(),
    ["'self'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].sort());
});
