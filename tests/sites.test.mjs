// Les deux sites construits à partir du MÊME code : Paulo3D (portugais du Portugal) et Anais3D (français).
// Lancer : node tools/build.mjs --dev --site paulo3d && node tools/build.mjs --dev --site anais3d && node --test tests/sites.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadApp, applyOps } from './load-app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const acorn = createRequire(path.join(ROOT, 'package.json'))('acorn');
const pt = loadApp({}, 'app-paulo3d.js');
const fr = loadApp({}, 'app-anais3d.js');
const code = (id) => fs.readFileSync(path.join(ROOT, '.dev', `app-${id}.js`), 'utf8');
const built = (id, f) => fs.readFileSync(path.join(ROOT, '.dev', id, f), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));

// Toutes les chaînes du code (commentaires exclus) : ce que l'utilisateur peut voir
function stringsOf(src) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n.type !== 'string') return;
    // messages pour la console du développeur : jamais vus par l'utilisateur
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object && n.callee.object.name === 'console') return;
    if (n.type === 'Literal' && typeof n.value === 'string') out.push(n.value);
    if (n.type === 'TemplateElement') out.push(n.value.cooked ?? n.value.raw);
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === 'string') walk(v);
    }
  };
  walk(acorn.parse(src, { ecmaVersion: 'latest' }));
  return out;
}

test('identité : Paulo3D garde ses noms d’origine, Anais3D a les siens, rien en commun', () => {
  const id = (x) => plain({ ...x.SITE, letter: undefined, supaUrl: undefined, supaKey: undefined, mfaRequired: undefined });
  assert.deepEqual(id(pt), { id: 'paulo3d', name: 'Paulo3D', prefix: 'p3d', lang: 'pt-PT', locale: 'pt-PT' });
  assert.deepEqual(id(fr), { id: 'anais3d', name: 'Anais3D', prefix: 'a3d', lang: 'fr', locale: 'fr-FR' });
  // appareils déjà installés : Paulo3D retrouve sa configuration, sa session et ses actions en attente
  assert.equal(pt.LS.supa, 'p3d_supabase');
  assert.equal(pt.lsKey('last_email'), 'p3d_last_email');
  const ptKeys = new Set(Object.values(pt.LS));
  for (const k of Object.values(fr.LS)) assert.ok(k.startsWith('a3d_') && !ptKeys.has(k), k);

  const a = code('anais3d');
  const strs = stringsOf(a);
  assert.ok(!strs.some((s) => /paulo/i.test(s)), 'aucun texte ni nom « Paulo » dans Anais3D');
  assert.ok(!strs.some((s) => /^p3d[_-](?!.*\(|weigh|launch|delete|add|adjust|record|version|ping)/.test(s)), 'aucun nom de stockage p3d_ / p3d- dans Anais3D (seules les fonctions de la base gardent p3d_)');
  assert.ok(!/paulo3d:/.test(a), 'mémoire locale (IndexedDB) séparée');
  assert.match(built('anais3d', 'sw.js'), /const PREFIX = "a3d";/, 'caches hors-ligne séparés : le service worker d’un site n’efface jamais ceux de l’autre');
  assert.match(built('paulo3d', 'sw.js'), /const PREFIX = "p3d";/);
});

test('pages et installation : nom, langue et logo propres à chaque site', () => {
  const hp = built('paulo3d', 'index.html');
  const ha = built('anais3d', 'index.html');
  assert.match(hp, /<html lang="pt-PT"/);
  assert.match(ha, /<html lang="fr"/);
  assert.match(hp, /<title>Paulo3D — Oficina de impressão 3D<\/title>/);
  assert.match(ha, /<title>Anais3D — Atelier d&#39;impression 3D<\/title>|<title>Anais3D — Atelier d'impression 3D<\/title>/);
  assert.ok(!/Paulo/.test(ha), 'aucune trace de Paulo dans la page d’Anais3D');
  assert.ok(ha.includes('M52 22H78L100 98H80'), 'logo « A » sur l’écran de chargement');
  const mp = JSON.parse(built('paulo3d', 'manifest.webmanifest'));
  const ma = JSON.parse(built('anais3d', 'manifest.webmanifest'));
  assert.equal(mp.short_name, 'Paulo3D');
  assert.equal(mp.lang, 'pt-PT');
  assert.equal(mp.shortcuts[0].name, 'Registar uma venda');
  assert.equal(ma.short_name, 'Anais3D');
  assert.equal(ma.shortcuts[0].url, './#/stock?action=vente', 'les raccourcis gardent leur adresse (clé du code)');
  assert.equal(mp.shortcuts[0].url, './#/stock?action=vente');
  for (const f of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon.svg']) {
    assert.notDeepEqual(fs.readFileSync(path.join(ROOT, '.dev', 'anais3d', 'icons', f)), fs.readFileSync(path.join(ROOT, '.dev', 'paulo3d', 'icons', f)), `icône ${f} propre à Anais3D`);
  }
});

test('portugais : accords, nombres et dates du Portugal', () => {
  assert.equal(pt.plural(0, 'peça', 'peças'), '0 peças', 'en portugais, 0 est au pluriel');
  assert.equal(pt.plural(1, 'peça', 'peças'), '1 peça');
  assert.equal(fr.plural(0, 'pièce', 'pièces'), '0 pièce', 'en français, 0 est au singulier');
  assert.equal(pt.MONTHS[2], 'mar.');
  assert.equal(pt.MONTHS_LONG[2], 'março', 'abrégé et entier traduits séparément');
  assert.equal(pt.MONTHS_LONG[7], 'agosto');
  assert.match(pt.fmtEur(1234.5), /^1\s?234,50\s€$/);
  assert.match(pt.fmtDate('2026-09-12T10:00:00', 'day'), /^12 set\. 2026$/);
  assert.equal(pt.fmtDate('2026-09-18T14:05:00', 'long'), '18 de setembro de 2026 às 14:05', 'date longue à la portugaise');
  assert.equal(fr.fmtDate('2026-09-18T14:05:00', 'long'), '18 septembre 2026 à 14:05');
  assert.equal(pt.dbMessage('Stock insuffisant pour « Vase » : il manque 2 pièces.'), 'Stock insuficiente para «Vase»: em falta 2 peças.', 'message de la base traduit');
  assert.equal(pt.dbMessage('Stock insuffisant pour « Vase » : il manque 1 pièce.'), 'Stock insuficiente para «Vase»: em falta 1 peça.');
  assert.equal(pt.dbMessage('Code de double authentification requis.'), 'Código de autenticação de dois fatores obrigatório.');
  assert.equal(fr.dbMessage('Session expirée : reconnecte-toi.'), 'Session expirée : reconnecte-toi.', 'français : inchangé');
});

test('portugais : aucune phrase française restée, clés du code et commandes PDF intactes', () => {
  const src = code('paulo3d');
  const strs = stringsOf(src);
  const FRENCH = /\b(les|des|une|aucune?|ajouter|supprimer|enregistr\w*|bobines?|pièces?|ventes?|commandes?|reconnecte|tableau|réglages|paramètres)\b/i;
  // phrases (au moins deux mots) : un mot isolé est une clé du code (« ventes » = nom d'onglet)
  // balises et attributs retirés (une adresse « #/bobines » est une route, pas du texte)
  const left = strs.map((s) => s.replace(/<[^>]*>/g, ' ')).filter((s) => /\s/.test(s.trim()) && FRENCH.test(s) && !/^attrs doit|^nom d'attribut/.test(s));
  assert.deepEqual(left, [], `phrases françaises restées : ${left.slice(0, 5).join(' | ')}`);
  // clés comparées par le code : jamais traduites
  for (const needle of ["tab === 'ventes'", "e.key === 'Escape'", "endsWith('Draft')", "a === 'vente'", 'Bearer ${', "'direct'"]) {
    assert.ok(src.includes(needle), `clé intacte : ${needle}`);
  }
  // commandes du format PDF intactes, texte portugais dans le fichier
  const S = pt.emptyState();
  const V = { ...pt.cloneState(S), userId: '00000000-0000-4000-8000-000000000001', pending: new Set() };
  const pdf = pt.reportPdf(V, pt.monthReport(V, '2026-09', new Date('2026-09-18T12:00:00Z')));
  assert.ok(pdf.startsWith('%PDF-1.4\n') && pdf.endsWith('%%EOF\n'));
  assert.match(pdf, /\/Type \/Font \/Subtype \/Type1 \/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/);
  assert.match(pdf, /BT \/F2 18 Tf .* Td \(Balan\\347o de setembro 2026\) Tj ET/, 'titre « Balanço de setembro 2026 » (ç en WinAnsi)');
  assert.match(pdf, /\(Nenhuma venda este m\\352s\.\) Tj/);
});

test('portugais : l’appli fonctionne (opérations, refus traduits)', () => {
  const USER = '00000000-0000-4000-8000-000000000001';
  const S = applyOps(pt, [['spool.save', { id: '10000000-0000-4000-8000-000000000001', brand: 'Bambu Lab', material: 'PLA', color_name: 'Preto', color_hex: '#111111', price: 20, initial_weight_g: 1000, tare_g: 245, purchased_at: null, notes: null, archived: false }]], USER);
  const V = { ...pt.cloneState(S), userId: USER, pending: new Set() };
  assert.equal(V.spools.size, 1);
  const err = pt.OPS['spool.weigh'].validate(V, { spool_id: '10000000-0000-4000-8000-000000000001', measured_g: 5000 });
  assert.match(err.message, /^5,00 kg é mais do que o peso inicial da bobina/, `refus en portugais : ${err.message}`);
  assert.equal(pt.OPS['order.save'].validate(V, { item_name: '', quantity: 1, status: 'todo' }).message, 'Indica a peça encomendada (120 caracteres no máximo).');
});

test('base inscrite dans chaque site : aucun lien ne peut la changer, la page ne parle qu’à elle', () => {
  const PAULO = 'https://tjweersjswfuiutuqnvv.supabase.co';
  const ANAIS = 'https://jvfvbsiicctnuvdpjska.supabase.co';
  assert.equal(pt.SITE.supaUrl, PAULO);
  assert.equal(fr.SITE.supaUrl, ANAIS);
  assert.match(pt.SITE.supaKey, /^sb_publishable_/, 'clé publique seulement');
  assert.match(fr.SITE.supaKey, /^sb_publishable_/);
  for (const [id, url] of [['paulo3d', PAULO], ['anais3d', ANAIS]]) {
    const csp = built(id, 'index.html').match(/content="(default-src[^"]+)"/)[1];
    const connect = csp.split(';').map((x) => x.trim()).find((x) => x.startsWith('connect-src ')).split(/\s+/).slice(1);
    assert.ok(connect.includes(url) && connect.includes(url.replace('https:', 'wss:')), `${id} : sa base autorisée`);
    assert.ok(!connect.filter((s) => !/127.0.0.1|localhost/.test(s)).some((s) => s.includes('*')), `${id} : aucune autre base Supabase joignable`);
  }
  // code : la configuration par lien est ignorée, la démo n'est jamais proposée
  const boot = code('paulo3d');
  assert.match(boot, /if \(SITE\.supaUrl\) return null;/, 'lien #setup= ignoré');
  assert.match(boot, /if \(SITE\.supaUrl\) \{[\s\S]{0,400}lsSet\(LS\.mode, 'supabase'\)/, 'appareil resté en démo : ramené sur la connexion');
});

test('adresse Supabase : un chemin (relais d’un intermédiaire) est refusé', () => {
  assert.equal(fr.normalizeSupaUrl('https://abcdefghijklmnopqrst.supabase.co'), 'https://abcdefghijklmnopqrst.supabase.co');
  assert.equal(fr.normalizeSupaUrl('https://abcdefghijklmnopqrst.supabase.co/rest/v1/'), 'https://abcdefghijklmnopqrst.supabase.co');
  assert.equal(fr.normalizeSupaUrl('https://abcdefghijklmnopqrst.supabase.co/functions/v1/relais'), '');
});

test('écran de connexion d’un site à base inscrite : ni « Changer de base », ni configuration, ni démo', () => {
  const src = code('anais3d');
  assert.match(src, /setup\(\{ fromSettings = false \} = \{\}\) \{\s*\/\/[^\n]*\n\s*if \(SITE\.supaUrl\) return this\.fatal\(/, 'configuration jamais affichée');
  assert.match(src, /\$\{SITE\.supaUrl \? '' : html`<div[^`]*id="change-base"/, 'bouton « Changer de base » masqué');
});

test('matières : une bobine saisie en français retrouve une ligne de modèle en portugais (et l’inverse)', () => {
  for (const app of [pt, fr]) {
    assert.equal(app.materialKey('PLA Mat'), app.materialKey('PLA Mate'));
    assert.equal(app.materialKey('Résine'), app.materialKey('Resina'));
    assert.equal(app.materialKey('Autre'), app.materialKey('Outro'));
    assert.notEqual(app.materialKey('PLA'), app.materialKey('PETG'));
  }
});

test('double authentification obligatoire sur les deux sites publiés, pas en version de test', () => {
  assert.equal(pt.SITE.mfaRequired, '1');
  assert.equal(fr.SITE.mfaRequired, '1');
  const dev = loadApp({});
  assert.equal(dev.SITE.mfaRequired, '', 'version de test : facultative');
  for (const id of ['paulo3d', 'anais3d']) {
    const src = code(id);
    // activation imposée avant d'entrer, à la connexion ET au redémarrage de l'appli
    assert.equal((src.match(/if \(await Mfa\.needsEnroll\(backend\)\) return Screens\.mfaEnroll\(/g) || []).length, 2, `${id} : activation imposée aux 2 entrées`);
    assert.match(src, /SITE\.mfaRequired \? '' : btn\(/, `${id} : pas de bouton « Désactiver »`);
  }
  assert.equal(pt.dbMessage('Double authentification obligatoire : active-la pour continuer.'), 'Autenticação de dois fatores obrigatória: ativa-a para continuar.');
});
