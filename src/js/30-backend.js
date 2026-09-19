/* =============================================================================
   Liaison avec la base
   - SupabaseBackend : la vraie base (PostgREST + Auth + Realtime)
   - DemoBackend     : mode démo, tout reste sur cet appareil (rien n'est envoyé)
   ============================================================================= */

const PAGE = 1000;
const REQUEST_TIMEOUT_MS = 30000;

// Requête bloquée (réseau d'atelier instable, 4G faible) : abandon après 30 s SANS RIEN RECEVOIR.
// Elle est alors traitée comme une coupure (l'action reste en attente et repart plus tard) au lieu
// de bloquer l'envoi de toutes les actions pendant plusieurs minutes.
// ⚠️ Délai d'INACTIVITÉ, pas délai total : le compteur repart à chaque morceau reçu. Un délai total
// coupait à 30 s un téléchargement qui AVANÇAIT (première synchro d'un appareil : des Mo de
// modèles avec photos sur une 4G faible) — « Hors-ligne », et le même téléchargement recommencé
// sans fin. Un téléchargement BLOQUÉ à mi-chemin est toujours abandonné.
async function fetchWithTimeout(input, init = {}) {
  if (init.signal || typeof AbortController === 'undefined') return fetch(input, init);
  const ctrl = new AbortController();
  let timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  const relancer = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS); };
  try {
    const res = await fetch(input, { ...init, signal: ctrl.signal });
    let body = null;
    if (![101, 204, 205, 304].includes(res.status)) {
      if (res.body && typeof res.body.getReader === 'function') {
        const lecteur = res.body.getReader();
        const morceaux = [];
        let total = 0;
        for (;;) {
          const { done, value } = await lecteur.read();
          if (done) break;
          morceaux.push(value);
          total += value.byteLength;
          relancer();
        }
        body = new Uint8Array(total);
        let pos = 0;
        for (const m of morceaux) { body.set(m, pos); pos += m.byteLength; }
      } else {
        body = await res.arrayBuffer();
      }
    }
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  } finally {
    clearTimeout(timer);
  }
}

function wrapError(error, status) {
  const e = new Error(error && error.message ? error.message : 'Erreur inconnue');
  e.code = error && error.code ? error.code : '';
  e.status = status === undefined ? (error && error.status) || 0 : status;
  e.details = error && error.details;
  e.hint = error && error.hint;
  return e;
}

const AUTH_CODES = ['42501', 'PGRST301', 'PGRST302', 'PGRST303'];

// Classe une erreur. Le texte du message n'est JAMAIS utilisé quand la base a répondu :
// un refus « Stock insuffisant pour « Boîtier de connexion » » reste un refus, pas une coupure.
function classifyError(e) {
  if (e instanceof OpError) return 'business';
  const status = toNum(e && e.status, 0);
  const code = String((e && e.code) || '');
  if (e && e.name === 'AbortError') return 'network';
  if (!status) return 'network';
  // double authentification activée, session sans le code (mot de passe seul) : demander le code
  if (e && e.hint === 'P3D2F') return 'mfa';
  if (status === 401 || AUTH_CODES.includes(code)) return 'auth';
  if (code === 'PGRST202' || code === 'PGRST205' || code === '42P01' || code === '42883' || code === 'PGRST204') return 'schema';
  if (status >= 500 || status === 408 || status === 429 || code === '57014') return 'network';
  return 'business';
}

// Messages écrits par la BASE (supabase/schema.sql, en français) : repris ici pour être traduits avec
// le reste de l'appli sur un site dans une autre langue. Un message inconnu reste tel quel.
const DB_MESSAGES = [
  [/^Stock insuffisant pour « (.*) » : il manque (\d+) pièces?\.$/, (m) => `Stock insuffisant pour « ${m[1]} » : il manque ${plural(+m[2], 'pièce', 'pièces')}.`],
  [/^Cet élément a été supprimé sur un autre appareil\.$/, () => 'Cet élément a été supprimé sur un autre appareil.'],
  [/^Cette commande est annulée/, () => 'Cette commande est annulée : remets-la « à faire » avant de la livrer.'],
  [/^Cette commande est déjà livrée/, () => 'Cette commande est déjà livrée (vente déjà enregistrée, peut-être sur un autre appareil).'],
  [/^Code de double authentification requis\.$/, () => 'Code de double authentification requis.'],
  [/^Consommation négative refusée\.$/, () => 'Consommation négative refusée.'],
  [/^Des pièces de cette production ont déjà été vendues/, () => "Des pièces de cette production ont déjà été vendues : supprime d'abord les ventes concernées."],
  [/^Identifiant de production manquant\.$/, () => 'Identifiant de production manquant.'],
  [/^Identifiant de retrait manquant\.$/, () => 'Identifiant de retrait manquant.'],
  [/^Identifiant de vente manquant\.$/, () => 'Identifiant de vente manquant.'],
  [/^Poids pesé supérieur au poids initial/, () => 'Poids pesé supérieur au poids initial de la bobine : as-tu retiré le poids de la bobine vide ? Sinon, corrige le poids initial de la bobine.'],
  [/^Quantité à retirer invalide\.$/, () => 'Quantité à retirer invalide.'],
  [/^Session expirée : reconnecte-toi\.$/, () => 'Session expirée : reconnecte-toi.'],
  [/^Une vente doit contenir au moins un article\.$/, () => 'Une vente doit contenir au moins un article.'],
];
function dbMessage(msg) {
  const s = String(msg || '');
  for (const [re, fn] of DB_MESSAGES) {
    const m = re.exec(s);
    if (m) return fn(m);
  }
  return s;
}

function friendlyError(e, op) {
  const code = String((e && e.code) || '');
  if (/^P3D/.test(code)) return dbMessage(e.message);
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
  return (e && e.message && dbMessage(e.message)) || 'Erreur inconnue.';
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

// La base n'a modifié AUCUNE ligne : la ligne n'existe plus (supprimée sur un autre appareil, ou jamais
// créée parce que sa création a été refusée). Ce n'est pas un succès : l'action est refusée, avec la raison.
function nothingSaved(rows, what, deleted) {
  if (Array.isArray(rows) && rows.length) return rows;
  throw new OpError('P3D10', `${what} n'existe plus (${deleted} sur un autre appareil ?) : modification non enregistrée.`);
}

const REMOTE = {
  async 'settings.init'(b, p) {
    const row = { owner_id: b.userId, ...pick(p, SETTINGS_FIELDS) };
    await b.exec(b.sb.from('settings').upsert(row, { onConflict: 'owner_id', ignoreDuplicates: true }));
    return { settings: await b.exec(b.sb.from('settings').select('*')) };
  },
  async 'settings.save'(b, p) {
    const row = { owner_id: b.userId, ...pick(p, SETTINGS_FIELDS) };
    return { settings: await b.exec(b.sb.from('settings').upsert(row, { onConflict: 'owner_id' }).select()) };
  },
  async 'spool.patch'(b, p) {
    const fields = pick(p.fields || {}, SPOOL_FIELDS.filter((f) => f !== 'id'));
    return { spools: nothingSaved(await b.exec(b.sb.from('spools').update(fields).eq('id', p.id).select()), 'Cette bobine', 'supprimée') };
  },
  async 'template.patch'(b, p) {
    const fields = pick(p.fields || {}, TEMPLATE_FIELDS.filter((f) => f !== 'id'));
    return { templates: nothingSaved(await b.exec(b.sb.from('templates').update(fields).eq('id', p.id).select()), 'Ce template', 'supprimé') };
  },
  async 'machine.save'(b, p) {
    const rows = nothingSaved(await b.exec(b.sb.from('machines').upsert(pick(p, MACHINE_FIELDS), { onConflict: 'id' }).select()), 'Cette machine', 'supprimée');
    const out = { machines: rows };
    if (p.is_default) out.machines = await b.pullTable('machines');
    return out;
  },
  async 'machine.delete'(b, p) {
    const rows = await b.exec(b.sb.from('machines').delete().eq('id', p.id).select('id'));
    return { deleted: { machines: rows.map((r) => r.id) }, pullAfter: true };
  },
  async 'spool.save'(b, p) {
    return { spools: nothingSaved(await b.exec(b.sb.from('spools').upsert(pick(p, SPOOL_FIELDS), { onConflict: 'id' }).select()), 'Cette bobine', 'supprimée') };
  },
  async 'spool.delete'(b, p) {
    const rows = await b.exec(b.sb.from('spools').delete().eq('id', p.id).select('id'));
    return { deleted: { spools: rows.map((r) => r.id) } };
  },
  async 'spool.weigh'(b, p) {
    return b.exec(b.sb.rpc('p3d_weigh_spool', { p }));
  },
  async 'template.save'(b, p) {
    return { templates: nothingSaved(await b.exec(b.sb.from('templates').upsert(pick(p, TEMPLATE_FIELDS), { onConflict: 'id' }).select()), 'Ce template', 'supprimé') };
  },
  async 'template.delete'(b, p) {
    const rows = await b.exec(b.sb.from('templates').delete().eq('id', p.id).select('id'));
    return { deleted: { templates: rows.map((r) => r.id) }, pullAfter: true };
  },
  async 'order.save'(b, p) {
    return { orders: nothingSaved(await b.exec(b.sb.from('orders').upsert(pick(p, ORDER_FIELDS), { onConflict: 'id' }).select()), 'Cette commande', 'supprimée') };
  },
  async 'order.patch'(b, p) {
    const fields = pick(p.fields || {}, ORDER_FIELDS.filter((f) => f !== 'id' && f !== 'sale_id'));
    let q = b.sb.from('orders').update(fields).eq('id', p.id);
    if (Array.isArray(p.from)) q = q.in('status', p.from);
    const rows = await b.exec(q.select());
    if (rows.length) return { orders: rows };
    // condition d'état non remplie (commande livrée ou annulée ailleurs entre-temps) : rien n'est
    // écrasé, l'appareil reprend simplement l'état de la base
    if (Array.isArray(p.from)) {
      const cur = await b.exec(b.sb.from('orders').select().eq('id', p.id));
      if (cur.length) return { orders: cur };
    }
    return { orders: nothingSaved(rows, 'Cette commande', 'supprimée') };
  },
  async 'order.delete'(b, p) {
    const rows = await b.exec(b.sb.from('orders').delete().eq('id', p.id).select('id'));
    return { deleted: { orders: rows.map((r) => r.id) } };
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
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: `${SITE.prefix}-auth-${this.ref}` },
      realtime: { params: { eventsPerSecond: 20 } },
      global: { headers: { 'x-client-info': `${SITE.id}/${APP_VERSION}` }, fetch: fetchWithTimeout },
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

  // Lecture des changements depuis la dernière fois. S'il y en a trop pour une page,
  // relecture complète par identifiant (une page ne peut alors ni sauter ni doubler une ligne).
  async pullTable(table, since) {
    if (since) {
      let res;
      try {
        res = await this.sb.from(table).select('*', { count: 'exact' })
          .gt('updated_at', new Date(time(since) - 300000).toISOString())
          .order('updated_at', { ascending: true }).limit(PAGE);
      } catch (e) {
        throw wrapError({ message: e && e.message ? e.message : String(e) }, 0);
      }
      if (res.error) throw wrapError(res.error, res.status);
      const rows = res.data || [];
      if (res.count === null || res.count === undefined || res.count <= rows.length) return rows;
    }
    return this.pullAllById(table, '*');
  }

  // Pagination par identifiant croissant : stable même si des lignes changent pendant la lecture,
  // et correcte même si le projet limite les réponses à moins de 1000 lignes (on lit jusqu'à une page vide)
  async pullAllById(table, columns) {
    const pk = PK(table);
    const out = [];
    let last = null;
    for (;;) {
      let q = this.sb.from(table).select(columns).order(pk, { ascending: true }).limit(PAGE);
      if (last !== null) q = q.gt(pk, last);
      const rows = await this.exec(q);
      if (!rows.length) break;
      out.push(...rows);
      last = rows[rows.length - 1][pk];
    }
    return out;
  }

  async pullIds(table) {
    const pk = PK(table);
    return new Set((await this.pullAllById(table, pk)).map((r) => r[pk]));
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
      .channel(`${SITE.prefix}-${this.userId}`)
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
      this.db = await IDB.open(`${SITE.id}:demo-server`);
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
