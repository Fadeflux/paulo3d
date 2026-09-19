/* =============================================================================
   Interface : composants, fenêtres, notifications, navigation
   ============================================================================= */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const TONES = {
  ok: { text: 'text-neon', bg: 'bg-neon/10', border: 'border-neon/30', dot: 'bg-neon' },
  warn: { text: 'text-amber-300', bg: 'bg-amber-400/10', border: 'border-amber-400/30', dot: 'bg-amber-400' },
  bad: { text: 'text-rose-300', bg: 'bg-rose-500/10', border: 'border-rose-500/30', dot: 'bg-rose-500' },
  off: { text: 'text-slate-300', bg: 'bg-slate-500/10', border: 'border-slate-500/30', dot: 'bg-slate-400' },
  info: { text: 'text-cyan-300', bg: 'bg-cyan-400/10', border: 'border-cyan-400/30', dot: 'bg-cyan-400' },
  demo: { text: 'text-violet-300', bg: 'bg-violet-500/10', border: 'border-violet-400/30', dot: 'bg-violet-400' },
};

/* ---------- composants ---------- */
// Attributs supplémentaires : TOUJOURS un objet, valeurs échappées. Ex. { 'data-id': id, autofocus: true }
function attrList(obj) {
  if (!obj) return raw('');
  if (typeof obj !== 'object') throw new Error('attrs doit être un objet { nom: valeur }');
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (!/^[a-z][a-z0-9-]*$/i.test(k)) throw new Error(`nom d'attribut refusé : ${k}`);
    if (v === false || v === null || v === undefined) continue;
    out.push(v === true ? k : `${k}="${esc(v)}"`);
  }
  return raw(out.join(' '));
}

function btn(label, { variant = 'secondary', icon: ic, action, size = 'md', attrs = null, type = 'button', cls = '', title } = {}) {
  const sizes = { sm: 'h-9 px-3 text-[13px] rounded-lg', md: 'h-11 px-4 text-sm rounded-xl', lg: 'h-12 px-5 text-[15px] rounded-xl', icon: 'h-10 w-10 rounded-xl', iconSm: 'h-9 w-9 rounded-xl' };
  return html`<button type="${type}" class="btn btn-${variant} ${sizes[size]} ${cls}" ${action ? raw(`data-action="${esc(action)}"`) : ''} ${title ? raw(`title="${esc(title)}" aria-label="${esc(title)}"`) : ''} ${attrList(attrs)}>${ic ? icon(ic, size === 'sm' ? 'w-4 h-4' : 'w-[18px] h-[18px]') : ''}${label ? html`<span>${label}</span>` : ''}</button>`;
}

function badge(text, tone = 'off', { dot = false, cls = '' } = {}) {
  const t = TONES[tone] || TONES.off;
  return html`<span class="inline-flex items-center gap-1.5 rounded-full border ${t.border} ${t.bg} ${t.text} px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${cls}">${dot ? html`<span class="h-1.5 w-1.5 rounded-full ${t.dot}"></span>` : ''}${text}</span>`;
}

function pendingBadge(V, key) {
  return V.pending.has(key) ? badge('En attente d’envoi', 'warn', { dot: true }) : '';
}

function field(label, control, { hint, cls = '', id } = {}) {
  return html`<label class="block ${cls}" ${id ? raw(`for="${esc(id)}"`) : ''}>
    <span class="label">${label}</span>
    ${control}
    ${hint ? html`<span class="mt-1 block text-[12px] text-slate-500">${hint}</span>` : ''}
  </label>`;
}

function inputNum(name, value, { suffix, placeholder = '0', step = 'any', min, cls = '', attrs = null, inputmode = 'decimal' } = {}) {
  let v = value === null || value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value)) ? '' : String(value).replace('.', ',');
  // Montants en euros : « 22,50 » et non « 22,5 », sans jamais arrondir la valeur. Les nombres entiers
  // (dont 0) restent tels quels : « 0,00 » + une touche tapée au bout donnerait « 0,002 », soit 0.
  if (/^€/.test(suffix || '') && /^-?\d+,\d$/.test(v)) v = `${v}0`;
  return html`<div class="relative ${cls}">
    <input class="input ${suffix ? 'pr-12' : ''} tabular-nums" name="${name}" inputmode="${inputmode}" autocomplete="off" placeholder="${placeholder}" value="${v}" data-num ${min !== undefined ? raw(`data-min="${esc(min)}"`) : ''} data-step="${step}" ${attrList(attrs)}/>
    ${suffix ? html`<span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-slate-500">${suffix}</span>` : ''}
  </div>`;
}

function inputText(name, value, { placeholder = '', attrs = null, cls = '', type = 'text', maxlength = 120 } = {}) {
  const extra = { autocomplete: 'off', ...(attrs || {}) };
  return html`<input class="input ${cls}" type="${type}" name="${name}" value="${value ?? ''}" placeholder="${placeholder}" maxlength="${maxlength}" ${attrList(extra)}/>`;
}

function selectInput(name, options, value, { attrs = null, cls = '' } = {}) {
  return html`<div class="relative ${cls}">
    <select class="input appearance-none pr-10" name="${name}" ${attrList(attrs)}>
      ${options.map((o) => html`<option value="${o.value ?? ''}" ${String(o.value ?? '') === String(value ?? '') ? raw('selected') : ''} ${o.disabled ? raw('disabled') : ''}>${o.label}</option>`)}
    </select>
    <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-500">${icon('ChevronDown', 'w-4 h-4')}</span>
  </div>`;
}

function segmented(name, options, value, { action = 'segment', cls = '' } = {}) {
  return html`<div class="inline-flex rounded-xl border border-white/10 bg-ink-900/80 p-1 ${cls}" role="tablist">
    ${options.map((o) => html`<button type="button" role="tab" aria-selected="${o.value === value}" data-action="${action}" data-name="${name}" data-value="${o.value}"
      class="h-8 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium transition ${o.value === value ? 'bg-ink-700 text-slate-50 shadow-[inset_0_1px_0_rgba(255,255,255,.06)]' : 'text-slate-400 hover:text-slate-200'}">${o.label}</button>`)}
  </div>`;
}

function spoolDisc(hex, pct = 100, status = 'ok', size = 48) {
  const c = safeHex(hex);
  const r = 21;
  const circ = 2 * Math.PI * r;
  const ring = status === 'ok' ? '#22F2A0' : status === 'low' ? '#FBBF24' : '#F43F5E';
  return raw(`<svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true" class="shrink-0">
    <circle cx="24" cy="24" r="${r}" fill="none" stroke="rgba(148,163,184,.15)" stroke-width="3"/>
    <circle cx="24" cy="24" r="${r}" fill="none" stroke="${ring}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(circ * clamp(pct, 0, 100)) / 100} ${circ}" transform="rotate(-90 24 24)"/>
    <circle cx="24" cy="24" r="15" fill="${c}"/>
    <circle cx="24" cy="24" r="15" fill="url(#p3dSpoolShade)"/>
    <circle cx="24" cy="24" r="5.5" fill="#0A0E13" stroke="rgba(255,255,255,.18)"/>
  </svg>`);
}

function colorDots(materials, size = 'h-3 w-3') {
  const list = Array.isArray(materials) ? materials : [];
  if (!list.length) return html`<span class="text-[12px] text-slate-500">Aucune matière</span>`;
  return html`<span class="inline-flex -space-x-1">${list.slice(0, 6).map((m) => html`<span class="${size} rounded-full ring-2 ring-ink-900" style="background:${safeHex(m.color_hex)};box-shadow:inset 0 0 0 1px rgba(255,255,255,.28)"></span>`)}</span>`;
}

function layeredThumb(materials, photo, cls = 'h-full w-full') {
  if (photo && /^data:image\/(png|jpe?g|webp);base64,/i.test(photo)) {
    return html`<img src="${photo}" alt="" class="${cls} object-contain" loading="lazy"/>`;
  }
  // Vignette par défaut : une pièce imprimée couche par couche, aux couleurs des matières
  const colors = (Array.isArray(materials) && materials.length ? materials : [{ color_hex: '#334358' }]).map((m) => safeHex(m.color_hex));
  const n = 10;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const c = colors[Math.floor((i / n) * colors.length)];
    const [r, g, b] = hexToRgb(c);
    const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 60;
    const w = 46 + 34 * Math.sin(((i + 0.5) / n) * Math.PI);
    rows.push(`<rect x="${((100 - w) / 2).toFixed(1)}" y="${8 + i * 8.6}" width="${w.toFixed(1)}" height="6.4" rx="3.2" fill="${c}"${dark ? ' stroke="rgba(255,255,255,.28)" stroke-width="0.9"' : ''} opacity="${(0.6 + (i / n) * 0.4).toFixed(2)}"/>`);
  }
  return raw(`<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" class="${esc(cls)}" aria-hidden="true"><ellipse cx="50" cy="96" rx="40" ry="3" fill="rgba(34,242,160,.12)"/>${rows.join('')}</svg>`);
}

function emptyCard({ icon: ic = 'Sparkles', title, text, actions = '' }) {
  return html`<div class="card flex flex-col items-center px-6 py-12 text-center">
    <div class="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-neon/20 bg-neon/5 text-neon">${icon(ic, 'w-7 h-7')}</div>
    <h3 class="font-display text-lg font-semibold text-slate-100">${title}</h3>
    <p class="mt-1 max-w-sm text-sm text-slate-400">${text}</p>
    ${actions ? html`<div class="mt-5 flex flex-wrap justify-center gap-2">${actions}</div>` : ''}
  </div>`;
}

function pageHeader(title, subtitle, actions = '') {
  return html`<div class="mb-5 flex flex-wrap items-end justify-between gap-3 pt-5 lg:pt-8">
    <div class="min-w-0">
      <h1 class="font-display text-[26px] font-bold leading-tight tracking-tight text-slate-50 lg:text-3xl">${title}</h1>
      ${subtitle ? html`<p class="mt-1 text-sm text-slate-400">${subtitle}</p>` : ''}
    </div>
    ${actions ? html`<div class="flex flex-wrap gap-2">${actions}</div>` : ''}
  </div>`;
}

function statRow(label, value, { tone = '', strong = false, cls = '' } = {}) {
  return html`<div class="flex items-center justify-between gap-3 py-1.5 ${cls}">
    <span class="text-[13px] text-slate-400">${label}</span>
    <span class="tabular-nums ${strong ? 'font-display text-base font-semibold' : 'text-sm font-medium'} ${tone || 'text-slate-100'}">${value}</span>
  </div>`;
}

function costBar(parts) {
  const segs = parts.filter((p) => p.value > 0);
  const total = sum(segs, (p) => p.value);
  if (total <= 0) return html`<div class="h-2 rounded-full bg-white/5"></div>`;
  return html`<div class="flex h-2 overflow-hidden rounded-full bg-white/5">${segs.map((p) => html`<div style="width:${((p.value / total) * 100).toFixed(2)}%;background:${p.color}" title="${p.label}"></div>`)}</div>`;
}

const COST_COLORS = { material: '#22F2A0', purge: '#10B981', hardware: '#A78BFA', machine: '#22D3EE', labor: '#F59E0B', other: '#64748B', fees: '#F472B6', failures: '#F43F5E' };

/* ---------- lecture des formulaires ---------- */
function readForm(root) {
  const out = {};
  for (const el of $$('input[name], select[name], textarea[name]', root)) {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
    } else if (el.hasAttribute('data-num')) out[el.name] = el.value.trim() === '' ? null : parseNum(el.value);
    else out[el.name] = el.value;
  }
  return out;
}

function setFieldError(root, name, message) {
  const el = root.querySelector(`[name="${name}"]`);
  if (!el) return;
  const wrap = el.closest('label') || el.parentElement;
  let msg = wrap.querySelector('.field-error');
  if (!message) {
    el.classList.remove('input-error');
    if (msg) msg.remove();
    return;
  }
  el.classList.add('input-error');
  if (!msg) {
    msg = document.createElement('span');
    msg.className = 'field-error mt-1 block text-[12px] text-rose-300';
    wrap.appendChild(msg);
  }
  msg.textContent = message;
}

/* ---------- notifications ---------- */
function toast(message, { tone = 'ok', title = '', timeout = 4200 } = {}) {
  const root = $('#toast-root');
  if (!root) return;
  const t = TONES[tone] || TONES.ok;
  const ic = tone === 'ok' ? 'CircleCheck' : tone === 'bad' ? 'CircleAlert' : tone === 'warn' ? 'CloudOff' : 'Info';
  const el = document.createElement('div');
  el.setAttribute('role', tone === 'bad' ? 'alert' : 'status');
  el.className = `toast pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border ${t.border} bg-ink-850/95 p-3.5 shadow-2xl shadow-black/50 backdrop-blur`;
  el.innerHTML = String(html`<span class="mt-0.5 ${t.text}">${icon(ic, 'w-5 h-5')}</span>
    <div class="min-w-0 flex-1">${title ? html`<div class="text-sm font-semibold text-slate-100">${title}</div>` : ''}<div class="text-[13px] leading-snug text-slate-300">${message}</div></div>
    <button class="hit -m-1 shrink-0 rounded-lg p-1 text-slate-400 hover:text-slate-200" aria-label="Fermer">${icon('X', 'w-4 h-4')}</button>`);
  const close = () => {
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 220);
  };
  el.querySelector('button').addEventListener('click', close);
  root.appendChild(el);
  if (timeout) setTimeout(close, tone === 'bad' ? Math.max(timeout, 8000) : timeout);
}

// Bouton principal dont l'action prend du temps (envoi à la base) : anneau de chargement après 150 ms,
// bouton non recliquable jusqu'à la fin (pas d'anneau pour les actions instantanées)
function withBusy(el, result) {
  if (!result || typeof result.then !== 'function' || !el || !el.matches || !el.matches('.btn-primary, .btn[data-action="submit"]')) return result;
  const timer = setTimeout(() => {
    el.classList.add('is-busy');
    el.setAttribute('aria-busy', 'true');
  }, 150);
  const done = () => {
    clearTimeout(timer);
    el.classList.remove('is-busy');
    el.removeAttribute('aria-busy');
  };
  result.then(done, (e) => {
    done();
    console.error(`[${SITE.id}] action interrompue`, e);
  });
  return result;
}

// Annonce honnête du résultat d'une action
async function runOp(type, payload, { success = 'Enregistré' } = {}) {
  const res = await Sync.enqueue(type, payload);
  if (res.state === 'confirmed' && res.tombstoned) {
    toast('Cet élément avait déjà été supprimé sur un autre appareil : rien n’a été enregistré.', { tone: 'warn', title: 'Action ignorée' });
    return res;
  }
  if (res.state === 'confirmed') {
    toast(success, { tone: 'ok' });
    return res;
  }
  if (res.state === 'queued') {
    if (res.slow) toast("La base répond lentement : l'action est gardée sur cet appareil et sera envoyée dès que possible.", { tone: 'warn', title: 'Envoi en cours' });
    else toast("Pas de connexion : l'action est gardée sur cet appareil. Elle partira automatiquement au retour du réseau.", { tone: 'warn', title: "En attente d'envoi" });
    return res;
  }
  toast(res.error.message, { tone: 'bad', title: res.state === 'failed' ? 'Refusé par la base' : 'Non enregistré' });
  return res;
}
const opAccepted = (res) => res.state === 'confirmed' || res.state === 'queued';

/* ---------- fenêtres (bottom sheet sur téléphone, boîte au centre sur PC) ---------- */
const Modal = {
  stack: [],

  open({ title, subtitle = '', size = 'md', render, onMount, onInput, actions = {}, onClose, refreshOnStore = false }) {
    const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-xl', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' };
    const wrap = document.createElement('div');
    wrap.className = 'modal fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6';
    wrap.innerHTML = `<div class="modal-backdrop absolute inset-0 bg-black/70 backdrop-blur-sm" data-close></div>
      <div class="modal-panel relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-ink-900 shadow-2xl shadow-black/60 sm:rounded-3xl ${widths[size] || widths.md}" role="dialog" aria-modal="true">
        <div class="flex items-start justify-between gap-3 border-b border-white/[0.06] px-5 pb-3 pt-4">
          <div class="min-w-0"><div class="mx-auto mb-2 h-1 w-10 rounded-full bg-white/15 sm:hidden"></div>
            <h2 class="font-display text-lg font-semibold text-slate-50" data-title></h2>
            <p class="text-[13px] text-slate-400" data-subtitle></p></div>
          <button class="btn btn-ghost h-9 w-9 shrink-0 rounded-xl" data-close aria-label="Fermer">${icon('X', 'w-5 h-5')}</button>
        </div>
        <div class="modal-body flex-1 overflow-y-auto overscroll-contain px-5 py-4" data-body></div>
        <div class="modal-footer hidden border-t border-white/[0.06] bg-ink-900/95 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" data-footer></div>
      </div>`;
    document.getElementById('modal-root').appendChild(wrap);
    document.body.classList.add('overflow-hidden');

    const m = {
      el: wrap,
      data: {},
      actions,
      refreshOnStore,
      q: (sel) => wrap.querySelector(sel),
      qa: (sel) => [...wrap.querySelectorAll(sel)],
      body: wrap.querySelector('[data-body]'),
      setTitle(t, s = '') {
        wrap.querySelector('[data-title]').textContent = t;
        wrap.querySelector('[data-subtitle]').textContent = s;
      },
      render() {
        const out = render(m);
        const scroll = m.body.scrollTop;
        if (out && typeof out === 'object' && !(out instanceof Raw) && 'body' in out) {
          m.body.innerHTML = String(out.body);
          const f = wrap.querySelector('[data-footer]');
          f.innerHTML = out.footer ? String(out.footer) : '';
          f.classList.toggle('hidden', !out.footer);
        } else {
          m.body.innerHTML = String(out);
        }
        m.body.scrollTop = scroll;
      },
      update(sel, content) {
        const el = wrap.querySelector(sel);
        if (el) el.innerHTML = String(content);
      },
      close(result) {
        if (m.closed) return;
        m.closed = true;
        wrap.classList.add('modal-out');
        Modal.stack = Modal.stack.filter((x) => x !== m);
        setTimeout(() => {
          wrap.remove();
          if (!Modal.stack.length) document.body.classList.remove('overflow-hidden');
        }, 180);
        if (onClose) onClose(result);
      },
    };
    m.setTitle(title, subtitle);
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) {
        m.close();
        return;
      }
      const a = e.target.closest('[data-action]');
      if (a && m.actions[a.dataset.action]) {
        e.preventDefault();
        e.stopPropagation();
        withBusy(a, m.actions[a.dataset.action](a, e, m));
      }
    });
    if (onInput) {
      wrap.addEventListener('input', (e) => onInput(e, m));
      wrap.addEventListener('change', (e) => onInput(e, m));
    }
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') m.close();
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && m.actions.submit) {
        e.preventDefault();
        m.actions.submit(e.target, e, m);
      }
    });
    Modal.stack.push(m);
    m.render();
    if (onMount) onMount(m);
    requestAnimationFrame(() => {
      const first = wrap.querySelector('[autofocus]');
      if (first && window.matchMedia('(pointer: fine)').matches) first.focus();
    });
    return m;
  },

  refreshAll() {
    for (const m of Modal.stack) if (m.refreshOnStore && typeof m.refreshOnStore === 'function') m.refreshOnStore(m);
  },
};

function confirmBox({ title, message, confirm = 'Confirmer', tone = 'danger', icon: ic = 'TriangleAlert' }) {
  return new Promise((resolve) => {
    let answered = false;
    Modal.open({
      title,
      size: 'sm',
      render: () => ({
        body: html`<div class="flex gap-3"><span class="mt-0.5 ${tone === 'danger' ? 'text-rose-300' : 'text-amber-300'}">${icon(ic, 'w-6 h-6')}</span><p class="text-sm leading-relaxed text-slate-300">${message}</p></div>`,
        footer: html`<div class="flex justify-end gap-2">${btn('Annuler', { variant: 'ghost', action: 'no' })}${btn(confirm, { variant: tone === 'danger' ? 'danger' : 'primary', action: 'yes' })}</div>`,
      }),
      actions: {
        yes: (el, e, m) => {
          answered = true;
          m.close();
          resolve(true);
        },
        no: (el, e, m) => m.close(),
      },
      onClose: () => {
        if (!answered) resolve(false);
      },
    });
  });
}

/* ---------- navigation ---------- */
const NAV = [
  { name: 'dashboard', hash: '#/', label: 'Dashboard', short: 'Dashboard', icon: 'LayoutDashboard' },
  { name: 'bobines', hash: '#/bobines', label: 'Bobines', short: 'Bobines', icon: 'Disc3' },
  { name: 'templates', hash: '#/templates', label: 'Templates', short: 'Templates', icon: 'Layers' },
  { name: 'stock', hash: '#/stock', label: 'Stock & Ventes', short: 'Stock', icon: 'Store' },
  { name: 'parametres', hash: '#/parametres', label: 'Paramètres', short: 'Paramètres', icon: 'Settings' },
];

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  const name = path || 'dashboard';
  return { name, params };
}

function go(hash) {
  if (location.hash === hash) App.render();
  else location.hash = hash;
}

const Actions = {};
const VIEWS = {};

const App = {
  route: { name: 'dashboard', params: {} },
  charts: [],
  queued: false,
  ui: lsGet(LS.ui, {}) || {},
  mounted: false,

  saveUi() {
    lsSet(LS.ui, Object.fromEntries(Object.entries(this.ui).filter(([k]) => !k.endsWith('Draft'))));
  },

  start() {
    this.route = parseHash();
    if (!this.mounted) {
      this.mountShell();
      Store.subscribe(() => this.schedule());
      Sync.subscribe(() => this.updateChrome());
      window.addEventListener('hashchange', () => {
        this.route = parseHash();
        this.routeChanged = true;
        this.render();
        window.scrollTo({ top: 0 });
      });
      document.addEventListener('click', (e) => {
        const a = e.target.closest('[data-action]');
        if (!a || a.closest('.modal')) return;
        const fn = Actions[a.dataset.action];
        if (fn) {
          e.preventDefault();
          withBusy(a, fn(a, e));
        }
      });
      document.addEventListener('input', (e) => {
        const el = e.target.closest('[data-page-input]');
        if (el && Actions[el.dataset.pageInput]) Actions[el.dataset.pageInput](el, e);
      });
      this.mounted = true;
    }
    this.render();
  },

  // requestAnimationFrame est suspendu quand la fenêtre est cachée : minuterie de secours
  schedule() {
    if (this.queued) return;
    this.queued = true;
    const run = () => {
      if (!this.queued) return;
      this.queued = false;
      this.render();
      Modal.refreshAll();
    };
    requestAnimationFrame(run);
    setTimeout(run, 80);
  },

  mountShell() {
    const root = $('#app');
    root.innerHTML = String(html`
      <svg width="0" height="0" class="absolute" aria-hidden="true"><defs><radialGradient id="p3dSpoolShade" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></radialGradient></defs></svg>
      <aside class="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-white/[0.06] bg-ink-950/80 px-4 py-6 backdrop-blur lg:flex">
        <a href="#/" class="px-2">${logoLockup({ size: 42 })}</a>
        <nav class="mt-8 flex flex-col gap-1" id="side-nav"></nav>
        <div class="mt-auto space-y-3" id="side-foot"></div>
      </aside>
      <div class="lg:pl-64">
        <header class="sticky top-0 z-20 border-b border-white/[0.06] bg-ink-950/75 backdrop-blur-xl pt-[env(safe-area-inset-top)] lg:border-none lg:bg-transparent lg:backdrop-blur-0">
          <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 lg:h-16 lg:px-8">
            <a href="#/" class="hit shrink-0 lg:hidden" aria-label="Tableau de bord">${logoMark(34)}</a>
            <div class="min-w-0 flex-1 truncate font-display text-[17px] font-semibold text-slate-100 max-[359px]:invisible lg:hidden" id="top-title"></div>
            <div class="hidden flex-1 lg:block"></div>
            <div id="sync-pill"></div>
            ${btn('', { variant: 'primary', size: 'icon', icon: 'Plus', action: 'quick', title: 'Nouvelle action', cls: 'lg:hidden' })}
            ${btn('Nouvelle action', { variant: 'primary', icon: 'Plus', action: 'quick', cls: 'hidden lg:inline-flex' })}
          </div>
          <div id="banner"></div>
        </header>
        <main id="view" class="mx-auto max-w-6xl px-4 pb-32 lg:px-8 lg:pb-12"></main>
      </div>
      <nav class="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.06] bg-ink-950/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] lg:hidden" id="bottom-nav"></nav>
    `);
  },

  render() {
    for (const c of this.charts) {
      try {
        c.destroy();
      } catch { /* déjà détruit */ }
    }
    this.charts = [];
    const view = VIEWS[this.route.name] || VIEWS.dashboard;
    const main = $('#view');
    if (!main) return;
    const active = document.activeElement;
    const keep = active && main.contains(active) && active.dataset.keep ? { key: active.dataset.keep, start: active.selectionStart, end: active.selectionEnd } : null;
    main.innerHTML = String(view.render(Store.V, this.route));
    // changement d'écran (pas un simple rafraîchissement des données) : apparition douce
    if (this.routeChanged) {
      this.routeChanged = false;
      main.classList.remove('view-enter');
      void main.offsetWidth;
      main.classList.add('view-enter');
    }
    if (keep) {
      const el = main.querySelector(`[data-keep="${keep.key}"]`);
      if (el) {
        el.focus();
        try {
          el.setSelectionRange(keep.start, keep.end);
        } catch { /* champ sans sélection */ }
      }
    }
    if (view.mount) view.mount(Store.V, this.route);
    this.updateChrome();
  },

  updateChrome() {
    const route = this.route.name;
    // pages hors menu : leur titre, et l'onglet du bas auquel elles se rattachent
    const EXTRA = { historique: { label: 'Historique', parent: 'dashboard' }, bilan: { label: 'Bilan du mois', parent: 'dashboard' }, etiquettes: { label: 'Étiquettes', parent: 'bobines' } };
    const navItem = NAV.find((n) => n.name === route) || EXTRA[route] || NAV[0];
    const parent = EXTRA[route] ? EXTRA[route].parent : route;
    const title = $('#top-title');
    if (title) title.textContent = navItem.label;
    const side = $('#side-nav');
    if (side) {
      side.innerHTML = String(html`${NAV.map((n) => html`<a href="${n.hash}" class="nav-link ${n.name === (route === 'historique' ? '' : parent) ? 'nav-active' : ''}">${icon(n.icon, 'w-5 h-5')}<span>${n.label}</span></a>`)}
        <a href="#/historique" class="nav-link ${route === 'historique' ? 'nav-active' : ''}">${icon('History', 'w-5 h-5')}<span>Historique</span></a>`);
    }
    const bottom = $('#bottom-nav');
    if (bottom) {
      bottom.innerHTML = String(html`<div class="grid grid-cols-5">${NAV.map((n) => html`<a href="${n.hash}" class="bottom-link ${n.name === parent ? 'bottom-active' : ''}" aria-label="${n.label}">
        <span class="bottom-ic">${icon(n.icon, 'w-[22px] h-[22px]')}</span><span class="text-[11px] font-medium">${n.short}</span></a>`)}</div>`);
    }
    const s = Sync.summary();
    const t = TONES[s.tone] || TONES.off;
    const pill = $('#sync-pill');
    if (pill) {
      const spin = Sync.state.flushing || (Sync.state.pulling && !Sync.state.firstPullDone);
      pill.innerHTML = String(html`<button data-action="sync-panel" class="hit inline-flex h-9 items-center gap-2 rounded-full border ${t.border} ${t.bg} px-3 text-[12px] font-semibold ${t.text}" title="État de la synchronisation">
        ${spin ? icon('LoaderCircle', 'w-4 h-4 animate-spin') : html`<span class="relative flex h-2 w-2"><span class="absolute inline-flex h-full w-full rounded-full ${t.dot} ${s.tone === 'ok' ? 'animate-ping opacity-40' : 'opacity-0'}"></span><span class="relative inline-flex h-2 w-2 rounded-full ${t.dot}"></span></span>`}
        <span class="max-w-[9.5rem] truncate sm:max-w-none">${s.label}</span></button>`);
    }
    const foot = $('#side-foot');
    if (foot) {
      foot.innerHTML = String(html`<div class="rounded-2xl border border-white/[0.06] bg-ink-900/70 p-3 text-[12px] text-slate-400">
        <div class="flex items-center justify-between"><span>Dernière synchro</span><span class="text-slate-300">${Sync.state.lastPullAt ? fmtRelative(Sync.state.lastPullAt) : '—'}</span></div>
        <div class="mt-1 flex items-center justify-between"><span>Temps réel</span><span class="${Sync.state.realtime === 'on' ? 'text-neon' : 'text-slate-500'}">${Sync.backend && Sync.backend.kind === 'demo' ? 'démo' : Sync.state.realtime === 'on' ? ui('actif') : 'coupé'}</span></div>
      </div><div class="px-1 text-[11px] text-slate-500">${SITE.name} · v${APP_VERSION}</div>`);
    }
    const banner = $('#banner');
    if (banner) banner.innerHTML = String(renderBanner());
  },
};

function renderBanner() {
  const items = [];
  if (Sync.backend && Sync.backend.kind === 'demo') {
    items.push(html`<div class="flex items-center gap-2 bg-violet-500/10 px-4 py-2 text-[12px] text-violet-200 lg:rounded-xl">${icon('FlaskConical', 'w-4 h-4 shrink-0')}<span>Mode démo<span class="hidden sm:inline"> : les données restent sur cet appareil et ne sont envoyées nulle part</span><span class="sm:hidden"> · données sur cet appareil</span></span><a href="#/parametres" class="hit ml-auto shrink-0 font-semibold underline">Connecter Supabase</a></div>`);
  }
  if (Store.volatile) {
    items.push(html`<div class="flex items-center gap-2 bg-amber-400/10 px-4 py-2 text-[12px] text-amber-200">${icon('TriangleAlert', 'w-4 h-4 shrink-0')}<span>Ce navigateur refuse la mémoire locale : sans réseau, les actions ne seront pas gardées si tu fermes l'appli.</span></div>`);
  }
  if (Store.persistError) {
    items.push(html`<div class="flex items-center gap-2 bg-amber-400/10 px-4 py-2 text-[12px] text-amber-200">${icon('HardDriveDownload', 'w-4 h-4 shrink-0')}<span>La copie hors-ligne de cet appareil n'a pas pu être enregistrée (mémoire pleine ?). Les données en ligne ne sont pas touchées.</span></div>`);
  }
  if (Sync.state.needsLogin) {
    items.push(html`<div class="flex items-center gap-2 bg-rose-500/10 px-4 py-2 text-[12px] text-rose-200">${icon('KeyRound', 'w-4 h-4 shrink-0')}<span>Ta session a expiré : reconnecte-toi pour envoyer les actions en attente (elles sont gardées).</span><button data-action="relogin" class="hit ml-auto shrink-0 font-semibold underline">Se reconnecter</button></div>`);
  }
  if (Sync.state.needsMfa) {
    items.push(html`<div class="flex items-center gap-2 bg-rose-500/10 px-4 py-2 text-[12px] text-rose-200">${icon('ShieldCheck', 'w-4 h-4 shrink-0')}<span>Double authentification : tape ton code pour reprendre la synchronisation (tes actions sont gardées).</span><button data-action="mfa-code" class="hit ml-auto shrink-0 font-semibold underline">Entrer le code</button></div>`);
  }
  if (Sync.state.schemaVersion !== null && Sync.state.schemaVersion < SCHEMA_VERSION) {
    items.push(html`<div class="flex items-center gap-2 bg-amber-400/10 px-4 py-2 text-[12px] text-amber-200">${icon('Database', 'w-4 h-4 shrink-0')}<span>La base Supabase n'est pas à jour : relance le script SQL fourni.</span></div>`);
  }
  if (Sync.state.lastError && Sync.backend && Sync.backend.kind !== 'demo') {
    items.push(html`<div class="flex items-center gap-2 bg-rose-500/10 px-4 py-2 text-[12px] text-rose-200">${icon('ServerCrash', 'w-4 h-4 shrink-0')}<span>${Sync.state.lastError}</span></div>`);
  }
  return items.length ? html`<div class="mx-auto max-w-6xl space-y-px lg:px-8">${items}</div>` : '';
}

/* ---------- panneau de synchronisation ---------- */
Actions['sync-panel'] = () => {
  Modal.open({
    title: 'Synchronisation',
    subtitle: Sync.backend && Sync.backend.kind === 'demo' ? 'Mode démo : tout reste sur cet appareil' : 'Base Supabase',
    size: 'md',
    refreshOnStore: (m) => m.render(),
    render: () => {
      const s = Sync.summary();
      const t = TONES[s.tone];
      const pending = Store.Q.filter((o) => o.status !== 'failed');
      const failed = Store.Q.filter((o) => o.status === 'failed');
      return {
        body: html`
          <div class="rounded-2xl border ${t.border} ${t.bg} p-4">
            <div class="flex items-center gap-2 font-semibold ${t.text}">${icon(s.tone === 'ok' ? 'CloudCheck' : s.tone === 'bad' ? 'CircleAlert' : 'CloudOff', 'w-5 h-5')}${s.label}</div>
            <div class="mt-2 grid grid-cols-2 gap-2 text-[12px] text-slate-400">
              <div>Dernière lecture : <span class="text-slate-200">${Sync.state.lastPullAt ? fmtRelative(Sync.state.lastPullAt) : ui('jamais')}</span></div>
              <div>Dernier envoi : <span class="text-slate-200">${Sync.state.lastConfirmAt ? fmtRelative(Sync.state.lastConfirmAt) : '—'}</span></div>
              <div>Temps réel : <span class="text-slate-200">${Sync.state.realtime === 'on' ? ui('actif') : 'coupé (relecture toutes les 5 min)'}</span></div>
              <div>Mémoire locale : <span class="text-slate-200">${Store.volatile ? ui('indisponible') : ui('active')}</span></div>
            </div>
          </div>
          ${failed.length ? html`<h3 class="mb-2 mt-5 text-sm font-semibold text-rose-200">Refusées par la base (${failed.length})</h3>
            <p class="mb-3 text-[12px] text-slate-400">Elles ne sont pas enregistrées. Corrige la cause puis réessaie, ou abandonne-les.</p>
            <div class="space-y-2">${failed.map((op) => html`<div class="rounded-xl border border-rose-500/25 bg-rose-500/5 p-3">
              <div class="text-sm font-medium text-slate-100">${opLabel(op)}</div>
              <div class="mt-0.5 text-[12px] text-rose-200">${op.error ? op.error.message : ''}</div>
              <div class="mt-1 text-[11px] text-slate-500">Saisie ${fmtRelative(op.created_at)}</div>
              <div class="mt-2 flex gap-2">${btn('Réessayer', { size: 'sm', icon: 'RefreshCw', action: 'retry', attrs: { 'data-op': op.id } })}${btn('Abandonner', { size: 'sm', variant: 'danger', icon: 'Trash2', action: 'discard', attrs: { 'data-op': op.id } })}</div>
            </div>`)}</div>` : ''}
          <h3 class="mb-2 mt-5 text-sm font-semibold text-slate-200">En attente d'envoi (${pending.length})</h3>
          ${pending.length ? html`<div class="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06]">${pending.map((op) => html`<div class="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"><span class="truncate text-slate-200">${opLabel(op)}</span><span class="shrink-0 text-[11px] text-slate-500">${op.status === 'sending' ? 'envoi…' : fmtRelative(op.created_at)}</span></div>`)}</div>`
            : html`<p class="text-[13px] text-slate-500">Rien en attente : tout ce qui est affiché est enregistré dans la base.</p>`}`,
        footer: html`<div class="flex justify-end gap-2">${btn('Fermer', { variant: 'ghost', action: 'close' })}${btn('Synchroniser maintenant', { variant: 'primary', icon: 'RefreshCw', action: 'now' })}</div>`,
      };
    },
    actions: {
      close: (el, e, m) => m.close(),
      now: async (el) => {
        el.disabled = true;
        let v;
        try {
          v = await Sync.syncNow();
        } finally {
          el.disabled = false;
        }
        toast(v.message, { tone: v.tone });
      },
      retry: (el) => Sync.retryOp(el.dataset.op),
      discard: async (el) => {
        const ok = await confirmBox({ title: 'Abandonner cette action ?', message: 'Elle ne sera jamais enregistrée dans la base. Cette décision est définitive.', confirm: 'Abandonner' });
        if (ok) Sync.discardOp(el.dataset.op);
      },
    },
  });
};

Actions.relogin = () => Screens.login({ relogin: true });

Actions.segment = (el) => {
  const { name, value } = el.dataset;
  App.ui[name] = value;
  App.saveUi();
  App.render();
};

Actions.quick = () => {
  const V = Store.V;
  const hasTemplates = valuesOf(V.templates).some((t) => !t.archived);
  const item = (ic, title, text, action, tone = 'text-neon') => html`<button data-action="${action}" class="group flex w-full items-center gap-3 rounded-2xl border border-white/[0.06] bg-ink-850 p-3.5 text-left transition hover:border-neon/30 hover:bg-ink-800">
    <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[0.04] ${tone}">${icon(ic, 'w-[22px] h-[22px]')}</span>
    <span class="min-w-0 flex-1"><span class="block text-[15px] font-semibold text-slate-100">${title}</span><span class="block text-[12px] text-slate-400">${text}</span></span>
    <span class="text-slate-600 group-hover:text-slate-300">${icon('ChevronRight', 'w-5 h-5')}</span></button>`;
  Modal.open({
    title: 'Nouvelle action',
    size: 'sm',
    render: () => html`<div class="space-y-2.5">
      ${item('Printer', 'Lancer une production', hasTemplates ? 'Déduit le filament et ajoute les pièces au stock' : "Crée d'abord un template", 'q-production')}
      ${item('ShoppingBag', 'Enregistrer une vente', 'Déstocke et calcule la marge nette', 'q-sale', 'text-cyan-300')}
      ${item('ClipboardList', 'Nouvelle commande', 'Ce qu’un client a demandé, pour quand', 'q-order', 'text-cyan-300')}
      ${item('Flame', 'Déclarer un print raté', 'Déduit le filament et compte la perte', 'q-failure', 'text-rose-300')}
      ${item('Disc3', 'Ajouter une bobine', 'Nouveau consommable', 'q-spool', 'text-violet-300')}
      ${item('FileUp', 'Nouveau template', 'Avec import Bambu Studio', 'q-template', 'text-amber-300')}
    </div>`,
    actions: {
      'q-production': (el, e, m) => { m.close(); openProductionModal({ kind: 'production' }); },
      'q-sale': (el, e, m) => { m.close(); openSaleModal({}); },
      'q-failure': (el, e, m) => { m.close(); openProductionModal({ kind: 'failure' }); },
      'q-order': (el, e, m) => { m.close(); openOrderModal({}); },
      'q-spool': (el, e, m) => { m.close(); openSpoolModal({}); },
      'q-template': (el, e, m) => { m.close(); openTemplateModal({}); },
    },
  });
};

/* ---------- téléchargement / partage de fichiers ---------- */
// Renvoie false si la personne a annulé (menu de partage du téléphone fermé sans choisir)
async function saveFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  try {
    const file = new File([blob], filename, { type: mime });
    // téléphone ou tablette (l'iPad se présente comme un Mac, mais tactile) : feuille de partage
    const ua = navigator.userAgent;
    const mobile = /iphone|ipad|android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (navigator.canShare && navigator.canShare({ files: [file] }) && mobile) {
      await navigator.share({ files: [file], title: filename });
      return true;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return false;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}
