// Traduction à la construction : le code source est écrit en français ; pour un site dans une autre
// langue, chaque texte visible est remplacé par sa traduction, lue dans i18n/<langue>.json.
// Un texte = une chaîne, ou un gabarit `...${x}...` entier (les ${…} deviennent {} dans le catalogue,
// dans le même ordre). Dans le HTML (html`…`), seuls les textes entre balises et les attributs lisibles
// (title, placeholder, aria-label, alt) sont traduits : balises et classes ne bougent pas.
// La construction ÉCHOUE si un texte n'a pas de traduction : rien ne reste en français par oubli.
//
// Usage : node tools/i18n.mjs pt-PT           → ajoute au catalogue les textes manquants (valeur null)
//         node tools/i18n.mjs pt-PT --clean   → retire aussi les textes qui n'existent plus dans le code
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const acorn = require('acorn');
const ICON_NAMES = new Set(Object.keys(require('lucide').icons));

const HOLE = String.fromCharCode(1); // place d'une expression ${…} pendant l'analyse
const HUMAN_ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
// Mots-outils français : une liste de classes CSS n'en contient jamais, une phrase presque toujours
const FR_WORDS = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'en', 'et', 'ou', 'au', 'aux', 'sur', 'sans', 'pour', 'par',
  'avec', 'dans', 'pas', 'plus', 'moins', 'ne', 'ce', 'cette', 'ces', 'son', 'sa', 'ses', 'ton', 'ta', 'tes', 'mon', 'ma', 'mes', 'il', 'elle',
  'on', 'qui', 'que', 'est', 'sont', 'fois', 'avant', 'encore', 'presque', 'trop', 'peu', 'tout', 'tous', 'toutes', 'cours', 'bobine', 'bobines']);

// Texte lisible par un humain ? (pas une liste de classes, une clé, une couleur, un nom d'icône…)
export function isText(s) {
  const t = s.split(HOLE).join(' ').trim();
  const withHole = s.includes(HOLE); // « pour {} » : un mot-outil à côté d'une valeur est une phrase
  if (!/[A-Za-zÀ-ÿœŒ]{2,}/.test(t)) return false;
  if (!/[À-ÿœŒ]/.test(t) && /^[a-z0-9_:\-./#[\]%()!&>=,+*@]+(\s+[a-z0-9_:\-./#[\]%()!&>=,+*@]+)*$/.test(t)
    && !((/\s/.test(t) || withHole) && t.split(/\s+/).some((w) => FR_WORDS.has(w.replace(/[().,!?:]/g, ''))))) return false;
  if (ICON_NAMES.has(t)) return false; // nom d'icône (Download, Printer…)
  if (/^#[0-9a-f]{3,8}$/i.test(t)) return false;
  // un seul « mot » sans accent : texte seulement si c'est un vrai mot (pas camelCase, chemin, type MIME…)
  if (!/\s/.test(t) && !/[À-ÿœŒ]/.test(t) && !/^[A-Za-z][a-z'’]+(-[A-Za-z][a-z'’]+)*[.!?…:]?$/.test(t)) return false;
  // morceaux d'attributs HTML, sélecteurs CSS, routes
  if (/^[a-z][a-z-]*="/.test(t) || /^[[.#][a-z-]/i.test(t) || /^#\//.test(t)) return false;
  if (/^(Inter|ui-sans-serif|system-ui)\b/.test(t)) return false;
  return true;
}

// Découpe d'un gabarit HTML (expressions remplacées par HOLE) en morceaux traduisibles : [{ start, end }]
function htmlPieces(str) {
  const pieces = [];
  let i = 0;
  while (i < str.length) {
    if (str[i] === '<' && /[a-zA-Z/!]/.test(str[i + 1] || '')) {
      const close = str.indexOf('>', i);
      const end = close === -1 ? str.length : close + 1;
      const tag = str.slice(i, end);
      for (const a of HUMAN_ATTRS) {
        for (const m of tag.matchAll(new RegExp(`\\s${a}="([^"]*)"`, 'g'))) {
          const vs = i + m.index + m[0].indexOf('"') + 1;
          pieces.push({ start: vs, end: vs + m[1].length });
        }
      }
      i = end;
      continue;
    }
    let end = str.indexOf('<', i + 1);
    if (end === -1) end = str.length;
    while (end < str.length && !/[a-zA-Z/!]/.test(str[end + 1] || '')) {
      const n2 = str.indexOf('<', end + 1);
      end = n2 === -1 ? str.length : n2;
    }
    pieces.push({ start: i, end });
    i = end;
  }
  // Entre deux balises, tout mot est AFFICHÉ (les classes et les clés sont dans les balises) : même un
  // mot seul en minuscules (« sur 120 € encaissés ») est du texte. Dans un attribut, la règle générale.
  const inTag = (s) => pieces.some((p) => p.attr && p.start === s);
  pieces.forEach((p, idx) => { if (idx < pieces.length && str[p.start - 1] === '"') p.attr = true; });
  return pieces.map(({ start, end, attr }) => {
    const seg = str.slice(start, end);
    return { start: start + (seg.length - seg.trimStart().length), end: end - (seg.length - seg.trimEnd().length), attr };
  }).filter(({ start, end, attr }) => {
    if (end <= start) return false;
    const t = str.slice(start, end);
    if (attr || inTag(start)) return isText(t);
    const bare = t.split(HOLE).join(' ').replace(/&[a-z]+;|&#\d+;/g, ' ');
    return /[A-Za-zÀ-ÿ]{2,}/.test(bare) && !ICON_NAMES.has(bare.trim());
  });
}

// Textes reconnus par leur PLACE dans le code, même en un seul mot minuscule (« mars », « actif ») :
// arguments de plural() / pl() / ui(), éléments des listes MONTHS / MONTHS_LONG / WEEKDAYS.
// Un mot isolé ailleurs est une clé du code (« ventes » = nom d'onglet) : jamais traduit.
// Les éléments d'une liste ont une clé préfixée par son nom : « mars » n'a pas la même traduction
// en abrégé (MONTHS|mars → « mar. ») et en entier (MONTHS_LONG|mars → « março »).
const TEXT_CALLS = new Set(['plural', 'pl', 'ui']);
const TEXT_LISTS = new Set(['MONTHS', 'MONTHS_LONG', 'WEEKDAYS']);
function textNodes(ast) {
  const out = new Map(); // nœud → contexte ('' ou nom de la liste)
  const walk = (n) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && TEXT_CALLS.has(n.callee.name)) {
      for (const a of n.arguments) {
        if ((a.type === 'Literal' && typeof a.value === 'string') || a.type === 'TemplateLiteral') out.set(a, '');
      }
    }
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && TEXT_LISTS.has(n.id.name) && n.init && n.init.type === 'ArrayExpression') {
      for (const e of n.init.elements) if (e && e.type === 'Literal' && typeof e.value === 'string') out.set(e, n.id.name);
    }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === 'string') walk(v);
    }
  };
  walk(ast);
  return out;
}

const key = (s, ctx = '') => (ctx ? `${ctx}|` : '') + s.split(HOLE).join('{}');
const joinedOf = (node) => node.quasis.map((q) => q.value.cooked ?? q.value.raw).join(HOLE);

// Tous les textes d'un fichier : [{ node, kind, piece?, text, ctx }]
function collect(code) {
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script' });
  const forced = textNodes(ast);
  const found = [];
  const seen = new Set();
  const visit = (node, inHtml) => {
    if (!node || typeof node.type !== 'string' || seen.has(node)) return;
    // messages pour la console du développeur : jamais vus par l'utilisateur
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.name === 'console') return;
    if (node.type === 'Literal' && typeof node.value === 'string') {
      seen.add(node);
      if (forced.has(node)) found.push({ node, kind: 'lit', text: node.value, ctx: forced.get(node) });
      else if (/^\s*<[a-z]/i.test(node.value) || /<\/[a-z]/i.test(node.value)) {
        for (const p of htmlPieces(node.value)) found.push({ node, kind: 'lit-html', piece: p, text: node.value.slice(p.start, p.end), ctx: '' });
      } else if (isText(node.value)) found.push({ node, kind: 'lit', text: node.value, ctx: '' });
      return;
    }
    if (node.type === 'TemplateLiteral') {
      seen.add(node);
      const joined = joinedOf(node);
      if (inHtml || /<[a-z/!]/i.test(joined)) {
        for (const p of htmlPieces(joined)) found.push({ node, kind: 'tpl-html', piece: p, text: joined.slice(p.start, p.end), ctx: '' });
      } else if (forced.has(node) || isText(joined)) found.push({ node, kind: 'tpl', text: joined, ctx: '' });
      node.expressions.forEach((e) => visit(e, false));
      return;
    }
    if (node.type === 'TaggedTemplateExpression' && node.tag && node.tag.name === 'html') {
      visit(node.quasi, true);
      return;
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => visit(c, false));
      else if (v && typeof v.type === 'string') visit(v, false);
    }
  };
  visit(ast, false);
  return found;
}

export function textsOf(code) {
  return collect(code).map((f) => key(f.text, f.ctx));
}

const escTpl = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

// Remplace les textes d'un fichier par leur traduction, en UNE passe : chaque gabarit reconstruit son
// texte à partir du code d'origine, ses expressions étant elles-mêmes traduites (gabarits imbriqués).
// Renvoie { code, missing }.
export function translate(code, dict, file = '') {
  const missing = new Set();
  const byNode = new Map();
  for (const f of collect(code)) {
    const k = key(f.text, f.ctx);
    const tr = dict[k];
    if (typeof tr !== 'string') {
      missing.add(k);
      continue;
    }
    const kh = key(f.text);
    if (tr.split('{}').length !== kh.split('{}').length) throw new Error(`${file} : « ${k} » → « ${tr} » : nombre de {} différent`);
    if (tr === kh) continue; // traduction identique (nom propre, clé) : le code reste tel quel
    if (!byNode.has(f.node)) byNode.set(f.node, []);
    byNode.get(f.node).push({ ...f, tr: tr.split('{}').join(HOLE) });
  }
  const edits = [...byNode.entries()].map(([node, list]) => ({ node, list, start: node.start, end: node.end }));
  edits.sort((a, b) => a.start - b.start || b.end - a.end);

  // réécrit [s, e[ du code d'origine en appliquant les modifications qui s'y trouvent
  const rewrite = (s, e) => {
    let out = '';
    let at = s;
    for (const ed of edits) {
      if (ed.start < at || ed.end > e) continue; // hors de la zone, ou contenu dans une modification déjà faite
      out += code.slice(at, ed.start) + build(ed);
      at = ed.end;
    }
    return out + code.slice(at, e);
  };
  const build = ({ node, list }) => {
    if (node.type === 'Literal') {
      let v = node.value;
      if (list[0].kind === 'lit') v = list[0].tr;
      else for (const f of [...list].sort((a, b) => b.piece.start - a.piece.start)) v = v.slice(0, f.piece.start) + f.tr + v.slice(f.piece.end);
      return JSON.stringify(v);
    }
    let joined = joinedOf(node);
    if (list[0].kind === 'tpl') joined = list[0].tr;
    else for (const f of [...list].sort((a, b) => b.piece.start - a.piece.start)) joined = joined.slice(0, f.piece.start) + f.tr + joined.slice(f.piece.end);
    const parts = joined.split(HOLE);
    if (parts.length !== node.quasis.length) throw new Error(`${file} : gabarit mal reconstruit (${key(list[0].text)})`);
    return `\`${parts.map((p, i) => escTpl(p) + (i < node.expressions.length ? `\${${rewrite(node.expressions[i].start, node.expressions[i].end)}}` : '')).join('')}\``;
  };
  return { code: rewrite(0, code.length), missing: [...missing] };
}

// Ligne de commande : met à jour le catalogue d'une langue
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const lang = process.argv[2];
  if (!lang) {
    console.error('Usage : node tools/i18n.mjs pt-PT [--clean]');
    process.exit(1);
  }
  const file = path.join(ROOT, 'i18n', `${lang}.json`);
  const dict = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const all = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, 'src', 'js')).filter((x) => x.endsWith('.js')).sort()) {
    for (const t of textsOf(fs.readFileSync(path.join(ROOT, 'src', 'js', f), 'utf8'))) all.add(t);
  }
  let added = 0;
  for (const t of all) if (!(t in dict)) { dict[t] = null; added++; }
  const unused = Object.keys(dict).filter((k) => !all.has(k));
  if (process.argv.includes('--clean')) for (const k of unused) delete dict[k];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(dict, null, 1)}\n`);
  const todo = Object.values(dict).filter((v) => v === null).length;
  console.log(`${lang} : ${all.size} textes, ${added} ajoutés, ${todo} à traduire, ${unused.length} inutilisés${process.argv.includes('--clean') && unused.length ? ' (retirés)' : ''}`);
}
