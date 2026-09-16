/* =============================================================================
   Liaison avec la base
   - SupabaseBackend : la vraie base (PostgREST + Auth + Realtime)
   - DemoBackend     : mode démo, tout reste sur cet appareil (rien n'est envoyé)
   ============================================================================= */

const PAGE = 1000;

function wrapError(error, status) {
  const e = new Error(error && error.message ? error.message : 'Erreur inconnue');
  e.code = error && error.code ? error.code : '';
  e.status = status === undefined ? (error && error.status) || 0 : status;
  e.details = error && error.details;
  e.hint = error && error.hint;
  return e;
}

function classifyError(e) {
  if (e instanceof OpError) return 'business';
  const status = toNum(e && e.status, 0);
  const code = String((e && e.code) || '');
  const msg = String((e && e.message) || '');
  if (e && e.name === 'AbortError') return 'network';
  if (status === 0 || /failed to fetch|networkerror|load failed|network request failed|fetch failed|timed? ?out|aborted|connexion/i.test(msg)) return 'network';
  if (status === 401 || code === '42501' || code === 'PGRST301' || code === 'PGRST302' || code === 'PGRST303' || /jwt|token is expired/i.test(msg)) return 'auth';
  if (code === 'PGRST202' || code === 'PGRST205' || code === '42P01' || code === '42883' || code === 'PGRST204') return 'schema';
  if (status >= 500 || status === 408 || status === 429 || code === '57014') return 'network';
  return 'business';
}

function friendlyError(e, op) {
  const code = String((e && e.code) || '');
  if (/^P3D/.test(code)) return e.message;
  if (code === '23503') {
    return op && /\.delete$/.test(op.type)
      ? "Impossible de supprimer : cet élément est utilisé dans l'historique. Archive-le plutôt."
      : 'Un élément lié a été supprimé entre-temps (bobine, template…).';
  }
  if (code === '23514') return 'La base a refusé une valeur (nombre négatif, stock insuffisant ou texte trop long).';
  if (code === '23505') return 'Cet élément existe déjà.';
  if (code === '22P02' || code === '22003') return 'Une valeur a un format invalide.';
  if (code === '42501') return 'Accès refusé : reconnecte-toi.';
  if (classifyError(e) === 'schema') return "La base n'est pas à jour : relance le script SQL dans Supabase.";
  return (e && e.message) || 'Erreur inconnue.';
}

function projectRefFromUrl(url) {
  try {
    const u = new URL(url);
    const m = u.hostname.match(/^([a-z0-9]{10,40})\.supabase\.(co|in|net)$/i);
    if (m) return m[1].toLowerCase();
    let h = 0;
    for (const c of `${u.origin}${u.pathname}`) h = (h * 31 + c.charCodeAt(0)) | 0;
    return `h${(h >>> 0).toString(36)}`;
  } catch {
    return 'invalide';
  }
}

function normalizeSupaUrl(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (/^[a-z0-9]{20}$/i.test(s)) s = `https://${s}.supabase.co`;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
    if (u.protocol !== 'https:' && !local) return '';
    return `${u.origin}${u.pathname.replace(/\/(rest|auth)\/v1.*$/, '').replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

const REMOTE = {
  async 'settings.save'(b, p) {
    const row = { owner_id: b.userId, ...pick(p, SETTINGS_FIELDS) };
    return { settings: await b.exec(b.sb.from('settings').upsert(row, { onConflict: 'owner_id' }).select()) };
  },
  async 'machine.save'(b, p) {
    const rows = await b.exec(b.sb.from('machines').upsert(pick(p, MACHINE_FIELDS), { onConflict: 'id' }).select());
    const out = { machines: rows };
    if (p.is_default) out.machines = await b.pullTable('machines');
    return out;
  },
  async 'machine.delete'(b, p) {
    const rows = await b.exec(b.sb.from('machines').delete().eq('id', p.id).select('id'));
    return { deleted: { machines: rows.map((r) => r.id) }, pullAfter: true };
  },
  async 'spool.save'(b, p) {
    return { spools: await b.exec(b.sb.from('spools').upsert(pick(p, SPOOL_FIELDS), { onConflict: 'id' }).select()) };
  },
  async 'spool.delete'(b, p) {
    const rows = await b.exec(b.sb.from('spools').delete().eq('id', p.id).select('id'));
    return { deleted: { spools: rows.map((r) => r.id) } };
  },
  async 'spool.weigh'(b, p) {
    return b.exec(b.sb.rpc('p3d_weigh_spool', { p }));
  },
  async 'template.save'(b, p) {
    return { templates: await b.exec(b.sb.from('templates').upsert(pick(p, TEMPLATE_FIELDS), { onConflict: 'id' }).select()) };
  },
  async 'template.delete'(b, p) {
    const rows = await b.exec(b.sb.from('templates').delete().eq('id', p.id).select('id'));
    return { deleted: { templates: rows.map((r) => r.id) }, pullAfter: true };
  },
  async 'production.launch'(b, p) {
    return b.exec(b.sb.rpc('p3d_launch_production', { p }));
  },
  async 'production.delete'(b, p) {
    return b.exec(b.sb.rpc('p3d_delete_production', { p_id: p.id }));
  },
  async 'stock.add'(b, p) {
    return b.exec(b.sb.rpc('p3d_add_stock', { p }));
  },
  async 'stock.adjust'(b, p) {
    return b.exec(b.sb.rpc('p3d_adjust_stock', { p }));
  },
  async 'sale.record'(b, p) {
    return b.exec(b.sb.rpc('p3d_record_sale', { p }));
  },
  async 'sale.delete'(b, p) {
    return b.exec(b.sb.rpc('p3d_delete_sale', { p_id: p.id }));
  },
};

class SupabaseBackend {
  constructor(url, key) {
    this.kind = 'supabase';
    this.url = url;
    this.key = key;
    this.ref = projectRefFromUrl(url);
    this.userId = null;
    this.channel = null;
    this.sb = supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: `p3d-auth-${this.ref}` },
      realtime: { params: { eventsPerSecond: 20 } },
      global: { headers: { 'x-client-info': `paulo3d/${APP_VERSION}` } },
    });
  }

  ready() {
    return !!this.userId;
  }

  async exec(query) {
    let res;
    try {
      res = await query;
    } catch (e) {
      throw wrapError({ message: e && e.message ? e.message : String(e) }, 0);
    }
    if (res.error) throw wrapError(res.error, res.status);
    return res.data;
  }

  async send(op) {
    const fn = REMOTE[op.type];
    if (!fn) throw new OpError('LOCAL', `Action inconnue : ${op.type}`);
    return fn(this, op.payload);
  }

  async pullTable(table, since) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      let q = this.sb.from(table).select('*');
      if (since) q = q.gt('updated_at', new Date(time(since) - 300000).toISOString());
      q = q.order('updated_at', { ascending: true }).order(PK(table), { ascending: true }).range(from, from + PAGE - 1);
      const rows = await this.exec(q);
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out;
  }

  async pullIds(table) {
    const pk = PK(table);
    const ids = new Set();
    for (let from = 0; ; from += PAGE) {
      const rows = await this.exec(this.sb.from(table).select(pk).order(pk, { ascending: true }).range(from, from + PAGE - 1));
      for (const r of rows) ids.add(r[pk]);
      if (rows.length < PAGE) break;
    }
    return ids;
  }

  async checkSchema() {
    const v = await this.exec(this.sb.rpc('p3d_version'));
    return toNum(v, 0);
  }

  async refreshAuth() {
    try {
      const { data, error } = await this.sb.auth.refreshSession();
      if (error) return classifyError(wrapError(error, error.status)) === 'network' ? 'network' : 'invalid';
      return data && data.session ? 'ok' : 'invalid';
    } catch {
      return 'network';
    }
  }

  subscribe(onChange, onStatus) {
    this.unsubscribe();
    if (!this.userId) return;
    this.channel = this.sb
      .channel(`p3d-${this.userId}`)
      .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => onChange(payload))
      .subscribe((status) => onStatus(status));
  }

  unsubscribe() {
    if (this.channel) {
      try {
        this.sb.removeChannel(this.channel);
      } catch { /* déjà fermé */ }
      this.channel = null;
    }
  }
}

/* ---------- mode démo : une « base » locale qui rejoue les mêmes règles ---------- */
class DemoBackend {
  constructor() {
    this.kind = 'demo';
    this.userId = '00000000-0000-4000-8000-00000000d3e0';
    this.ref = 'demo';
    this.S = emptyState();
    this.db = null;
  }

  ready() {
    return true;
  }

  async load() {
    try {
      this.db = await IDB.open('paulo3d:demo-server');
      for (const t of TABLES) {
        const rows = await IDB.get(this.db, `snap:${t}`);
        if (Array.isArray(rows)) for (const r of rows) this.S[t].set(r[PK(t)], r);
      }
    } catch {
      this.db = null;
    }
  }

  async save() {
    if (!this.db) return;
    await IDB.setMany(this.db, TABLES.map((t) => [`snap:${t}`, valuesOf(this.S[t])]));
  }

  offline() {
    return lsGet(LS.demoOffline, false) === true;
  }

  async send(op) {
    if (!this.fast) await sleep(120);
    if (this.offline()) throw wrapError({ message: 'Failed to fetch (démo hors-ligne)' }, 0);
    const def = OPS[op.type];
    if (!def) throw new OpError('LOCAL', `Action inconnue : ${op.type}`);
    if (def.done && def.done(this.S, op.payload)) return {};
    const V = cloneState(this.S);
    const err = def.validate ? def.validate(V, op.payload) : null;
    if (err) throw err;
    def.apply(V, op.payload, { userId: this.userId, now: new Date().toISOString() });
    const bundle = { deleted: {} };
    for (const t of TABLES) {
      const changed = [];
      for (const [id, row] of V[t]) if (this.S[t].get(id) !== row) changed.push(row);
      const removed = [...this.S[t].keys()].filter((id) => !V[t].has(id));
      if (changed.length) bundle[t] = changed;
      if (removed.length) bundle.deleted[t] = removed;
      this.S[t] = V[t];
    }
    await this.save();
    return bundle;
  }

  async pullTable(table, since) {
    await sleep(60);
    if (this.offline()) throw wrapError({ message: 'Failed to fetch (démo hors-ligne)' }, 0);
    return valuesOf(this.S[table]).filter((r) => !since || !r.updated_at || time(r.updated_at) > time(since) - 300000);
  }

  async pullIds(table) {
    if (this.offline()) throw wrapError({ message: 'Failed to fetch (démo hors-ligne)' }, 0);
    return new Set(this.S[table].keys());
  }

  async checkSchema() {
    return SCHEMA_VERSION;
  }

  async refreshAuth() {
    return 'ok';
  }

  subscribe() {}

  unsubscribe() {}

  async reset() {
    this.S = emptyState();
    await this.save();
  }
}
