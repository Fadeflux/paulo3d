/* =============================================================================
   Domaine : coûts de revient, prix, bobines, stock, ventes, statistiques
   Les calculs de la base (schema.sql) sont reproduits ici à l'identique pour
   l'affichage immédiat et le mode hors-ligne. La base reste la référence.
   ============================================================================= */

const DEFAULT_CHANNELS = [
  { id: 'direct', name: 'Main propre', pct: 0, fixed: 0 },
  { id: 'etsy', name: 'Etsy', pct: 0, fixed: 0 },
  { id: 'vinted', name: 'Vinted', pct: 0, fixed: 0 },
  { id: 'leboncoin', name: 'Leboncoin', pct: 0, fixed: 0 },
  { id: 'site', name: 'Site web', pct: 0, fixed: 0 },
  { id: 'salon', name: 'Salon / marché', pct: 0, fixed: 0 },
];

const DEFAULT_SETTINGS = {
  workshop_name: 'Paulo3D',
  machine_rate: 0.3,
  labor_rate: 20,
  filament_price_kg: 20,
  pricing_mode: 'coef',
  price_coef: 2.5,
  target_margin_pct: 65,
  price_rounding: 'x.90',
  spool_low_g: 300,
  spool_critical_g: 150,
  sales_channels: DEFAULT_CHANNELS,
  last_backup_at: null, // dernière sauvegarde complète (JSON), partagée entre appareils
};

const SETTINGS_FIELDS = Object.keys(DEFAULT_SETTINGS);

const SPOOL_STATUS = {
  ok: { label: 'OK', tone: 'ok' },
  low: { label: 'Bientôt vide', tone: 'warn' },
  critical: { label: 'Critique', tone: 'bad' },
  empty: { label: 'Vide', tone: 'bad' },
};

const time = (iso) => (iso ? new Date(iso).getTime() : 0);

// Horodatage PostgreSQL précis à la microseconde (Date s'arrête à la milliseconde)
function tsMicros(iso) {
  if (!iso) return 0;
  const s = String(iso).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/i);
  if (!m) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t * 1000 : 0;
  }
  let zone = m[4] || 'Z';
  if (/^[+-]\d{2}$/.test(zone)) zone += ':00';
  else if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const base = Date.parse(`${m[1]}T${m[2]}${zone.toUpperCase()}`);
  if (!Number.isFinite(base)) return 0;
  return base * 1000 + Number((m[3] || '').padEnd(6, '0').slice(0, 6));
}

// Arrondi « comme PostgreSQL » (moitié loin de zéro) : l'écran et la base tombent juste
function roundDb(v, d = 2) {
  const n = toNum(v);
  const f = 10 ** d;
  const r = Math.round(Math.abs(n) * f + 1e-7) / f;
  return n < 0 ? -r : r;
}

function firstRow(map) {
  for (const v of map.values()) return v;
  return null;
}

function settingsOf(V) {
  const row = V && V.settings ? firstRow(V.settings) : null;
  const st = { ...DEFAULT_SETTINGS, ...(row || {}) };
  for (const k of ['machine_rate', 'labor_rate', 'filament_price_kg', 'price_coef', 'target_margin_pct', 'spool_low_g', 'spool_critical_g']) {
    st[k] = toNum(st[k], DEFAULT_SETTINGS[k]);
  }
  if (!Array.isArray(st.sales_channels) || !st.sales_channels.length) st.sales_channels = DEFAULT_CHANNELS;
  return st;
}

const valuesOf = (map) => (map ? [...map.values()] : []);

/* ---------- commandes clients ---------- */
const ORDER_STATUS = {
  todo: { label: 'À faire', tone: 'warn' },
  ready: { label: 'Prête', tone: 'ok' },
  delivered: { label: 'Livrée', tone: 'off' },
  cancelled: { label: 'Annulée', tone: 'off' },
};
const ORDER_STATUSES = Object.keys(ORDER_STATUS);
// Jours avant la date promise (négatif = en retard), comptés en jours LOCAUX
function orderDueIn(order, now = new Date()) {
  const m = String((order && order.due_date) || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const due = new Date(+m[1], +m[2] - 1, +m[3]);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due - today) / 86400000);
}
const orderTotal = (o) => (o.unit_price === null || o.unit_price === undefined ? null : roundDb(toNum(o.unit_price) * toNum(o.quantity), 2));
// À faire et prêtes, la plus urgente d'abord (sans date : en dernier)
function openOrders(V, now = new Date()) {
  return valuesOf(V.orders).filter((o) => o.status === 'todo' || o.status === 'ready').sort((a, b) => {
    const da = orderDueIn(a, now);
    const db = orderDueIn(b, now);
    if (da === null || db === null) return (da === null) - (db === null) || String(a.created_at).localeCompare(String(b.created_at));
    return da - db || String(a.created_at).localeCompare(String(b.created_at));
  });
}

/* ---------- sauvegardes ---------- */
// L'offre gratuite de Supabase ne garde aucune copie restaurable : l'appli rappelle chaque mois
// de télécharger une sauvegarde complète (seulement s'il y a des données à perdre).
const BACKUP_EVERY_DAYS = 30;
function backupStatus(V, now = Date.now()) {
  const last = settingsOf(V).last_backup_at || null;
  const t = last ? time(last) : 0;
  const days = t ? Math.max(0, Math.floor((now - t) / 86400000)) : null;
  const hasData = ['spools', 'templates', 'productions', 'sales'].some((k) => V[k] && V[k].size > 0);
  return { last, days, due: hasData && (days === null || days >= BACKUP_EVERY_DAYS) };
}

/* ---------- machines ---------- */
function activeMachines(V) {
  return valuesOf(V.machines).filter((m) => !m.archived).sort((a, b) => (b.is_default - a.is_default) || a.name.localeCompare(b.name, 'fr'));
}
// Choix d'une machine : les machines actives, plus celle déjà choisie si elle a été archivée
// (sinon la liste afficherait « Par défaut » alors que le calcul utilise la machine archivée)
function machineOptions(V, selectedId) {
  const list = activeMachines(V);
  const sel = selectedId ? V.machines.get(selectedId) : null;
  if (sel && sel.archived) list.push(sel);
  return [
    { value: '', label: `Par défaut (${fmtNum(settingsOf(V).machine_rate, 2)} €/h)` },
    ...list.map((mc) => ({ value: mc.id, label: `${mc.name}${mc.archived ? ' (archivée)' : ''} (${fmtNum(mc.hourly_rate, 2)} €/h)` })),
  ];
}
function defaultMachine(V) {
  return activeMachines(V).find((m) => m.is_default) || null;
}
function machineRate(V, machineId, st = settingsOf(V)) {
  const m = machineId ? V.machines.get(machineId) : defaultMachine(V);
  return m ? toNum(m.hourly_rate) : toNum(st.machine_rate);
}
function machineLabel(V, machineId, st = settingsOf(V)) {
  const m = machineId ? V.machines.get(machineId) : defaultMachine(V);
  return m ? m.name : `Machine par défaut (${fmtNum(st.machine_rate, 2)} €/h)`;
}

/* ---------- bobines ---------- */
function spoolCpg(s) {
  const w = toNum(s && s.initial_weight_g);
  return w > 0 ? toNum(s.price) / w : 0;
}
function spoolStatus(s, st) {
  const rem = toNum(s.remaining_weight_g);
  if (rem <= 0) return 'empty';
  if (rem < toNum(st.spool_critical_g)) return 'critical';
  if (rem < toNum(st.spool_low_g)) return 'low';
  return 'ok';
}
function spoolLabel(s) {
  if (!s) return 'Bobine supprimée';
  return [s.brand, s.material, s.color_name].filter(Boolean).join(' · ');
}
function spoolPct(s) {
  const w = toNum(s.initial_weight_g);
  return w > 0 ? clamp((toNum(s.remaining_weight_g) / w) * 100, 0, 100) : 0;
}

// Une pesée ne peut pas dépasser le poids initial de plus de 5 % (léger surplus de certains fabricants) :
// au-delà, c'est presque toujours la bobine vide oubliée. Même règle dans p3d_weigh_spool().
const WEIGH_TOLERANCE = 1.05;
function weighProblem(spool, measured) {
  const w = toNum(spool && spool.initial_weight_g);
  if (!(w > 0) || !(toNum(measured, -1) > roundDb(w * WEIGH_TOLERANCE, 2))) return null;
  return `${fmtG(measured)}, c'est plus que le poids initial de la bobine (${fmtG(w)}) : as-tu retiré le poids de la bobine vide ? Sinon, corrige le poids initial de la bobine.`;
}
// Nombre de pièces saisi : un entier ≥ 1. Jamais arrondi en silence (« 1,5 » est une faute de frappe :
// l'arrondir enregistrerait 2 pièces sans prévenir).
function isPieceCount(v) {
  const n = toNum(v, NaN);
  return Number.isInteger(n) && n >= 1;
}
const PIECES_ERROR = 'Nombre entier de pièces (1, 2, 3…).';

// Champs d'une commande : EXACTEMENT les limites de la table orders (sinon l'action serait acceptée
// hors-ligne puis refusée par la base). partial : seuls les champs présents sont vérifiés (modification).
const ORDER_MAX_QTY = 10000;
function orderFieldsProblem(f, partial = false) {
  const has = (k) => !partial || k in f;
  const len = (v) => [...String(v ?? '')].length;
  if (has('item_name') && !(len(String(f.item_name || '').trim()) >= 1 && len(String(f.item_name || '').trim()) <= 120)) return new OpError('P3D09', 'Indique la pièce commandée (120 caractères au plus).');
  if (has('quantity') && !isPieceCount(f.quantity)) return new OpError('P3D09', `Quantité invalide : ${PIECES_ERROR}`);
  if (has('quantity') && toNum(f.quantity) > ORDER_MAX_QTY) return new OpError('P3D09', `Une commande compte au plus ${fmtNum(ORDER_MAX_QTY)} pièces.`);
  if (has('unit_price') && f.unit_price !== null && f.unit_price !== undefined && !(toNum(f.unit_price, -1) >= 0 && toNum(f.unit_price) < 1e8)) return new OpError('P3D09', 'Prix invalide.');
  if ('customer' in f && len(f.customer) > 120) return new OpError('P3D09', 'Nom du client trop long (120 caractères au plus).');
  if ('channel' in f && f.channel !== null && len(f.channel) > 40) return new OpError('P3D09', 'Canal de vente invalide.');
  if ('note' in f && f.note !== null && len(f.note) > 1000) return new OpError('P3D09', 'Note trop longue (1 000 caractères au plus).');
  return null;
}

// Exemple de poids restant affiché dans les champs vides (proportionné à la bobine)
const weighExample = (spool) => Math.round(toNum(spool && spool.initial_weight_g, 1000) * 0.64);
const materialKey = (m) => normalizeText(m).replace(/[\s_-]+/g, ' ');

function activeSpools(V) {
  return valuesOf(V.spools).filter((s) => !s.archived);
}

// Même calcul que p3d_spool_recompute() : dernière pesée (ou poids initial) + consommations postérieures
function computeSpoolRemaining(spool, movements) {
  let last = null;
  const mine = movements.filter((m) => m.spool_id === spool.id);
  for (const m of mine) {
    if (m.kind !== 'weigh') continue;
    if (!last || time(m.occurred_at) > time(last.occurred_at) || (time(m.occurred_at) === time(last.occurred_at) && time(m.created_at) > time(last.created_at))) last = m;
  }
  const base = last ? toNum(last.measured_g) : toNum(spool.initial_weight_g);
  const deltas = mine.filter((m) => m.kind !== 'weigh' && (!last || time(m.occurred_at) > time(last.occurred_at)));
  return roundDb(base + sum(deltas, (m) => m.delta_g), 2);
}

// Bobines compatibles avec une ligne de matière, la plus proche en couleur d'abord
function candidateSpools(V, line, { needGrams = 0 } = {}) {
  const key = materialKey(line.material);
  const hex = safeHex(line.color_hex);
  const ranked = activeSpools(V)
    .filter((s) => materialKey(s.material) === key)
    .map((s) => ({ spool: s, dist: colorDistance(s.color_hex, hex), close: colorDistance(s.color_hex, hex) < 60, enough: toNum(s.remaining_weight_g) >= needGrams }));
  // couleur proche d'abord, puis assez de filament, puis la plus proche, puis la plus entamée (on finit les bobines ouvertes)
  return ranked.sort((a, b) => {
    if (a.close !== b.close) return a.close ? -1 : 1;
    if (a.enough !== b.enough) return a.enough ? -1 : 1;
    if (Math.abs(a.dist - b.dist) > 1) return a.dist - b.dist;
    return toNum(a.spool.remaining_weight_g) - toNum(b.spool.remaining_weight_g);
  });
}

function suggestSpool(V, line, needGrams) {
  if (line.spool_id) {
    const s = V.spools.get(line.spool_id);
    if (s && !s.archived && toNum(s.remaining_weight_g) >= needGrams) return s;
  }
  const c = candidateSpools(V, line, { needGrams }).find((x) => x.dist < 60);
  if (c) return c.spool;
  if (line.spool_id) {
    const s = V.spools.get(line.spool_id);
    if (s && !s.archived) return s;
  }
  return null;
}

// Prix au gramme d'une ligne : bobine liée > bobines de même matière et couleur proche > même matière > prix par défaut
function lineCpg(V, line, st = settingsOf(V)) {
  const linked = line.spool_id ? V.spools.get(line.spool_id) : null;
  if (linked) return { cpg: spoolCpg(linked), source: 'spool' };
  const same = activeSpools(V).filter((s) => materialKey(s.material) === materialKey(line.material));
  if (same.length) {
    const close = same.filter((s) => colorDistance(s.color_hex, line.color_hex) < 60);
    const pool = close.length ? close : same;
    return { cpg: sum(pool, spoolCpg) / pool.length, source: close.length ? 'color' : 'material' };
  }
  return { cpg: toNum(st.filament_price_kg) / 1000, source: 'default' };
}

/* ---------- templates : coût de revient et prix ---------- */
function templateCost(V, t, st = settingsOf(V)) {
  const lines = Array.isArray(t.materials) ? t.materials : [];
  const gramsModel = sum(lines, (l) => l.grams);
  const purgeG = toNum(t.purge_g);
  let material = 0;
  let purge = 0;
  const details = lines.map((l, i) => {
    const { cpg, source } = lineCpg(V, l, st);
    const share = gramsModel > 0 ? toNum(l.grams) / gramsModel : i === 0 ? 1 : 0;
    material += toNum(l.grams) * cpg;
    purge += purgeG * share * cpg;
    return { ...l, cpg, source, purgeG: purgeG * share };
  });
  if (!lines.length && purgeG > 0) purge = (purgeG * toNum(st.filament_price_kg)) / 1000;
  const rate = machineRate(V, t.machine_id, st);
  const hardware = toNum(t.hardware_cost);
  const machine = (toNum(t.print_time_min) / 60) * rate;
  const labor = (toNum(t.labor_min) / 60) * toNum(st.labor_rate);
  const total = material + purge + hardware + machine + labor;
  return { material, purge, hardware, machine, labor, total, gramsModel, purgeG, grams: gramsModel + purgeG, rate, lines: details };
}

function roundPrice(v, mode) {
  const n = toNum(v);
  if (n <= 0) return 0;
  switch (mode) {
    case '0.10': return round(Math.ceil(round(n * 10, 6)) / 10, 2);
    case '0.50': return round(Math.ceil(round(n * 2, 6)) / 2, 2);
    case '1': return Math.ceil(round(n, 6));
    case 'x.90': {
      const f = Math.floor(n);
      return round(f + 0.9 >= n - 1e-9 ? f + 0.9 : f + 1.9, 2);
    }
    default: return round(n, 2);
  }
}

function pricingOf(t, st) {
  return {
    mode: (t && t.pricing_mode) || st.pricing_mode,
    coef: toNum(t && t.price_coef != null ? t.price_coef : st.price_coef, 2.5),
    marginPct: toNum(t && t.target_margin_pct != null ? t.target_margin_pct : st.target_margin_pct, 65),
    rounding: st.price_rounding,
  };
}

function suggestPrice(cost, pr) {
  const c = toNum(cost);
  const base = pr.mode === 'margin' ? (pr.marginPct >= 100 ? c : c / (1 - pr.marginPct / 100)) : c * pr.coef;
  return { raw: base, rounded: roundPrice(base, pr.rounding) };
}

function marginInfo(price, cost) {
  const p = toNum(price);
  const eur = p - toNum(cost);
  return { eur, pct: p > 0 ? (eur / p) * 100 : null, coef: cost > 0 ? p / cost : null };
}

function templatePrice(V, t, st = settingsOf(V)) {
  const cost = templateCost(V, t, st);
  const sug = suggestPrice(cost.total, pricingOf(t, st));
  const price = t.catalog_price != null && t.catalog_price !== '' ? toNum(t.catalog_price) : sug.rounded;
  return { cost, suggested: sug, price, fixed: t.catalog_price != null && t.catalog_price !== '', margin: marginInfo(price, cost.total) };
}

/* ---------- production et print raté : coûts figés ---------- */
function planProduction(V, opts, st = settingsOf(V)) {
  const t = opts.template;
  const kind = opts.kind === 'failure' ? 'failure' : 'production';
  const q = Math.max(1, Math.round(toNum(opts.quantity, 1)));
  const failedPct = kind === 'failure' ? clamp(toNum(opts.failedPct, 100), 1, 100) : 100;
  const k = failedPct / 100;
  const lines = Array.isArray(t.materials) ? t.materials : [];
  const gramsModel = sum(lines, (l) => l.grams);
  const purgeG = toNum(t.purge_g);
  const machineId = opts.machineId !== undefined ? opts.machineId : t.machine_id || null;
  const machine = machineId ? V.machines.get(machineId) : null;
  const rate = machine ? toNum(machine.hourly_rate) : machineRate(V, null, st);
  const spoolIds = opts.spoolIds || [];

  const bySpool = new Map();
  const warnings = [];
  let material = 0;
  let purge = 0;
  let gramsTotal = 0;
  let purgeTotal = 0;

  lines.forEach((l, i) => {
    const share = gramsModel > 0 ? toNum(l.grams) / gramsModel : i === 0 ? 1 : 0;
    const gModel = toNum(l.grams) * q * k;
    const gPurge = purgeG * share * q * k;
    if (gModel + gPurge <= 0) return;
    const spoolId = spoolIds[i] !== undefined ? spoolIds[i] : l.spool_id || null;
    const spool = spoolId ? V.spools.get(spoolId) : null;
    const cpg = spool ? spoolCpg(spool) : lineCpg(V, { ...l, spool_id: null }, st).cpg;
    material += gModel * cpg;
    purge += gPurge * cpg;
    gramsTotal += gModel + gPurge;
    purgeTotal += gPurge;
    const key = spool ? spool.id : `none:${i}`;
    const cur = bySpool.get(key) || {
      spool_id: spool ? spool.id : null,
      grams: 0,
      cost_per_g: cpg,
      material: spool ? spool.material : l.material,
      color_name: (spool ? spool.color_name : l.color_name) || '',
      color_hex: safeHex(spool ? spool.color_hex : l.color_hex),
      movement_id: uuid(),
    };
    cur.grams += gModel + gPurge;
    bySpool.set(key, cur);
    if (!spool) warnings.push({ type: 'no_spool', line: l, index: i });
  });
  if (!lines.length && purgeG > 0) {
    const cpg = toNum(st.filament_price_kg) / 1000;
    purge += purgeG * q * k * cpg;
    gramsTotal += purgeG * q * k;
    purgeTotal += purgeG * q * k;
  }

  const consumption = [...bySpool.values()].map((c) => ({ ...c, grams: roundDb(c.grams, 2), cost_per_g: roundDb(c.cost_per_g, 6) }));
  for (const c of consumption) {
    if (!c.spool_id) continue;
    const s = V.spools.get(c.spool_id);
    if (s && toNum(s.remaining_weight_g) < c.grams) warnings.push({ type: 'spool_short', spool: s, need: c.grams, have: toNum(s.remaining_weight_g) });
  }

  const hardware = kind === 'production' ? toNum(t.hardware_cost) * q : 0;
  const printMin = toNum(t.print_time_min) * q * k;
  const machineCost = (printMin / 60) * rate;
  const laborMin = kind === 'production' ? toNum(t.labor_min) * q : 0;
  const labor = (laborMin / 60) * toNum(st.labor_rate);

  const parts = {
    material_cost: roundDb(material, 4),
    purge_cost: roundDb(purge, 4),
    hardware_cost: roundDb(hardware, 4),
    machine_cost: roundDb(machineCost, 4),
    labor_cost: roundDb(labor, 4),
  };
  const total = roundDb(parts.material_cost + parts.purge_cost + parts.hardware_cost + parts.machine_cost + parts.labor_cost, 4);

  return {
    warnings,
    payload: {
      id: opts.id || uuid(),
      kind,
      lot_id: kind === 'production' ? opts.lotId || uuid() : null,
      template_id: t.id || null,
      item_name: String(t.name || '').trim() || 'Pièce',
      quantity: q,
      failed_pct: failedPct,
      failure_reason: kind === 'failure' ? opts.reason || null : null,
      machine_id: machine ? machine.id : null,
      machine_rate: roundDb(rate, 4),
      labor_rate: roundDb(st.labor_rate, 2),
      grams_total: roundDb(gramsTotal, 2),
      purge_g_total: roundDb(purgeTotal, 2),
      print_time_min_total: roundDb(printMin, 2),
      labor_min_total: roundDb(laborMin, 2),
      ...parts,
      total_cost: total,
      unit_cost: roundDb(total / q, 4),
      consumption,
      note: opts.note ? String(opts.note).trim() || null : null,
      occurred_at: opts.occurredAt || new Date().toISOString(),
    },
  };
}

/* ---------- stock de pièces finies ---------- */
function fifoCmp(a, b) {
  return (time(a.occurred_at) - time(b.occurred_at)) || (time(a.created_at) - time(b.created_at)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function lotMatches(lot, templateId, itemName) {
  return templateId ? lot.template_id === templateId : !lot.template_id && lot.item_name === String(itemName || '').trim();
}

function computeLotAvailable(lot, allocations, adjustments) {
  return toNum(lot.quantity)
    - sum(allocations.filter((a) => a.lot_id === lot.id), (a) => a.quantity)
    - sum(adjustments.filter((a) => a.lot_id === lot.id), (a) => a.quantity);
}

// Simule le « premier produit, premier vendu » sans modifier l'état
function simulateFifo(V, requests) {
  const avail = new Map();
  const results = [];
  for (const r of requests) {
    const lots = valuesOf(V.production_stock)
      .filter((l) => lotMatches(l, r.template_id, r.item_name))
      .sort(fifoCmp);
    let need = Math.max(0, Math.round(toNum(r.quantity)));
    const allocations = [];
    for (const l of lots) {
      if (need <= 0) break;
      const left = avail.has(l.id) ? avail.get(l.id) : toNum(l.qty_available);
      if (left <= 0) continue;
      const take = Math.min(need, left);
      avail.set(l.id, left - take);
      allocations.push({ lot: l, quantity: take, unit_cost: toNum(l.unit_cost) });
      need -= take;
    }
    results.push({ allocations, shortage: need, cogs: sum(allocations, (a) => a.quantity * a.unit_cost) });
  }
  return results;
}

function stockKey(row) {
  return row.template_id ? `t:${row.template_id}` : `n:${String(row.item_name || '').trim()}`;
}

function stockGroups(V) {
  const groups = new Map();
  for (const lot of valuesOf(V.production_stock)) {
    const key = stockKey(lot);
    const g = groups.get(key) || { key, template_id: lot.template_id || null, item_name: lot.item_name, qty: 0, value: 0, produced: 0, lots: [] };
    g.produced += toNum(lot.quantity);
    if (toNum(lot.qty_available) > 0) {
      g.qty += toNum(lot.qty_available);
      g.value += toNum(lot.qty_available) * toNum(lot.unit_cost);
      g.lots.push(lot);
    }
    groups.set(key, g);
  }
  const out = [];
  for (const g of groups.values()) {
    g.lots.sort(fifoCmp);
    g.avgCost = g.qty ? g.value / g.qty : 0;
    g.template = g.template_id ? V.templates.get(g.template_id) || null : null;
    if (g.template) g.item_name = g.template.name;
    out.push(g);
  }
  return out.sort((a, b) => (b.qty > 0) - (a.qty > 0) || a.item_name.localeCompare(b.item_name, 'fr'));
}

function stockForTemplate(V, templateId) {
  return sum(valuesOf(V.production_stock).filter((l) => l.template_id === templateId), (l) => l.qty_available);
}

/* ---------- ventes ---------- */
function channelOf(st, id) {
  return (st.sales_channels || []).find((c) => c.id === id) || { id, name: id || 'Autre', pct: 0, fixed: 0 };
}
function channelFee(st, channelId, amount) {
  const c = channelOf(st, channelId);
  const fee = (toNum(amount) * toNum(c.pct)) / 100 + toNum(c.fixed);
  return roundDb(fee > 0 ? fee : 0, 2);
}

function planSale(V, form) {
  const items = (form.items || []).filter((i) => String(i.item_name || '').trim() && toNum(i.quantity) > 0);
  const fifo = simulateFifo(V, items.filter((i) => i.from_stock !== false));
  let fi = 0;
  const lines = items.map((i) => {
    const qty = Math.round(toNum(i.quantity));
    const total = qty * toNum(i.unit_price);
    if (i.from_stock === false) return { ...i, quantity: qty, total, cogs: qty * toNum(i.unit_cost), shortage: 0 };
    const f = fifo[fi++];
    return { ...i, quantity: qty, total, cogs: f.cogs, shortage: f.shortage, allocations: f.allocations };
  });
  const itemsTotal = sum(lines, (l) => l.total);
  const amount = itemsTotal + toNum(form.shipping_charged);
  const cogs = sum(lines, (l) => l.cogs);
  const fees = toNum(form.shipping_cost) + toNum(form.packaging_cost) + toNum(form.platform_fee);
  const net = amount - cogs - fees;
  return {
    lines,
    itemsTotal,
    amount,
    cogs,
    fees,
    net,
    marginPct: amount > 0 ? (net / amount) * 100 : null,
    shortages: lines.filter((l) => l.shortage > 0),
    payload: {
      id: form.id || uuid(),
      channel: form.channel || 'direct',
      customer: String(form.customer || '').trim() || null,
      note: String(form.note || '').trim() || null,
      shipping_charged: roundDb(form.shipping_charged, 2),
      shipping_cost: roundDb(form.shipping_cost, 2),
      packaging_cost: roundDb(form.packaging_cost, 2),
      platform_fee: roundDb(form.platform_fee, 2),
      occurred_at: form.occurred_at || new Date().toISOString(),
      items: lines.map((l) => ({
        id: l.id || uuid(),
        template_id: l.template_id || null,
        item_name: String(l.item_name).trim(),
        quantity: l.quantity,
        unit_price: roundDb(l.unit_price, 2),
        from_stock: l.from_stock !== false,
        unit_cost: l.from_stock === false ? roundDb(l.unit_cost, 4) : 0,
      })),
    },
  };
}

function saleItemsOf(V, saleId) {
  return valuesOf(V.sale_items).filter((i) => i.sale_id === saleId).sort((a, b) => a.position - b.position);
}
function saleTitle(V, sale) {
  const items = saleItemsOf(V, sale.id);
  if (!items.length) return 'Vente';
  const first = `${items[0].quantity > 1 ? `${items[0].quantity} × ` : ''}${items[0].item_name}`;
  return items.length > 1 ? `${first} + ${items.length - 1} autre${items.length > 2 ? 's' : ''}` : first;
}

/* ---------- statistiques ---------- */
function productionUnitParts(p) {
  const q = Math.max(1, toNum(p.quantity));
  return {
    material: (toNum(p.material_cost) + toNum(p.purge_cost)) / q,
    hardware: toNum(p.hardware_cost) / q,
    machine: toNum(p.machine_cost) / q,
    labor: toNum(p.labor_cost) / q,
  };
}

function computeStats(V, range) {
  const sales = valuesOf(V.sales).filter((s) => inRange(s.occurred_at, range));
  const saleIds = new Set(sales.map((s) => s.id));
  const items = valuesOf(V.sale_items).filter((i) => saleIds.has(i.sale_id));
  const prods = valuesOf(V.productions).filter((p) => inRange(p.occurred_at, range));
  const made = prods.filter((p) => p.kind === 'production');
  const failed = prods.filter((p) => p.kind === 'failure');
  const adjustments = valuesOf(V.stock_adjustments).filter((a) => inRange(a.occurred_at, range));

  const revenue = sum(sales, (s) => s.amount);
  const cogs = sum(sales, (s) => s.cogs);
  const shipping = sum(sales, (s) => s.shipping_cost);
  const packaging = sum(sales, (s) => s.packaging_cost);
  const platform = sum(sales, (s) => s.platform_fee);
  const failureLoss = sum(failed, (p) => p.total_cost);
  const adjustLoss = sum(adjustments, (a) => toNum(a.quantity) * toNum(a.unit_cost));
  const costs = cogs + shipping + packaging + platform + failureLoss + adjustLoss;
  const net = revenue - costs;
  const piecesMade = sum(made, (p) => p.quantity);
  const piecesFailed = sum(failed, (p) => p.quantity);

  // Répartition du coût des pièces vendues
  const parts = { material: 0, hardware: 0, machine: 0, labor: 0, other: 0 };
  const itemById = new Map(items.map((i) => [i.id, i]));
  for (const i of items) if (i.from_stock === false) parts.other += toNum(i.cogs);
  for (const a of valuesOf(V.sale_allocations)) {
    if (!itemById.has(a.sale_item_id)) continue;
    const lot = V.production_stock.get(a.lot_id);
    const prod = lot && lot.production_id ? V.productions.get(lot.production_id) : null;
    const qty = toNum(a.quantity);
    if (!prod) {
      parts.other += qty * toNum(a.unit_cost);
      continue;
    }
    const u = productionUnitParts(prod);
    parts.material += qty * u.material;
    parts.hardware += qty * u.hardware;
    parts.machine += qty * u.machine;
    parts.labor += qty * u.labor;
  }

  return {
    revenue,
    cogs,
    shipping,
    packaging,
    platform,
    failureLoss,
    adjustLoss,
    costs,
    net,
    marginRate: revenue > 0 ? (net / revenue) * 100 : null,
    gramsTotal: sum(prods, (p) => p.grams_total),
    gramsFailed: sum(failed, (p) => p.grams_total),
    piecesMade,
    piecesFailed,
    piecesSold: sum(items, (i) => i.quantity),
    scrapRate: piecesMade + piecesFailed > 0 ? (piecesFailed / (piecesMade + piecesFailed)) * 100 : null,
    salesCount: sales.length,
    breakdown: {
      material: parts.material,
      machine: parts.machine,
      labor: parts.labor,
      hardware: parts.hardware,
      other: parts.other,
      fees: shipping + packaging + platform,
      failures: failureLoss + adjustLoss,
    },
  };
}

function stockValue(V) {
  return sum(valuesOf(V.production_stock), (l) => toNum(l.qty_available) * toNum(l.unit_cost));
}

// Courbe mensuelle : jamais de mois FUTUR compté à 0 € (la courbe ne doit pas « chuter » à tort)
//   month / prev : les 12 mois glissants qui se terminent sur le mois affiché
//   year         : janvier → décembre de l'année, mois futurs = null (la courbe s'arrête)
//   all          : depuis la première activité (au moins 12 mois)
const seriesCache = new WeakMap();
function monthlySeries(V, period, now = new Date()) {
  // même vue + même mois = même courbe : pas de recalcul à chaque réaffichage (jusqu'à 120 mois de statistiques)
  const cacheKey = `${period}|${now.getFullYear()}-${now.getMonth()}`;
  const cached = seriesCache.get(V);
  if (cached && cached.has(cacheKey)) return cached.get(cacheKey);
  const out = computeMonthlySeries(V, period, now);
  if (!cached) seriesCache.set(V, new Map([[cacheKey, out]]));
  else cached.set(cacheKey, out);
  return out;
}
function computeMonthlySeries(V, period, now) {
  const months = [];
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === 'year') {
    const y = periodRange(period, now).year;
    for (let m = 0; m < 12; m++) months.push(new Date(y, m, 1));
  } else if (period === 'all') {
    let first = new Date(thisMonth.getFullYear(), thisMonth.getMonth() - 11, 1);
    for (const t of ['sales', 'productions']) {
      for (const r of valuesOf(V[t])) {
        const d = new Date(r.occurred_at);
        if (Number.isFinite(d.getTime()) && d < first) first = new Date(d.getFullYear(), d.getMonth(), 1);
      }
    }
    for (let d = first; d <= thisMonth; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(d);
    months.splice(0, Math.max(0, months.length - 120)); // 10 ans maximum (une date aberrante ne doit pas créer 600 points)
  } else {
    const last = periodRange(period, now).start;
    for (let i = 11; i >= 0; i--) months.push(new Date(last.getFullYear(), last.getMonth() - i, 1));
  }
  const withYear = period !== 'year';
  return months.map((start) => {
    const label = `${MONTHS[start.getMonth()]}${withYear ? ` ${String(start.getFullYear()).slice(2)}` : ''}`;
    if (start > thisMonth) return { label, revenue: null, net: null };
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const s = computeStats(V, { start, end });
    return { label, revenue: s.revenue, net: s.net };
  });
}

function topProducts(V, range, n = 6) {
  const saleIds = new Set(valuesOf(V.sales).filter((s) => inRange(s.occurred_at, range)).map((s) => s.id));
  const groups = new Map();
  for (const i of valuesOf(V.sale_items)) {
    if (!saleIds.has(i.sale_id)) continue;
    const key = i.template_id ? `t:${i.template_id}` : `n:${i.item_name}`;
    const t = i.template_id ? V.templates.get(i.template_id) : null;
    const g = groups.get(key) || { name: t ? t.name : i.item_name, qty: 0, revenue: 0, cogs: 0 };
    g.qty += toNum(i.quantity);
    g.revenue += toNum(i.quantity) * toNum(i.unit_price);
    g.cogs += toNum(i.cogs);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.revenue - a.revenue || b.qty - a.qty).slice(0, n);
}

/* ---------- historique ---------- */
function historyEvents(V, { range = null, type = 'all', q = '' } = {}) {
  const ev = [];
  const st = settingsOf(V);
  for (const p of valuesOf(V.productions)) {
    ev.push({
      key: `productions:${p.id}`,
      table: 'productions',
      id: p.id,
      type: p.kind === 'failure' ? 'failure' : 'production',
      date: p.occurred_at,
      title: `${p.kind === 'failure' ? 'Print raté' : 'Production'} · ${p.item_name}`,
      sub: `${p.quantity} pièce${p.quantity > 1 ? 's' : ''}${p.kind === 'failure' ? ` · échec à ${fmtNum(p.failed_pct)} %` : ''} · ${fmtG(p.grams_total)}`,
      amount: -toNum(p.total_cost),
    });
  }
  for (const s of valuesOf(V.sales)) {
    ev.push({
      key: `sales:${s.id}`,
      table: 'sales',
      id: s.id,
      type: 'sale',
      date: s.occurred_at,
      title: `Vente · ${saleTitle(V, s)}`,
      sub: `${channelOf(st, s.channel).name} · marge nette ${fmtEur(s.net_margin)}`,
      amount: toNum(s.amount),
    });
  }
  for (const s of valuesOf(V.spools)) {
    ev.push({ key: `spools:${s.id}`, table: 'spools', id: s.id, type: 'spool', date: s.created_at, title: `Bobine ajoutée · ${spoolLabel(s)}`, sub: `${fmtG(s.initial_weight_g)} · ${fmtEur(s.price)}`, amount: -toNum(s.price) });
  }
  for (const m of valuesOf(V.spool_movements)) {
    if (m.kind !== 'weigh') continue;
    const s = V.spools.get(m.spool_id);
    ev.push({ key: `spool_movements:${m.id}`, table: 'spool_movements', id: m.id, type: 'weigh', date: m.occurred_at, title: `Pesée · ${spoolLabel(s)}`, sub: `${fmtG(m.measured_g)} restants`, amount: null });
  }
  for (const l of valuesOf(V.production_stock)) {
    if (l.production_id) continue;
    ev.push({ key: `production_stock:${l.id}`, table: 'production_stock', id: l.id, type: 'stock', date: l.occurred_at, title: `Stock ajouté · ${l.item_name}`, sub: `${l.quantity} pièce${l.quantity > 1 ? 's' : ''} · ${fmtEur(l.unit_cost)} / pièce`, amount: null });
  }
  for (const [group, adjs] of groupBy(valuesOf(V.stock_adjustments), (a) => a.group_id)) {
    const lot = V.production_stock.get(adjs[0].lot_id);
    const qty = sum(adjs, (a) => a.quantity);
    ev.push({ key: `stock_adjustments:${group}`, table: 'stock_adjustments', id: group, type: 'adjust', date: adjs[0].occurred_at, title: `Retrait du stock · ${lot ? lot.item_name : 'pièce'}`, sub: `${qty} pièce${qty > 1 ? 's' : ''} · ${ADJUST_REASONS[adjs[0].reason] || adjs[0].reason}`, amount: -sum(adjs, (a) => toNum(a.quantity) * toNum(a.unit_cost)) });
  }
  const nq = normalizeText(q);
  return ev
    .filter((e) => (!range || inRange(e.date, range)) && (type === 'all' || e.type === type) && (!nq || normalizeText(`${e.title} ${e.sub}`).includes(nq)))
    .sort((a, b) => time(b.date) - time(a.date));
}

/* ---------- exports ---------- */
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'number' ? String(round(v, 4)).replace('.', ',') : String(v);
  if (/^[=+\-@\t\r]/.test(s) && typeof v !== 'number') s = `'${s}`; // évite l'exécution de formules dans Excel
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(header, rows) {
  return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`;
}
const csvDate = (iso) => (iso ? `${fmtDate(iso, 'short')} ${fmtDate(iso, 'time')}` : '');

// Montants au centime dans les CSV (lisibles dans Excel) ; l'export JSON garde la précision complète
const eur = (v) => roundDb(toNum(v), 2);
function exportCsvSales(V) {
  const st = settingsOf(V);
  const rows = valuesOf(V.sales).sort((a, b) => time(a.occurred_at) - time(b.occurred_at)).map((s) => {
    const items = saleItemsOf(V, s.id);
    return [csvDate(s.occurred_at), channelOf(st, s.channel).name, s.customer || '', items.map((i) => `${i.quantity} × ${i.item_name} (${NF.n2.format(i.unit_price)} €)`).join(' + '),
      sum(items, (i) => i.quantity), eur(s.amount), eur(s.cogs), eur(s.shipping_cost), eur(s.packaging_cost), eur(s.platform_fee), eur(s.net_margin), s.note || ''];
  });
  return toCsv(['Date', 'Canal', 'Client', 'Articles', 'Quantité', 'Encaissé (€)', 'Coût de revient (€)', 'Port payé (€)', 'Emballage (€)', 'Commission (€)', 'Marge nette (€)', 'Note'], rows);
}
function exportCsvProductions(V) {
  const rows = valuesOf(V.productions).sort((a, b) => time(a.occurred_at) - time(b.occurred_at)).map((p) => [
    csvDate(p.occurred_at), p.kind === 'failure' ? 'Print raté' : 'Production', p.item_name, p.quantity, p.kind === 'failure' ? toNum(p.failed_pct) : '',
    toNum(p.grams_total), toNum(p.print_time_min_total), eur(p.material_cost), eur(p.purge_cost), eur(p.hardware_cost), eur(p.machine_cost), eur(p.labor_cost), eur(p.total_cost), eur(p.unit_cost), p.failure_reason || '', p.note || '']);
  return toCsv(['Date', 'Type', 'Article', 'Quantité', 'Échec (%)', 'Filament (g)', 'Temps machine (min)', 'Matière (€)', 'Purge (€)', 'Quincaillerie (€)', 'Machine (€)', "Main-d'œuvre (€)", 'Total (€)', 'Coût unitaire (€)', 'Raison', 'Note'], rows);
}
function exportCsvSpools(V) {
  const st = settingsOf(V);
  const rows = valuesOf(V.spools).map((s) => [s.brand, s.material, s.color_name, s.color_hex, toNum(s.price), toNum(s.initial_weight_g), toNum(s.remaining_weight_g), round(spoolCpg(s), 5), SPOOL_STATUS[spoolStatus(s, st)].label, s.archived ? 'oui' : 'non', s.purchased_at || '']);
  return toCsv(['Marque', 'Matière', 'Couleur', 'Code couleur', 'Prix (€)', 'Poids initial (g)', 'Poids restant (g)', 'Prix au gramme (€)', 'Statut', 'Archivée', "Date d'achat"], rows);
}
function exportCsvJournal(V) {
  const rows = historyEvents(V).reverse().map((e) => [csvDate(e.date), e.title, e.sub, e.amount === null ? '' : eur(e.amount)]);
  return toCsv(['Date', 'Évènement', 'Détails', 'Montant (€)'], rows);
}
function exportJson(V) {
  const tables = {};
  for (const t of TABLES) tables[t] = valuesOf(V[t]);
  return JSON.stringify({ app: 'Paulo3D', schema: SCHEMA_VERSION, version: APP_VERSION, exported_at: new Date().toISOString(), tables }, null, 2);
}
