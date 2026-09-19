'use strict';
/* =============================================================================
   Socle : constantes, formats, HTML sûr, icônes, logo
   ============================================================================= */

const APP_VERSION = '__APP_VERSION__';
const SCHEMA_VERSION = 3;

// Identité du site, remplie à la construction (tools/sites.mjs) : le même code sert plusieurs sites.
// prefix / id : noms de TOUT ce que le site garde dans le navigateur. Deux sites publiés à la même
// adresse (fadeflux.github.io) partagent le même stockage : sans noms distincts, l'un lirait les
// réglages de l'autre ou effacerait sa copie hors-ligne.
// supaUrl / supaKey : la base du site, inscrite à la construction (vide pour la version de test)
const SITE = {
  id: '__SITE_ID__', name: '__SITE_NAME__', prefix: '__SITE_PREFIX__', lang: '__SITE_LANG__', locale: '__SITE_LOCALE__', letter: '__SITE_LETTER__',
  supaUrl: '__SITE_SUPA_URL__', supaKey: '__SITE_SUPA_KEY__',
  mfaRequired: '__SITE_MFA__', // '1' : double authentification obligatoire
};
const lsKey = (k) => `${SITE.prefix}_${k}`;
// Mot isolé AFFICHÉ (« actif », « jamais »…) : marqué pour être traduit sur un site dans une autre
// langue (tools/i18n.mjs) ; les mots isolés non marqués sont des clés du code et ne bougent jamais
const ui = (s) => s;

const LS = {
  supa: lsKey('supabase'),
  mode: lsKey('mode'),
  period: lsKey('period'),
  ui: lsKey('ui'),
  demoOffline: lsKey('demo_offline'),
  demoSeeded: lsKey('demo_seeded'),
};

const MATERIALS = ['PLA', 'PLA Silk', 'PLA Mat', 'PLA-CF', 'PETG', 'PETG-CF', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'PVA', 'Résine', 'Autre'];

const FAILURE_REASONS = ['Décollement', 'Spaghetti', 'Buse bouchée', 'Coupure / panne', 'Fin de filament', 'Erreur de découpe', 'Autre'];

const ADJUST_REASONS = {
  casse: 'Casse',
  perte: 'Perte',
  perso: 'Usage perso / cadeau',
  correction: "Correction d'inventaire",
};

const TABLES = ['settings', 'machines', 'spools', 'templates', 'productions', 'spool_movements',
  'production_stock', 'stock_adjustments', 'sales', 'sale_items', 'sale_allocations', 'orders'];

const PK = (table) => (table === 'settings' ? 'owner_id' : 'id');

/* ---------- identifiants ---------- */
function uuid() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  (globalThis.crypto || { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ---------- HTML sûr : tout est échappé sauf ce qui est marqué raw() ---------- */
class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
const raw = (s) => new Raw(String(s ?? ''));

function esc(v) {
  return String(v ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
}

function renderVal(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(renderVal).join('');
  return esc(v);
}

function html(strings, ...vals) {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < vals.length) out += renderVal(vals[i]);
  }
  return new Raw(out);
}

/* ---------- nombres ---------- */
const NF = {
  eur: new Intl.NumberFormat(SITE.locale, { style: 'currency', currency: 'EUR' }),
  eur0: new Intl.NumberFormat(SITE.locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }),
  n0: new Intl.NumberFormat(SITE.locale, { maximumFractionDigits: 0 }),
  n1: new Intl.NumberFormat(SITE.locale, { maximumFractionDigits: 1 }),
  n2: new Intl.NumberFormat(SITE.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  n3: new Intl.NumberFormat(SITE.locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const toNum = (v, d = 0) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : d;
};
const round = (v, d = 2) => {
  const f = 10 ** d;
  return Math.round((toNum(v) + Number.EPSILON) * f) / f;
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sum = (arr, fn = (x) => x) => arr.reduce((acc, x) => acc + toNum(fn(x)), 0);

function fmtEur(v, { sign = false, compact = false } = {}) {
  const n = toNum(v);
  // compact (axes des graphiques) : « 300 € » plutôt que « 300,00 € »
  const s = (compact && (Math.abs(n) >= 1000 || Number.isInteger(n)) ? NF.eur0 : NF.eur).format(Math.abs(n) < 0.005 ? 0 : n);
  return sign && n > 0.004 ? `+${s}` : s;
}
const fmtNum = (v, d = 0) => (d === 0 ? NF.n0 : d === 1 ? NF.n1 : d === 2 ? NF.n2 : NF.n3).format(toNum(v));
// Accord en français : 0 et 1 au singulier (« 1 pièce prête », « 3 pièces prêtes »)
// Accord selon la langue du site : en français 0 et 1 au singulier ; en portugais, seul 1 l'est (« 0 peças »)
const isPlural = (n) => {
  const a = Math.abs(Math.round(toNum(n)));
  return SITE.lang === 'fr' ? a >= 2 : a !== 1;
};
const pl = (n, one, many) => (isPlural(n) ? many : one);
const plural = (n, one, many) => `${fmtNum(n)} ${pl(n, one, many)}`;
function fmtG(g) {
  const n = toNum(g);
  if (Math.abs(n) >= 1000) return `${NF.n2.format(n / 1000)} kg`;
  return `${NF.n0.format(n)} g`;
}
const fmtKg = (g) => `${NF.n2.format(toNum(g) / 1000)} kg`;
const fmtPct = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(d === 0 ? NF.n0 : NF.n1).format(v)} %`);
const fmtCpg = (v) => `${NF.n3.format(toNum(v))} €/g`;

function fmtDuration(min) {
  const m = Math.round(toNum(min));
  if (m <= 0) return '0 min';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}

// « 22,50 », « 1 000 », « 22.5 » → nombre ; vide ou invalide → NaN
function parseNum(input) {
  if (typeof input === 'number') return input;
  const s = String(input ?? '').trim().replace(/[\s  ]/g, '').replace(/€|g$/gi, '');
  if (s === '') return NaN;
  const norm = s.replace(',', '.');
  if (!/^[-+]?\d*\.?\d+$/.test(norm)) return NaN;
  return Number(norm);
}

/* ---------- dates ---------- */
const DAY = 86400000;
const pad2 = (n) => String(n).padStart(2, '0');

function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fromLocalInput(v) {
  if (!v) return new Date().toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// Date longue : ordre et petits mots traduits avec le reste de l'appli (« 18 septembre 2026 à 14:05 »,
// en portugais « 18 de setembro de 2026 às 14:05 »)
const DATE_LONG = ui('%j %mois %an à %h');

function fmtDate(iso, style = 'short') {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  if (style === 'day') return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  if (style === 'time') return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (style === 'long') {
    return DATE_LONG.replace('%j', d.getDate()).replace('%mois', MONTHS_LONG[d.getMonth()]).replace('%an', d.getFullYear()).replace('%h', `${pad2(d.getHours())}:${pad2(d.getMinutes())}`);
  }
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
}

function fmtRelative(iso, now = Date.now()) {
  if (!iso) return ui('jamais');
  const diff = now - new Date(iso).getTime();
  if (diff < 45000) return "à l'instant";
  if (diff < 3600000) return `il y a ${Math.round(diff / 60000)} min`;
  if (diff < DAY) return `il y a ${Math.round(diff / 3600000)} h`;
  return fmtDate(iso, 'day');
}

function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Périodes du tableau de bord : [start, end[
function periodRange(period, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case 'month':
      return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1), label: `${MONTHS_LONG[m]} ${y}`, year: y };
    case 'prev':
      return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1), label: `${MONTHS_LONG[(m + 11) % 12]} ${m === 0 ? y - 1 : y}`, year: m === 0 ? y - 1 : y };
    case 'year':
      return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1), label: `année ${y}`, year: y };
    default:
      return { start: new Date(1970, 0, 1), end: new Date(9999, 0, 1), label: 'depuis le début', year: y };
  }
}
const inRange = (iso, r) => {
  const t = new Date(iso).getTime();
  return t >= r.start.getTime() && t < r.end.getTime();
};

/* ---------- couleurs ---------- */
function safeHex(hex, fallback = '#94A3B8') {
  const h = String(hex || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(h)) return h.toUpperCase();
  if (/^#[0-9a-f]{8}$/i.test(h)) return h.slice(0, 7).toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(h)) return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`.toUpperCase();
  return fallback;
}
function hexToRgb(hex) {
  const h = safeHex(hex, '#000000');
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
// Distance perceptive « redmean » (0 = identique, ~765 = opposé)
function colorDistance(a, b) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}
function isLight(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

/* ---------- divers ---------- */
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}
function normalizeText(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function lsGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function lsSet(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/* ---------- icônes Lucide (sous-ensemble intégré au build) ---------- */
const ICONS = /*@@ICONS@@*/ {};

function icon(name, cls = 'w-5 h-5') {
  const node = ICONS[name];
  if (!node) return raw('');
  const inner = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`).join('');
  return raw(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${esc(cls)}" aria-hidden="true">${inner}</svg>`);
}

/* ---------- logo : la lettre du site (P, A…) imprimée couche par couche ---------- */
let logoSeq = 0;
function logoMark(size = 40, { tile = true, animated = false } = {}) {
  const id = `p3dclip${++logoSeq}`;
  const layers = [];
  for (let i = 0; i < 11; i++) {
    const y = 22 + i * 7;
    const fill = i < 3 ? '#223244' : i === 3 ? '#22D3EE' : '#22F2A0';
    layers.push(`<rect x="30" y="${y}" width="70" height="${i === 10 ? 6 : 5}" fill="${fill}"${animated && i >= 3 ? ` class="p3d-layer" style="animation-delay:${(10 - i) * 90}ms"` : ''}/>`);
  }
  return raw(`<svg viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="${esc(SITE.name)}">
    <defs><clipPath id="${id}"><path clip-rule="evenodd" d="${SITE.letter}"/></clipPath></defs>
    ${tile ? '<rect x="1" y="1" width="118" height="118" rx="27" fill="#0F151C" stroke="#243244" stroke-width="1.5"/>' : ''}
    <g clip-path="url(#${id})">${layers.join('')}</g>
    <line x1="22" y1="45.5" x2="30" y2="45.5" stroke="#22D3EE" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="98" y1="45.5" x2="104" y2="45.5" stroke="#22D3EE" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`);
}

function logoLockup({ size = 40, tagline = true } = {}) {
  return html`<div class="flex items-center gap-3 select-none">
    ${logoMark(size)}
    <div class="leading-none">
      <div class="font-display font-bold tracking-tight text-[22px] text-slate-50">${SITE.name.replace(/3D$/, '')}<span class="text-neon">3D</span></div>
      ${tagline ? html`<div class="mt-1 text-[11px] text-slate-500">Atelier d'impression 3D</div>` : ''}
    </div>
  </div>`;
}
