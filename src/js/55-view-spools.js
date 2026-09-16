/* =============================================================================
   Bobines : parc, fiche, pesée, historique
   ============================================================================= */

const BRANDS = ['Bambu Lab', 'Polymaker', 'Prusament', 'eSun', 'Sunlu', 'Elegoo', 'Eryone', 'Creality', 'Jayo', 'Anycubic', 'Geeetech', 'Kingroon', 'Fiberlogy', 'Spectrum', 'Extrudr'];

const COLOR_PRESETS = [
  ['Noir', '#111111'], ['Blanc', '#F5F5F5'], ['Gris', '#8A8F98'], ['Rouge', '#E0262F'], ['Orange', '#F97316'], ['Jaune', '#FACC15'],
  ['Vert', '#22C55E'], ['Bleu', '#2563EB'], ['Cyan', '#06B6D4'], ['Violet', '#7C3AED'], ['Rose', '#EC4899'], ['Marron', '#7C4A2D'],
  ['Beige', '#D6C3A1'], ['Or', '#C9A227'], ['Argent', '#C0C4CC'], ['Transparent', '#DDE7EE'],
];

function spoolStatusBadge(status) {
  const meta = SPOOL_STATUS[status];
  return badge(meta.label, meta.tone, { dot: true });
}

VIEWS.bobines = {
  render(V) {
    const st = settingsOf(V);
    const view = App.ui.spoolView || 'active';
    const mat = App.ui.spoolMat || 'all';
    const q = normalizeText(App.ui.spoolQ || '');
    const all = valuesOf(V.spools);
    const active = all.filter((s) => !s.archived);
    const withStatus = (s) => ({ s, status: spoolStatus(s, st) });
    const alerts = active.map(withStatus).filter((x) => x.status !== 'ok');
    const totalG = sum(active, (s) => Math.max(0, toNum(s.remaining_weight_g)));
    const valueLeft = sum(active, (s) => Math.max(0, toNum(s.remaining_weight_g)) * spoolCpg(s));
    const materials = [...new Set(all.map((s) => s.material))].sort((a, b) => a.localeCompare(b, 'fr'));

    let list = (view === 'archived' ? all.filter((s) => s.archived) : active).map(withStatus);
    if (view === 'alert') list = list.filter((x) => x.status !== 'ok');
    if (mat !== 'all') list = list.filter((x) => x.s.material === mat);
    if (q) list = list.filter((x) => normalizeText(`${x.s.brand} ${x.s.material} ${x.s.color_name}`).includes(q));
    const rank = { empty: 0, critical: 1, low: 2, ok: 3 };
    list.sort((a, b) => (view === 'alert' ? rank[a.status] - rank[b.status] : 0) || a.s.material.localeCompare(b.s.material, 'fr') || (a.s.color_name || '').localeCompare(b.s.color_name || '', 'fr') || toNum(a.s.remaining_weight_g) - toNum(b.s.remaining_weight_g));

    return html`
      ${pageHeader('Bobines', `${fmtNum(active.length)} bobine${active.length > 1 ? 's' : ''} active${active.length > 1 ? 's' : ''}`, btn('Ajouter une bobine', { variant: 'primary', icon: 'Plus', action: 'spool-new' }))}
      <div class="mb-4 grid grid-cols-3 gap-2">
        <div class="card px-3 py-3"><div class="text-[11px] text-slate-500">Filament restant</div><div class="font-display text-lg font-bold tabular-nums text-slate-50 sm:text-xl">${fmtKg(totalG)}</div></div>
        <div class="card px-3 py-3"><div class="text-[11px] text-slate-500">Valeur restante</div><div class="font-display text-lg font-bold tabular-nums text-slate-50 sm:text-xl">${fmtEur(valueLeft)}</div></div>
        <button data-action="spool-view" data-value="${view === 'alert' ? 'active' : 'alert'}" class="card px-3 py-3 text-left ${alerts.length ? 'border-amber-400/25' : ''}"><div class="text-[11px] text-slate-500">En alerte</div><div class="font-display text-lg font-bold tabular-nums sm:text-xl ${alerts.length ? 'text-amber-300' : 'text-slate-50'}">${fmtNum(alerts.length)}</div></button>
      </div>
      <div class="mb-4 flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
          ${segmented('spoolView', [{ value: 'active', label: 'Actives' }, { value: 'alert', label: 'En alerte' }, { value: 'archived', label: 'Archivées' }], view)}
          <div class="relative min-w-[12rem] flex-1">
            <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">${icon('Search', 'w-4 h-4')}</span>
            <input class="input pl-9" placeholder="Couleur, marque, matière…" value="${App.ui.spoolQ || ''}" data-page-input="spool-search" data-keep="spool-search" autocomplete="off"/>
          </div>
        </div>
        ${materials.length > 1 ? html`<div class="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0">
          <button data-action="spool-mat" data-value="all" class="chip ${mat === 'all' ? 'chip-active' : ''}">Toutes matières</button>
          ${materials.map((m) => html`<button data-action="spool-mat" data-value="${m}" class="chip ${mat === m ? 'chip-active' : ''}">${m}</button>`)}
        </div>` : ''}
      </div>
      ${list.length ? html`<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">${list.map(({ s, status }) => spoolCard(V, s, status))}</div>`
        : all.length
          ? emptyCard({ icon: 'SearchX', title: 'Aucune bobine ici', text: 'Change de filtre ou de recherche.' })
          : emptyCard({ icon: 'Disc3', title: 'Ajoute ta première bobine', text: 'Prix, poids et couleur : Paulo3D calcule le coût au gramme et surveille le stock.', actions: btn('Ajouter une bobine', { variant: 'primary', icon: 'Plus', action: 'spool-new' }) })}`;
  },
};

function spoolCard(V, s, status) {
  const rem = toNum(s.remaining_weight_g);
  const pct = spoolPct(s);
  const cpg = spoolCpg(s);
  const bar = status === 'ok' ? 'bg-neon' : status === 'low' ? 'bg-amber-400' : 'bg-rose-500';
  return html`<article class="card flex flex-col p-4 ${s.archived ? 'opacity-70' : ''}">
    <div class="flex items-start gap-3">
      ${spoolDisc(s.color_hex, pct, status, 52)}
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1"><h3 class="truncate font-semibold text-slate-100">${s.color_name || 'Sans nom'}</h3>${s.archived ? badge('Archivée', 'off') : spoolStatusBadge(status)}</div>
        <div class="truncate text-[13px] text-slate-400">${[s.brand, s.material].filter(Boolean).join(' · ')}</div>
      </div>
      ${btn('', { variant: 'ghost', size: 'icon', icon: 'EllipsisVertical', action: 'spool-menu', attrs: { 'data-id': s.id }, title: 'Plus d’actions', cls: '-mr-2 -mt-1 h-9 w-9' })}
    </div>
    <div class="mt-4">
      <div class="flex items-baseline justify-between gap-2">
        <span class="font-display text-2xl font-bold tabular-nums ${status === 'ok' ? 'text-slate-50' : status === 'low' ? 'text-amber-300' : 'text-rose-300'}">${fmtG(Math.max(0, rem))}</span>
        <span class="text-[12px] text-slate-500">sur ${fmtG(s.initial_weight_g)}</span>
      </div>
      <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div class="h-full rounded-full ${bar}" style="width:${pct.toFixed(1)}%"></div></div>
      ${rem < 0 ? html`<p class="mt-2 text-[12px] text-amber-300">Écart de ${fmtG(-rem)} : pèse la bobine pour corriger.</p>` : ''}
    </div>
    <div class="mt-3 flex items-center justify-between text-[12px] text-slate-400">
      <span class="tabular-nums">${fmtCpg(cpg)} <span class="text-slate-600">·</span> ${fmtNum(cpg * 1000, 2)} €/kg</span>
      <span class="tabular-nums">${fmtEur(s.price)}</span>
    </div>
    ${pendingBadge(V, `spools:${s.id}`) ? html`<div class="mt-2">${pendingBadge(V, `spools:${s.id}`)}</div>` : ''}
    <div class="mt-4 flex gap-2">
      ${btn('Peser', { size: 'sm', icon: 'Scale', action: 'spool-weigh', attrs: { 'data-id': s.id }, cls: 'flex-1' })}
      ${btn('Modifier', { size: 'sm', variant: 'ghost', icon: 'Pencil', action: 'spool-edit', attrs: { 'data-id': s.id }, cls: 'flex-1' })}
    </div>
  </article>`;
}

Actions['spool-new'] = () => openSpoolModal({});
Actions['spool-edit'] = (el) => {
  const s = Store.V.spools.get(el.dataset.id);
  if (s) openSpoolModal({ spool: s });
};
Actions['spool-weigh'] = (el) => {
  const s = Store.V.spools.get(el.dataset.id);
  if (s) openWeighModal(s);
};
Actions['spool-view'] = (el) => {
  App.ui.spoolView = el.dataset.value;
  App.saveUi();
  App.render();
};
Actions['spool-mat'] = (el) => {
  App.ui.spoolMat = el.dataset.value;
  App.saveUi();
  App.render();
};
Actions['spool-search'] = debounce((el) => {
  App.ui.spoolQ = el.value;
  App.render();
}, 150);

Actions['spool-menu'] = (el) => {
  const s = Store.V.spools.get(el.dataset.id);
  if (!s) return;
  const hasHistory = valuesOf(Store.V.spool_movements).some((m) => m.spool_id === s.id);
  const row = (ic, label, action, tone = 'text-slate-200') => html`<button data-action="${action}" class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] ${tone} hover:bg-white/[0.04]">${icon(ic, 'w-5 h-5 text-slate-400')}${label}</button>`;
  Modal.open({
    title: s.color_name || 'Bobine',
    subtitle: [s.brand, s.material].filter(Boolean).join(' · '),
    size: 'sm',
    render: () => html`<div class="-mx-2">
      ${row('Scale', 'Peser la bobine', 'm-weigh')}
      ${row('Pencil', 'Modifier', 'm-edit')}
      ${row('Copy', 'Racheter la même (dupliquer)', 'm-dup')}
      ${row('History', 'Historique de consommation', 'm-history')}
      ${row(s.archived ? 'ArchiveRestore' : 'Archive', s.archived ? 'Désarchiver' : 'Archiver (bobine finie)', 'm-archive')}
      ${hasHistory ? '' : row('Trash2', 'Supprimer', 'm-delete', 'text-rose-300')}
    </div>`,
    actions: {
      'm-weigh': (b, e, m) => { m.close(); openWeighModal(s); },
      'm-edit': (b, e, m) => { m.close(); openSpoolModal({ spool: s }); },
      'm-dup': (b, e, m) => { m.close(); openSpoolModal({ spool: s, duplicate: true }); },
      'm-history': (b, e, m) => { m.close(); openSpoolHistory(s); },
      'm-archive': async (b, e, m) => {
        m.close();
        await runOp('spool.patch', { id: s.id, fields: { archived: !s.archived } }, { success: s.archived ? 'Bobine réactivée' : 'Bobine archivée' });
      },
      'm-delete': async (b, e, m) => {
        m.close();
        const ok = await confirmBox({ title: 'Supprimer cette bobine ?', message: `${spoolLabel(s)} sera supprimée définitivement.`, confirm: 'Supprimer' });
        if (ok) await runOp('spool.delete', { id: s.id }, { success: 'Bobine supprimée' });
      },
    },
  });
};

function openSpoolModal({ spool = null, duplicate = false }) {
  const editing = spool && !duplicate;
  const base = spool
    ? { ...pick(spool, SPOOL_FIELDS) }
    : { brand: lsGet('p3d_last_brand', 'Bambu Lab'), material: 'PLA', color_name: '', color_hex: '#111111', price: null, initial_weight_g: 1000, tare_g: null, purchased_at: toLocalInput().slice(0, 10), notes: '' };
  if (!editing) {
    base.id = uuid();
    base.archived = false;
    base.purchased_at = toLocalInput().slice(0, 10);
  }
  const d = { s: base, started: false, remainingNow: null, busy: false };
  const V0 = Store.V;
  const knownMaterials = [...new Set([...MATERIALS, ...valuesOf(V0.spools).map((x) => x.material)])];
  const knownBrands = [...new Set([...valuesOf(V0.spools).map((x) => x.brand).filter(Boolean), ...BRANDS])];

  const summary = () => {
    const cpg = toNum(d.s.initial_weight_g) > 0 ? toNum(d.s.price) / toNum(d.s.initial_weight_g) : 0;
    return html`<div class="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-ink-850 p-3">
      ${spoolDisc(d.s.color_hex, 100, 'ok', 44)}
      <div class="min-w-0 flex-1"><div class="truncate font-semibold text-slate-100">${d.s.color_name || 'Couleur sans nom'}</div><div class="truncate text-[12px] text-slate-400">${[d.s.brand, d.s.material].filter(Boolean).join(' · ')}</div></div>
      <div class="text-right"><div class="font-display text-lg font-bold tabular-nums text-neon">${fmtCpg(cpg)}</div><div class="text-[11px] text-slate-500">${fmtNum(cpg * 1000, 2)} €/kg</div></div>
    </div>`;
  };

  Modal.open({
    title: editing ? 'Modifier la bobine' : duplicate ? 'Racheter la même bobine' : 'Nouvelle bobine',
    subtitle: editing ? spoolLabel(spool) : 'Le coût au gramme est calculé automatiquement',
    size: 'md',
    render: () => ({
      body: html`<div class="space-y-4">
        <div id="spool-summary">${summary()}</div>
        <div>
          <span class="label">Couleur</span>
          <div class="flex items-center gap-2">
            <label class="relative h-11 w-14 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-white/10" style="background:${safeHex(d.s.color_hex)}" id="spool-color-swatch">
              <input type="color" name="color_hex" value="${safeHex(d.s.color_hex)}" class="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Choisir la couleur"/>
            </label>
            ${inputText('color_name', d.s.color_name, { placeholder: 'Nom de la couleur (ex. Noir mat)', maxlength: 60, cls: 'flex-1', attrs: { autofocus: true } })}
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5">${COLOR_PRESETS.map(([n, h]) => html`<button type="button" data-action="preset" data-name="${n}" data-hex="${h}" class="h-7 w-7 rounded-full border border-white/15 transition hover:scale-110 ${safeHex(d.s.color_hex) === h ? 'ring-2 ring-neon ring-offset-2 ring-offset-ink-900' : ''}" style="background:${h}" title="${n}" aria-label="${n}"></button>`)}</div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          ${field('Marque', html`${inputText('brand', d.s.brand, { placeholder: 'Bambu Lab', maxlength: 80, attrs: { list: 'brand-list' } })}<datalist id="brand-list">${knownBrands.map((b) => html`<option value="${b}"></option>`)}</datalist>`)}
          ${field('Matière', selectInput('material', knownMaterials.map((m) => ({ value: m, label: m })), d.s.material))}
        </div>
        <div class="grid grid-cols-2 gap-3">
          ${field("Prix d'achat", inputNum('price', d.s.price, { suffix: '€', placeholder: '22,00' }))}
          ${field('Poids initial (net)', inputNum('initial_weight_g', d.s.initial_weight_g, { suffix: 'g', placeholder: '1000', inputmode: 'numeric' }))}
        </div>
        <div class="flex flex-wrap gap-1.5">${[250, 500, 750, 1000, 2000, 3000].map((w) => html`<button type="button" data-action="weight-preset" data-w="${w}" class="chip ${toNum(d.s.initial_weight_g) === w ? 'chip-active' : ''}">${w >= 1000 ? `${w / 1000} kg` : `${w} g`}</button>`)}</div>
        ${editing ? '' : html`<div class="rounded-2xl border border-white/[0.06] bg-ink-850 p-3">
          <label class="flex items-center justify-between gap-3"><span class="text-sm text-slate-200">Bobine déjà entamée</span>
            <input type="checkbox" name="started" class="toggle" ${d.started ? raw('checked') : ''}/></label>
          ${d.started ? html`<div class="mt-3">${field('Poids restant aujourd’hui (net, sans la bobine vide)', inputNum('remainingNow', d.remainingNow, { suffix: 'g', placeholder: '640', inputmode: 'numeric' }))}</div>` : ''}
        </div>`}
        <details class="group rounded-2xl border border-white/[0.06] bg-ink-850 p-3" ${d.s.tare_g || d.s.notes ? raw('open') : ''}>
          <summary class="flex cursor-pointer list-none items-center justify-between text-sm text-slate-300">Plus de détails<span class="transition group-open:rotate-180">${icon('ChevronDown', 'w-4 h-4')}</span></summary>
          <div class="mt-3 space-y-3">
            ${field('Poids de la bobine vide (tare)', inputNum('tare_g', d.s.tare_g, { suffix: 'g', placeholder: 'ex. 250', inputmode: 'numeric' }), { hint: 'Pèse une bobine vide de cette marque une fois : ensuite il suffit de poser la bobine sur la balance.' })}
            ${field("Date d'achat", html`<input class="input" type="date" name="purchased_at" value="${d.s.purchased_at || ''}"/>`)}
            ${field('Notes', html`<textarea class="input h-20 py-2" name="notes" maxlength="1000" placeholder="Fournisseur, lot, réglages…">${d.s.notes || ''}</textarea>`)}
          </div>
        </details>
      </div>`,
      footer: html`<div class="flex items-center justify-end gap-2">${btn('Annuler', { variant: 'ghost', action: 'cancel' })}${btn(editing ? 'Enregistrer' : 'Ajouter la bobine', { variant: 'primary', icon: 'Check', action: 'submit' })}</div>`,
    }),
    onInput: (e, m) => {
      const el = e.target;
      if (!el.name) return;
      if (el.name === 'started') {
        d.started = el.checked;
        m.render();
        return;
      }
      if (el.name === 'remainingNow') {
        d.remainingNow = parseNum(el.value);
        return;
      }
      d.s[el.name] = el.hasAttribute('data-num') ? (el.value.trim() === '' ? null : parseNum(el.value)) : el.value;
      if (el.name === 'color_hex') {
        const sw = m.q('#spool-color-swatch');
        if (sw) sw.style.background = safeHex(el.value);
      }
      m.update('#spool-summary', summary());
      setFieldError(m.el, el.name, '');
    },
    actions: {
      cancel: (el, e, m) => m.close(),
      preset: (el, e, m) => {
        d.s.color_hex = el.dataset.hex;
        if (!d.s.color_name || COLOR_PRESETS.some(([n]) => n === d.s.color_name)) d.s.color_name = el.dataset.name;
        m.render();
      },
      'weight-preset': (el, e, m) => {
        d.s.initial_weight_g = +el.dataset.w;
        m.render();
      },
      submit: async (el, e, m) => {
        if (d.busy) return;
        Object.assign(d.s, pick(readForm(m.el), ['brand', 'material', 'color_name', 'color_hex', 'price', 'initial_weight_g', 'tare_g', 'purchased_at', 'notes']));
        let bad = false;
        if (!Number.isFinite(d.s.price) || d.s.price < 0) { setFieldError(m.el, 'price', 'Indique le prix payé (0 si offerte).'); bad = true; }
        if (!Number.isFinite(d.s.initial_weight_g) || d.s.initial_weight_g <= 0) { setFieldError(m.el, 'initial_weight_g', 'Poids invalide.'); bad = true; }
        if (d.s.tare_g !== null && (!Number.isFinite(d.s.tare_g) || d.s.tare_g < 0)) { setFieldError(m.el, 'tare_g', 'Tare invalide.'); bad = true; }
        const remaining = d.started ? parseNum(readForm(m.el).remainingNow) : null;
        if (d.started && (!Number.isFinite(remaining) || remaining < 0)) { setFieldError(m.el, 'remainingNow', 'Indique le poids restant.'); bad = true; }
        if (bad) return;
        d.busy = true;
        const payload = {
          ...d.s,
          brand: String(d.s.brand || '').trim(),
          color_name: String(d.s.color_name || '').trim(),
          color_hex: safeHex(d.s.color_hex, '#FFFFFF'),
          price: roundDb(d.s.price, 2),
          initial_weight_g: roundDb(d.s.initial_weight_g, 2),
          tare_g: d.s.tare_g === null ? null : roundDb(d.s.tare_g, 2),
          purchased_at: d.s.purchased_at || null,
          notes: String(d.s.notes || '').trim() || null,
        };
        lsSet('p3d_last_brand', payload.brand);
        const res = await runOp('spool.save', payload, { success: editing ? 'Bobine modifiée' : 'Bobine ajoutée' });
        if (opAccepted(res) && d.started) {
          await runOp('spool.weigh', { id: uuid(), spool_id: payload.id, measured_g: roundDb(remaining, 2), occurred_at: new Date().toISOString(), note: 'Poids restant à l’ajout' }, { success: 'Poids restant enregistré' });
        }
        d.busy = false;
        if (opAccepted(res)) m.close();
      },
    },
  });
}

function openWeighModal(spool) {
  const d = { mode: spool.tare_g ? 'gross' : 'net', gross: null, net: null, tare: spool.tare_g, busy: false };
  const netValue = () => (d.mode === 'gross' ? (Number.isFinite(d.gross) ? d.gross - toNum(d.tare) : NaN) : d.net);
  const preview = () => {
    const V = Store.V;
    const s = V.spools.get(spool.id) || spool;
    const before = toNum(s.remaining_weight_g);
    const after = netValue();
    const ok = Number.isFinite(after) && after >= 0;
    return html`<div class="grid grid-cols-3 items-center gap-2 rounded-2xl border border-white/[0.06] bg-ink-850 p-4 text-center">
      <div><div class="text-[11px] text-slate-500">Selon l'appli</div><div class="font-display text-xl font-bold tabular-nums text-slate-300">${fmtG(before)}</div></div>
      <div class="text-slate-600">${icon('ArrowRight', 'w-5 h-5 mx-auto')}</div>
      <div><div class="text-[11px] text-slate-500">Pesée</div><div class="font-display text-xl font-bold tabular-nums ${ok ? 'text-neon' : 'text-slate-600'}">${ok ? fmtG(after) : '—'}</div></div>
      ${ok ? html`<div class="col-span-3 text-[12px] ${Math.abs(after - before) < 5 ? 'text-slate-500' : 'text-amber-300'}">${Math.abs(after - before) < 0.5 ? 'Identique.' : `Écart de ${fmtG(after - before)} ${after < before ? '(consommation non saisie ?)' : ''}`}</div>` : ''}
    </div>`;
  };
  Modal.open({
    title: 'Peser la bobine',
    subtitle: spoolLabel(spool),
    size: 'sm',
    render: () => ({
      body: html`<div class="space-y-4">
        ${segmented('mode', [{ value: 'gross', label: 'Sur la balance' }, { value: 'net', label: 'Poids net connu' }], d.mode, { action: 'mode', cls: 'w-full [&>button]:flex-1' })}
        ${d.mode === 'gross'
          ? html`${field('Poids affiché par la balance', inputNum('gross', d.gross, { suffix: 'g', placeholder: '890', inputmode: 'numeric', attrs: { autofocus: true } }))}
             ${field('Poids de la bobine vide', inputNum('tare', d.tare, { suffix: 'g', placeholder: '250', inputmode: 'numeric' }), { hint: d.tare ? 'Retenu pour la prochaine pesée.' : 'Indique-le une fois : il sera retenu pour cette bobine.' })}`
          : field('Filament restant (sans la bobine vide)', inputNum('net', d.net, { suffix: 'g', placeholder: '640', inputmode: 'numeric', attrs: { autofocus: true } }))}
        <div id="weigh-preview">${preview()}</div>
        <p class="text-[12px] text-slate-500">La pesée fait foi : les consommations saisies avant elle ne comptent plus, celles d'après sont déduites.</p>
      </div>`,
      footer: html`<div class="flex justify-end gap-2">${btn('Annuler', { variant: 'ghost', action: 'cancel' })}${btn('Enregistrer la pesée', { variant: 'primary', icon: 'Scale', action: 'submit' })}</div>`,
    }),
    onInput: (e, m) => {
      const el = e.target;
      if (!el.name) return;
      d[el.name] = el.value.trim() === '' ? null : parseNum(el.value);
      m.update('#weigh-preview', preview());
    },
    actions: {
      cancel: (el, e, m) => m.close(),
      mode: (el, e, m) => {
        d.mode = el.dataset.value;
        m.render();
      },
      submit: async (el, e, m) => {
        if (d.busy) return;
        const net = netValue();
        if (d.mode === 'gross' && (!Number.isFinite(d.tare) || d.tare < 0)) return setFieldError(m.el, 'tare', 'Indique le poids de la bobine vide.');
        if (!Number.isFinite(net) || net < 0) return setFieldError(m.el, d.mode === 'gross' ? 'gross' : 'net', d.mode === 'gross' && Number.isFinite(d.gross) ? 'Le poids est inférieur à la bobine vide.' : 'Indique un poids.');
        d.busy = true;
        const res = await runOp('spool.weigh', { id: uuid(), spool_id: spool.id, measured_g: roundDb(net, 2), occurred_at: new Date().toISOString() }, { success: `Pesée enregistrée : ${fmtG(net)}` });
        if (opAccepted(res) && d.mode === 'gross' && roundDb(d.tare, 2) !== toNum(spool.tare_g, -1)) {
          await Sync.enqueue('spool.patch', { id: spool.id, fields: { tare_g: roundDb(d.tare, 2) } }, { wait: 0, silent: true });
        }
        d.busy = false;
        if (opAccepted(res)) m.close();
      },
    },
  });
}

function openSpoolHistory(spool) {
  Modal.open({
    title: 'Historique de la bobine',
    subtitle: spoolLabel(spool),
    size: 'md',
    refreshOnStore: (m) => m.render(),
    render: () => {
      const V = Store.V;
      const s = V.spools.get(spool.id) || spool;
      const st = settingsOf(V);
      const moves = valuesOf(V.spool_movements).filter((mv) => mv.spool_id === s.id).sort((a, b) => time(b.occurred_at) - time(a.occurred_at) || time(b.created_at) - time(a.created_at));
      const used = sum(moves.filter((mv) => mv.kind === 'production'), (mv) => -mv.delta_g);
      const wasted = sum(moves.filter((mv) => mv.kind === 'failure'), (mv) => -mv.delta_g);
      return html`<div class="space-y-4">
        <div class="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-ink-850 p-3">
          ${spoolDisc(s.color_hex, spoolPct(s), spoolStatus(s, st), 48)}
          <div class="grid flex-1 grid-cols-3 gap-2 text-center">
            <div><div class="text-[11px] text-slate-500">Restant</div><div class="font-display font-bold tabular-nums text-slate-100">${fmtG(Math.max(0, toNum(s.remaining_weight_g)))}</div></div>
            <div><div class="text-[11px] text-slate-500">Produit</div><div class="font-display font-bold tabular-nums text-neon">${fmtG(used)}</div></div>
            <div><div class="text-[11px] text-slate-500">Raté</div><div class="font-display font-bold tabular-nums text-rose-300">${fmtG(wasted)}</div></div>
          </div>
        </div>
        ${moves.length ? html`<div class="divide-y divide-white/[0.05] rounded-2xl border border-white/[0.06]">${moves.map((mv) => {
          const p = mv.production_id ? V.productions.get(mv.production_id) : null;
          const meta = mv.kind === 'weigh' ? EVENT_META.weigh : mv.kind === 'failure' ? EVENT_META.failure : EVENT_META.production;
          return html`<div class="flex items-center gap-3 px-3 py-2.5">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl ${meta.cls}">${icon(meta.icon, 'w-4 h-4')}</span>
            <span class="min-w-0 flex-1"><span class="block truncate text-sm text-slate-100">${mv.kind === 'weigh' ? 'Pesée' : p ? `${p.item_name} × ${p.quantity}` : 'Production'}</span><span class="block text-[12px] text-slate-500">${fmtDate(mv.occurred_at, 'long')}</span></span>
            <span class="font-display text-sm font-semibold tabular-nums ${mv.kind === 'weigh' ? 'text-slate-300' : 'text-slate-200'}">${mv.kind === 'weigh' ? `= ${fmtG(mv.measured_g)}` : fmtG(mv.delta_g)}</span>
          </div>`;
        })}</div>` : html`<p class="text-[13px] text-slate-500">Aucune consommation ni pesée pour cette bobine.</p>`}
      </div>`;
    },
  });
}
