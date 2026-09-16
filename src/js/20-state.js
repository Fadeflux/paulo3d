/* =============================================================================
   État local
   S = dernier état confirmé par la base (copie locale, gardée sur l'appareil)
   Q = actions pas encore confirmées (file d'envoi, gardée sur l'appareil)
   V = ce qu'on affiche = S + Q rejouées
   Une action n'est retirée de Q qu'après la réponse de la base.
   ============================================================================= */

class OpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const SPOOL_FIELDS = ['id', 'brand', 'material', 'color_name', 'color_hex', 'price', 'initial_weight_g', 'tare_g', 'purchased_at', 'notes', 'archived'];
const MACHINE_FIELDS = ['id', 'name', 'model', 'hourly_rate', 'is_default', 'archived'];
const TEMPLATE_FIELDS = ['id', 'name', 'description', 'photo', 'machine_id', 'pieces_per_print', 'materials', 'purge_g', 'hardware_cost', 'print_time_min', 'labor_min', 'pricing_mode', 'price_coef', 'target_margin_pct', 'catalog_price', 'archived'];
const PRODUCTION_FIELDS = ['id', 'kind', 'template_id', 'item_name', 'quantity', 'failed_pct', 'failure_reason', 'machine_id', 'machine_rate', 'labor_rate', 'grams_total', 'purge_g_total', 'print_time_min_total', 'labor_min_total', 'material_cost', 'purge_cost', 'hardware_cost', 'machine_cost', 'labor_cost', 'total_cost', 'unit_cost', 'consumption', 'note', 'occurred_at'];

function pick(obj, fields) {
  const o = {};
  for (const f of fields) if (obj && obj[f] !== undefined) o[f] = obj[f];
  return o;
}

function emptyState() {
  const s = {};
  for (const t of TABLES) s[t] = new Map();
  return s;
}

const stamp = (ctx, cur) => ({ created_at: (cur && cur.created_at) || ctx.now, updated_at: ctx.now });

function recomputeSpool(V, spoolId) {
  const s = V.spools.get(spoolId);
  if (!s) return;
  V.spools.set(spoolId, { ...s, cost_per_g: roundDb(spoolCpg(s), 6), remaining_weight_g: computeSpoolRemaining(s, valuesOf(V.spool_movements)) });
}

function recomputeLot(V, lotId) {
  const l = V.production_stock.get(lotId);
  if (!l) return;
  V.production_stock.set(lotId, { ...l, qty_available: computeLotAvailable(l, valuesOf(V.sale_allocations), valuesOf(V.stock_adjustments)) });
}

function setNull(V, table, field, id) {
  for (const r of V[table].values()) if (r[field] === id) V[table].set(r.id, { ...r, [field]: null });
}

/* ---------- les actions : validation + effet (identiques à la base) ---------- */
const OPS = {
  'settings.save': {
    label: () => 'Réglages',
    keys: (p, ctx) => [`settings:${ctx.userId}`],
    apply(V, p, ctx) {
      const cur = firstRow(V.settings);
      const owner = (cur && cur.owner_id) || ctx.userId;
      const row = { ...DEFAULT_SETTINGS, ...(cur || {}), ...pick(p, SETTINGS_FIELDS), owner_id: owner, ...stamp(ctx, cur) };
      V.settings = new Map([[owner, row]]);
    },
  },

  'machine.save': {
    label: (p) => `Machine « ${p.name} »`,
    keys: (p) => [`machines:${p.id}`],
    validate(V, p) {
      if (!String(p.name || '').trim()) return new OpError('P3D09', 'Donne un nom à la machine.');
      return null;
    },
    apply(V, p, ctx) {
      const cur = V.machines.get(p.id);
      const row = { is_default: false, archived: false, model: null, ...(cur || {}), ...pick(p, MACHINE_FIELDS), owner_id: ctx.userId, ...stamp(ctx, cur) };
      if (row.is_default) {
        for (const m of V.machines.values()) if (m.id !== row.id && m.is_default) V.machines.set(m.id, { ...m, is_default: false });
      }
      V.machines.set(row.id, row);
    },
  },

  'machine.delete': {
    label: () => 'Suppression de machine',
    keys: () => [],
    apply(V, p) {
      V.machines.delete(p.id);
      setNull(V, 'templates', 'machine_id', p.id);
      setNull(V, 'productions', 'machine_id', p.id);
    },
  },

  'spool.save': {
    label: (p) => `Bobine ${[p.brand, p.material, p.color_name].filter(Boolean).join(' ')}`,
    keys: (p) => [`spools:${p.id}`],
    validate(V, p) {
      if (!(toNum(p.initial_weight_g) > 0)) return new OpError('P3D09', 'Le poids initial doit être supérieur à 0.');
      if (toNum(p.price) < 0) return new OpError('P3D09', 'Le prix ne peut pas être négatif.');
      return null;
    },
    apply(V, p, ctx) {
      const cur = V.spools.get(p.id);
      const row = { brand: '', color_name: '', tare_g: null, purchased_at: null, notes: null, archived: false, remaining_weight_g: 0, ...(cur || {}), ...pick(p, SPOOL_FIELDS), owner_id: ctx.userId, ...stamp(ctx, cur) };
      row.color_hex = safeHex(row.color_hex, '#FFFFFF');
      V.spools.set(row.id, row);
      recomputeSpool(V, row.id);
    },
  },

  'spool.delete': {
    label: () => 'Suppression de bobine',
    keys: () => [],
    validate(V, p) {
      if (valuesOf(V.spool_movements).some((m) => m.spool_id === p.id)) return new OpError('23503', 'Cette bobine a un historique : archive-la plutôt que de la supprimer.');
      return null;
    },
    apply(V, p) {
      V.spools.delete(p.id);
    },
  },

  'spool.weigh': {
    label: () => 'Pesée de bobine',
    keys: (p) => [`spools:${p.spool_id}`, `spool_movements:${p.id}`],
    done: (S, p) => S.spool_movements.has(p.id),
    validate(V, p) {
      if (!V.spools.has(p.spool_id)) return new OpError('23503', 'Bobine introuvable.');
      if (!(toNum(p.measured_g, -1) >= 0)) return new OpError('P3D09', 'Poids mesuré invalide.');
      return null;
    },
    apply(V, p, ctx) {
      V.spool_movements.set(p.id, {
        id: p.id, owner_id: ctx.userId, spool_id: p.spool_id, production_id: null, kind: 'weigh', delta_g: 0,
        measured_g: roundDb(p.measured_g, 2), note: p.note || null, occurred_at: p.occurred_at || ctx.now, created_at: ctx.now, updated_at: ctx.now,
      });
      recomputeSpool(V, p.spool_id);
    },
  },

  'template.save': {
    label: (p) => `Template « ${p.name} »`,
    keys: (p) => [`templates:${p.id}`],
    validate(V, p) {
      if (!String(p.name || '').trim()) return new OpError('P3D09', 'Donne un nom au template.');
      return null;
    },
    apply(V, p, ctx) {
      const cur = V.templates.get(p.id);
      const row = {
        description: null, photo: null, machine_id: null, pieces_per_print: 1, materials: [], purge_g: 0, hardware_cost: 0, print_time_min: 0, labor_min: 0,
        pricing_mode: null, price_coef: null, target_margin_pct: null, catalog_price: null, archived: false,
        ...(cur || {}), ...pick(p, TEMPLATE_FIELDS), owner_id: ctx.userId, ...stamp(ctx, cur),
      };
      V.templates.set(row.id, row);
    },
  },

  'template.delete': {
    label: () => 'Suppression de template',
    keys: () => [],
    apply(V, p) {
      V.templates.delete(p.id);
      setNull(V, 'productions', 'template_id', p.id);
      setNull(V, 'production_stock', 'template_id', p.id);
      setNull(V, 'sale_items', 'template_id', p.id);
    },
  },

  'production.launch': {
    label: (p) => `${p.kind === 'failure' ? 'Print raté' : 'Production'} · ${p.item_name}`,
    keys: (p) => [`productions:${p.id}`, ...(p.lot_id ? [`production_stock:${p.lot_id}`] : []), ...(p.consumption || []).filter((c) => c.spool_id).map((c) => `spools:${c.spool_id}`)],
    done: (S, p) => S.productions.has(p.id),
    validate(V, p) {
      if (!(Math.round(toNum(p.quantity)) >= 1)) return new OpError('P3D09', 'Quantité invalide.');
      for (const c of p.consumption || []) {
        if (c.spool_id && !V.spools.has(c.spool_id)) return new OpError('23503', 'Une des bobines choisies a été supprimée.');
        if (toNum(c.grams) < 0) return new OpError('P3D09', 'Consommation négative refusée.');
      }
      return null;
    },
    apply(V, p, ctx) {
      V.productions.set(p.id, { ...pick(p, PRODUCTION_FIELDS), owner_id: ctx.userId, created_at: ctx.now, updated_at: ctx.now });
      for (const c of p.consumption || []) {
        if (!c.spool_id || !(toNum(c.grams) > 0)) continue;
        const mid = c.movement_id || uuid();
        V.spool_movements.set(mid, {
          id: mid, owner_id: ctx.userId, spool_id: c.spool_id, production_id: p.id, kind: p.kind, delta_g: -roundDb(c.grams, 2),
          measured_g: null, note: null, occurred_at: p.occurred_at, created_at: ctx.now, updated_at: ctx.now,
        });
        recomputeSpool(V, c.spool_id);
      }
      if (p.kind === 'production') {
        const lotId = p.lot_id || uuid();
        V.production_stock.set(lotId, {
          id: lotId, owner_id: ctx.userId, production_id: p.id, template_id: p.template_id || null, item_name: String(p.item_name).trim(),
          unit_cost: toNum(p.unit_cost), quantity: Math.round(toNum(p.quantity)), qty_available: Math.round(toNum(p.quantity)), note: null,
          occurred_at: p.occurred_at, created_at: ctx.now, updated_at: ctx.now,
        });
        recomputeLot(V, lotId);
      }
    },
  },

  'production.delete': {
    label: () => 'Annulation de production',
    keys: () => [],
    validate(V, p) {
      const lots = valuesOf(V.production_stock).filter((l) => l.production_id === p.id).map((l) => l.id);
      if (valuesOf(V.sale_allocations).some((a) => lots.includes(a.lot_id))) {
        return new OpError('P3D02', "Des pièces de cette production ont déjà été vendues : supprime d'abord les ventes concernées.");
      }
      return null;
    },
    apply(V, p) {
      V.productions.delete(p.id);
      const spools = new Set();
      for (const m of valuesOf(V.spool_movements)) {
        if (m.production_id === p.id) {
          V.spool_movements.delete(m.id);
          spools.add(m.spool_id);
        }
      }
      for (const l of valuesOf(V.production_stock)) {
        if (l.production_id !== p.id) continue;
        V.production_stock.delete(l.id);
        for (const a of valuesOf(V.stock_adjustments)) if (a.lot_id === l.id) V.stock_adjustments.delete(a.id);
      }
      for (const id of spools) recomputeSpool(V, id);
    },
  },

  'stock.add': {
    label: (p) => `Stock ajouté · ${p.item_name}`,
    keys: (p) => [`production_stock:${p.id}`],
    done: (S, p) => S.production_stock.has(p.id),
    validate(V, p) {
      if (!(Math.round(toNum(p.quantity)) >= 1)) return new OpError('P3D09', 'Quantité invalide.');
      if (!String(p.item_name || '').trim()) return new OpError('P3D09', 'Nom de pièce manquant.');
      return null;
    },
    apply(V, p, ctx) {
      V.production_stock.set(p.id, {
        id: p.id, owner_id: ctx.userId, production_id: null, template_id: p.template_id || null, item_name: String(p.item_name).trim(),
        unit_cost: toNum(p.unit_cost), quantity: Math.round(toNum(p.quantity)), qty_available: Math.round(toNum(p.quantity)), note: p.note || null,
        occurred_at: p.occurred_at || ctx.now, created_at: ctx.now, updated_at: ctx.now,
      });
      recomputeLot(V, p.id);
    },
  },

  'stock.adjust': {
    label: (p) => `Retrait du stock · ${p.item_name}`,
    keys: () => [],
    done: (S, p) => valuesOf(S.stock_adjustments).some((a) => a.group_id === p.id),
    validate(V, p) {
      if (!(Math.round(toNum(p.quantity)) >= 1)) return new OpError('P3D09', 'Quantité à retirer invalide.');
      const [r] = simulateFifo(V, [{ template_id: p.template_id, item_name: p.item_name, quantity: p.quantity }]);
      if (r.shortage > 0) return new OpError('P3D01', `Stock insuffisant pour « ${p.item_name} » : il manque ${r.shortage} pièce(s).`);
      return null;
    },
    apply(V, p, ctx) {
      const [r] = simulateFifo(V, [{ template_id: p.template_id, item_name: p.item_name, quantity: p.quantity }]);
      for (const a of r.allocations) {
        const id = uuid();
        V.stock_adjustments.set(id, {
          id, owner_id: ctx.userId, group_id: p.id, lot_id: a.lot.id, quantity: a.quantity, reason: p.reason || 'casse', unit_cost: a.unit_cost,
          note: p.note || null, occurred_at: p.occurred_at || ctx.now, created_at: ctx.now, updated_at: ctx.now,
        });
        recomputeLot(V, a.lot.id);
      }
    },
  },

  'sale.record': {
    label: (p) => `Vente · ${(p.items || [])[0] ? p.items[0].item_name : ''}`,
    keys: (p) => [`sales:${p.id}`],
    done: (S, p) => S.sales.has(p.id),
    validate(V, p) {
      if (!Array.isArray(p.items) || !p.items.length) return new OpError('P3D09', 'Une vente doit contenir au moins un article.');
      for (const i of p.items) {
        if (!(Math.round(toNum(i.quantity)) >= 1)) return new OpError('P3D09', 'Quantité invalide.');
        if (toNum(i.unit_price) < 0) return new OpError('P3D09', 'Prix invalide.');
      }
      const reqs = p.items.filter((i) => i.from_stock !== false);
      const res = simulateFifo(V, reqs);
      const k = res.findIndex((r) => r.shortage > 0);
      if (k >= 0) return new OpError('P3D01', `Stock insuffisant pour « ${reqs[k].item_name} » : il manque ${res[k].shortage} pièce(s).`);
      return null;
    },
    apply(V, p, ctx) {
      const reqs = p.items.filter((i) => i.from_stock !== false);
      const fifo = simulateFifo(V, reqs);
      let fi = 0;
      let amount = 0;
      let cogs = 0;
      const lots = new Set();
      p.items.forEach((i, pos) => {
        const qty = Math.round(toNum(i.quantity));
        amount += qty * toNum(i.unit_price);
        let itemCogs = 0;
        if (i.from_stock !== false) {
          const f = fifo[fi++];
          for (const a of f.allocations) {
            const aid = uuid();
            V.sale_allocations.set(aid, { id: aid, owner_id: ctx.userId, sale_item_id: i.id, lot_id: a.lot.id, quantity: a.quantity, unit_cost: a.unit_cost, created_at: ctx.now, updated_at: ctx.now });
            itemCogs += a.quantity * a.unit_cost;
            lots.add(a.lot.id);
          }
        } else {
          itemCogs = qty * toNum(i.unit_cost);
        }
        V.sale_items.set(i.id, {
          id: i.id, owner_id: ctx.userId, sale_id: p.id, template_id: i.template_id || null, item_name: String(i.item_name).trim(), quantity: qty,
          unit_price: toNum(i.unit_price), from_stock: i.from_stock !== false, unit_cost: roundDb(itemCogs / qty, 4), cogs: roundDb(itemCogs, 4),
          position: pos, created_at: ctx.now, updated_at: ctx.now,
        });
        cogs += itemCogs;
      });
      const sale = {
        id: p.id, owner_id: ctx.userId, channel: p.channel || 'direct', customer: p.customer || null, note: p.note || null,
        amount: roundDb(amount + toNum(p.shipping_charged), 2), shipping_charged: toNum(p.shipping_charged), shipping_cost: toNum(p.shipping_cost),
        packaging_cost: toNum(p.packaging_cost), platform_fee: toNum(p.platform_fee), cogs: roundDb(cogs, 4),
        occurred_at: p.occurred_at || ctx.now, created_at: ctx.now, updated_at: ctx.now,
      };
      sale.net_margin = roundDb(sale.amount - sale.cogs - sale.shipping_cost - sale.packaging_cost - sale.platform_fee, 4);
      V.sales.set(p.id, sale);
      for (const id of lots) recomputeLot(V, id);
    },
  },

  'sale.delete': {
    label: () => 'Annulation de vente',
    keys: () => [],
    apply(V, p) {
      V.sales.delete(p.id);
      const lots = new Set();
      for (const i of valuesOf(V.sale_items)) {
        if (i.sale_id !== p.id) continue;
        V.sale_items.delete(i.id);
        for (const a of valuesOf(V.sale_allocations)) {
          if (a.sale_item_id === i.id) {
            V.sale_allocations.delete(a.id);
            lots.add(a.lot_id);
          }
        }
      }
      for (const id of lots) recomputeLot(V, id);
    },
  },
};

function opLabel(op) {
  const def = OPS[op.type];
  try {
    return def ? def.label(op.payload) : op.type;
  } catch {
    return op.type;
  }
}

function cloneState(S) {
  const V = {};
  for (const t of TABLES) V[t] = new Map(S[t]);
  return V;
}

function buildView(S, Q, ctx) {
  const V = cloneState(S);
  V.userId = ctx.userId;
  V.pending = new Set();
  V.failedOps = [];
  V.pendingCount = 0;
  for (const op of Q) {
    const def = OPS[op.type];
    if (!def) continue;
    if (op.status === 'failed') {
      V.failedOps.push(op);
      continue;
    }
    V.pendingCount++;
    try {
      if (def.done && def.done(S, op.payload)) continue;
      def.apply(V, op.payload, ctx);
      for (const k of def.keys(op.payload, ctx)) V.pending.add(k);
    } catch (e) {
      console.warn('[paulo3d] action locale impossible à rejouer', op.type, e);
    }
  }
  return V;
}

/* ---------- stockage sur l'appareil (IndexedDB) ---------- */
const IDB = {
  open(name) {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) return reject(new Error('IndexedDB indisponible'));
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB bloquée'));
    });
  },
  run(db, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', mode);
      const store = tx.objectStore('kv');
      let result;
      Promise.resolve(fn(store)).then((r) => { result = r; });
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction annulée'));
    });
  },
  get(db, key) {
    return new Promise((resolve, reject) => {
      const req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  setMany(db, entries) {
    return IDB.run(db, 'readwrite', (store) => {
      for (const [k, v] of entries) store.put(v, k);
    });
  },
  clearAll(name) {
    return new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  },
};

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('paulo3d') : null;

const Store = {
  db: null,
  dbName: null,
  volatile: false,
  userId: null,
  S: emptyState(),
  Q: [],
  V: buildView(emptyState(), [], { userId: null, now: new Date().toISOString() }),
  meta: { lastPull: {}, lastReconcile: 0 },
  listeners: new Set(),
  dirty: new Set(),
  tombstones: new Map(),
  rev: 0,
  lastSig: null,

  async open(scope, userId) {
    this.close();
    this.userId = userId;
    this.dbName = `paulo3d:${scope}`;
    this.S = emptyState();
    this.Q = [];
    this.meta = { lastPull: {}, lastReconcile: 0 };
    try {
      this.db = await IDB.open(this.dbName);
      this.volatile = false;
      for (const t of TABLES) {
        const rows = await IDB.get(this.db, `snap:${t}`);
        if (Array.isArray(rows)) for (const r of rows) this.S[t].set(r[PK(t)], r);
      }
      const q = await IDB.get(this.db, 'outbox');
      this.Q = Array.isArray(q) ? q.map((op) => (op.status === 'sending' ? { ...op, status: 'pending' } : op)) : [];
      this.meta = { ...this.meta, ...((await IDB.get(this.db, 'meta')) || {}) };
    } catch (e) {
      console.warn('[paulo3d] stockage local indisponible', e);
      this.db = null;
      this.volatile = true;
    }
    this.rebuild(true);
  },

  close() {
    try {
      if (this.db) this.db.close();
    } catch { /* déjà fermée */ }
    this.db = null;
  },

  ctx() {
    return { userId: this.userId, now: new Date().toISOString() };
  },

  // Recalcule l'affichage seulement si les données ou la file d'envoi ont changé
  rebuild(force = false) {
    const sig = `${this.userId}|${this.rev}|${this.Q.map((o) => `${o.id}:${o.status === 'failed' ? 'f' : 'p'}`).join(',')}`;
    if (!force && sig === this.lastSig) return;
    this.lastSig = sig;
    this.V = buildView(this.S, this.Q, this.ctx());
    for (const fn of this.listeners) {
      try {
        fn(this.V);
      } catch (e) {
        console.error(e);
      }
    }
  },

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },

  // Écrit la file d'envoi. Renvoie false si l'appareil n'a pas pu la garder.
  async persistQueue() {
    if (!this.db) return this.volatile;
    try {
      await IDB.setMany(this.db, [['outbox', this.Q]]);
      if (channel) channel.postMessage({ type: 'outbox', db: this.dbName });
      return true;
    } catch (e) {
      console.error('[paulo3d] file d’envoi non enregistrée', e);
      return false;
    }
  },

  async reloadQueue() {
    if (!this.db) return;
    const q = await IDB.get(this.db, 'outbox');
    if (Array.isArray(q)) this.Q = q;
  },

  async persistSnapshotNow() {
    if (!this.db || !this.dirty.size) return;
    const entries = [...this.dirty].map((t) => [`snap:${t}`, valuesOf(this.S[t])]);
    this.dirty.clear();
    entries.push(['meta', this.meta]);
    try {
      await IDB.setMany(this.db, entries);
    } catch (e) {
      console.warn('[paulo3d] copie locale non enregistrée', e);
    }
  },

  persistSnapshot: null,

  upsertRows(table, rows) {
    if (!rows || !rows.length || !this.S[table]) return;
    const map = this.S[table];
    const pk = PK(table);
    let changed = 0;
    for (const r of rows) {
      if (!r || r[pk] === undefined) continue;
      const key = `${table}:${r[pk]}`;
      const cur = map.get(r[pk]);
      if (cur && cur.updated_at && r.updated_at && time(r.updated_at) < time(cur.updated_at)) continue;
      if (cur && cur.updated_at && r.updated_at && time(r.updated_at) === time(cur.updated_at)) continue;
      const dead = this.tombstones.get(key);
      if (dead && (!r.updated_at || time(r.updated_at) <= dead)) continue;
      map.set(r[pk], r);
      changed++;
    }
    if (changed) {
      this.dirty.add(table);
      this.rev++;
    }
  },

  deleteIds(table, ids) {
    if (!ids || !ids.length || !this.S[table]) return;
    const now = Date.now();
    let removed = 0;
    for (const id of ids) {
      if (this.S[table].delete(id)) removed++;
      this.tombstones.set(`${table}:${id}`, now);
    }
    if (removed) {
      this.dirty.add(table);
      this.rev++;
    }
    if (this.tombstones.size > 2000) {
      for (const [k, t] of this.tombstones) if (now - t > 3600000) this.tombstones.delete(k);
    }
  },

  // Supprime localement les lignes que la base n'a plus (hors lignes trop récentes)
  reconcile(table, serverIds, startedAt) {
    const map = this.S[table];
    const removed = [];
    for (const [id, row] of map) {
      if (serverIds.has(id)) continue;
      if (row.updated_at && time(row.updated_at) > startedAt - 120000) continue;
      removed.push(id);
    }
    if (removed.length) this.deleteIds(table, removed);
    return removed.length;
  },

  mergeBundle(bundle) {
    if (!bundle) return;
    for (const t of TABLES) if (Array.isArray(bundle[t])) this.upsertRows(t, bundle[t]);
    if (bundle.deleted) for (const [t, ids] of Object.entries(bundle.deleted)) if (TABLES.includes(t)) this.deleteIds(t, ids || []);
  },
};

Store.persistSnapshot = debounce(() => Store.persistSnapshotNow(), 400);
