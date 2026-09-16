/* =============================================================================
   Stock & Ventes : pièces prêtes, ventes, productions
   Actions : lancer une production, print raté, vente, stock existant, retrait
   ============================================================================= */

const STOCK_TABS = [
  { value: 'pieces', label: 'Pièces prêtes' },
  { value: 'ventes', label: 'Ventes' },
  { value: 'productions', label: 'Productions' },
];

VIEWS.stock = {
  render(V, route) {
    const tab = App.ui.stockTab || 'pieces';
    const actions = html`${btn('Production', { variant: 'primary', icon: 'Printer', action: 'st-production' })}${btn('Vente', { icon: 'ShoppingBag', action: 'st-sale' })}${btn('Print raté', { variant: 'ghost', icon: 'Flame', action: 'st-failure' })}`;
    return html`
      ${pageHeader('Stock & Ventes', 'Pièces prêtes à la vente, ventes et productions', actions)}
      <div class="mb-4 overflow-x-auto">${segmented('stockTab', STOCK_TABS, tab)}</div>
      ${tab === 'ventes' ? salesTab(V) : tab === 'productions' ? productionsTab(V) : piecesTab(V)}`;
  },
  mount(V, route) {
    const a = route.params.action;
    if (!a) return;
    history.replaceState(null, '', '#/stock');
    App.route = parseHash();
    if (a === 'production') openProductionModal({ kind: 'production' });
    if (a === 'vente') openSaleModal({});
    if (a === 'rate') openProductionModal({ kind: 'failure' });
  },
};

Actions['st-production'] = () => openProductionModal({ kind: 'production' });
Actions['st-sale'] = () => openSaleModal({});
Actions['st-failure'] = () => openProductionModal({ kind: 'failure' });
Actions['st-add-stock'] = () => openAddStockModal({});

function piecesTab(V) {
  const groups = stockGroups(V);
  const ready = groups.filter((g) => g.qty > 0);
  const empty = groups.filter((g) => g.qty <= 0 && g.template && !g.template.archived);
  const value = sum(ready, (g) => g.value);
  return html`
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm text-slate-400"><span class="font-semibold text-slate-100">${fmtNum(sum(ready, (g) => g.qty))}</span> ${sum(ready, (g) => g.qty) >= 2 ? 'pièces prêtes' : 'pièce prête'} · valeur ${fmtEur(value)}</p>
      ${btn('Stock déjà fabriqué', { size: 'sm', variant: 'ghost', icon: 'PackagePlus', action: 'st-add-stock' })}
    </div>
    ${ready.length ? html`<div class="card divide-y divide-white/[0.05] overflow-hidden">${ready.map((g) => stockRow(V, g))}</div>`
      : emptyCard({ icon: 'Boxes', title: 'Aucune pièce en stock', text: 'Lance une production : les pièces arrivent ici, prêtes à être vendues.', actions: html`${btn('Lancer une production', { variant: 'primary', icon: 'Printer', action: 'st-production' })}${btn('Stock déjà fabriqué', { icon: 'PackagePlus', action: 'st-add-stock' })}` })}
    ${empty.length ? html`<h3 class="mb-2 mt-6 px-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Épuisés</h3>
      <div class="card divide-y divide-white/[0.05] overflow-hidden">${empty.slice(0, 12).map((g) => stockRow(V, g))}</div>` : ''}`;
}

function stockRow(V, g) {
  const t = g.template;
  const pending = g.lots.some((l) => V.pending.has(`production_stock:${l.id}`));
  return html`<div class="flex items-center gap-3 px-3 py-3 sm:px-4">
    <div class="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-ink-850 p-1">${layeredThumb(t ? t.materials : [], t ? t.photo : null)}</div>
    <div class="min-w-0 flex-1">
      <div class="line-clamp-2 text-sm font-semibold leading-snug text-slate-100">${g.item_name}</div>
      <div class="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[12px] text-slate-500">
        <span class="w-full font-semibold tabular-nums sm:hidden ${g.qty > 0 ? 'text-neon' : 'text-slate-500'}">${fmtNum(g.qty)} en stock</span>
        <span>${g.qty > 0 ? `coût moyen ${fmtEur(g.avgCost)}` : `${plural(g.produced, 'produite', 'produites')} au total`}</span>${g.qty > 0 ? html`<span class="hidden sm:inline">· valeur ${fmtEur(g.value)}</span>` : ''}${pending ? html`<span class="text-amber-300">· en attente d’envoi</span>` : ''}
      </div>
    </div>
    <div class="hidden text-right sm:block">
      <div class="font-display text-2xl font-bold tabular-nums ${g.qty > 0 ? 'text-slate-50' : 'text-slate-600'}">${fmtNum(g.qty)}</div>
      <div class="text-[11px] text-slate-500">en stock</div>
    </div>
    <div class="flex shrink-0 gap-1">
      ${g.qty > 0 ? btn('', { size: 'icon', variant: 'primary', icon: 'ShoppingBag', action: 'stock-sell', attrs: { 'data-key': g.key }, title: 'Vendre' }) : g.template_id ? btn('', { size: 'icon', icon: 'Printer', action: 'tpl-produce', attrs: { 'data-id': g.template_id }, title: 'Produire' }) : ''}
      ${btn('', { size: 'icon', variant: 'ghost', icon: 'EllipsisVertical', action: 'stock-menu', attrs: { 'data-key': g.key }, title: 'Plus d’actions' })}
    </div>
  </div>`;
}

const findGroup = (key) => stockGroups(Store.V).find((g) => g.key === key);

Actions['stock-sell'] = (el) => {
  const g = findGroup(el.dataset.key);
  if (g) openSaleModal({ templateId: g.template_id, itemName: g.item_name });
};

Actions['stock-menu'] = (el) => {
  const g = findGroup(el.dataset.key);
  if (!g) return;
  const row = (ic, label, action, tone = 'text-slate-200') => html`<button data-action="${action}" class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] ${tone} hover:bg-white/[0.04]">${icon(ic, 'w-5 h-5 text-slate-400')}${label}</button>`;
  Modal.open({
    title: g.item_name,
    subtitle: `${fmtNum(g.qty)} en stock`,
    size: 'sm',
    render: () => html`<div class="-mx-2">
      ${g.qty > 0 ? row('ShoppingBag', 'Vendre', 'm-sell') : ''}
      ${g.template_id ? row('Printer', 'Produire', 'm-produce') : ''}
      ${row('PackagePlus', 'Ajouter du stock déjà fabriqué', 'm-add')}
      ${g.qty > 0 ? row('PackageMinus', 'Retirer du stock (casse, perte…)', 'm-remove', 'text-amber-200') : ''}
      ${g.lots.length ? row('ListOrdered', 'Voir les lots', 'm-lots') : ''}
    </div>`,
    actions: {
      'm-sell': (b, e, m) => { m.close(); openSaleModal({ templateId: g.template_id, itemName: g.item_name }); },
      'm-produce': (b, e, m) => { m.close(); openProductionModal({ kind: 'production', templateId: g.template_id }); },
      'm-add': (b, e, m) => { m.close(); openAddStockModal({ templateId: g.template_id, itemName: g.item_name }); },
      'm-remove': (b, e, m) => { m.close(); openAdjustStockModal(g); },
      'm-lots': (b, e, m) => { m.close(); openLotsModal(g); },
    },
  });
};

function salesTab(V) {
  const period = App.ui.salesPeriod || 'month';
  const range = periodRange(period);
  const st = settingsOf(V);
  const sales = valuesOf(V.sales).filter((s) => inRange(s.occurred_at, range)).sort((a, b) => time(b.occurred_at) - time(a.occurred_at));
  const revenue = sum(sales, (s) => s.amount);
  const net = sum(sales, (s) => s.net_margin);
  return html`
    <div class="mb-3 flex flex-wrap items-center gap-2">${segmented('salesPeriod', PERIODS, period)}</div>
    <div class="mb-3 grid grid-cols-3 gap-2">
      <div class="card px-3 py-3"><div class="text-[11px] text-slate-500">Encaissé</div><div class="font-display text-lg font-bold tabular-nums text-cyan-200">${fmtEur(revenue)}</div></div>
      <div class="card px-3 py-3"><div class="text-[11px] text-slate-500">Marge nette</div><div class="font-display text-lg font-bold tabular-nums ${net >= 0 ? 'text-neon' : 'text-rose-300'}">${fmtEur(net)}</div></div>
      <div class="card px-3 py-3"><div class="text-[11px] text-slate-500">Ventes</div><div class="font-display text-lg font-bold tabular-nums text-slate-50">${fmtNum(sales.length)}</div></div>
    </div>
    ${sales.length ? html`<div class="card divide-y divide-white/[0.05] overflow-hidden">${sales.map((s) => html`<button data-action="sale-open" data-id="${s.id}" class="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-white/[0.03] sm:px-4">
        <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-cyan-300 bg-cyan-400/10">${icon('ShoppingBag', 'w-5 h-5')}</span>
        <span class="min-w-0 flex-1"><span class="line-clamp-2 text-sm font-medium leading-snug text-slate-100">${saleTitle(V, s)}</span>
          <span class="block truncate text-[12px] text-slate-500">${fmtDate(s.occurred_at, 'short')} · ${channelOf(st, s.channel).name}${s.customer ? ` · ${s.customer}` : ''}</span></span>
        <span class="shrink-0 text-right"><span class="block font-display text-sm font-semibold tabular-nums text-slate-100">${fmtEur(s.amount)}</span>
          <span class="block text-[12px] tabular-nums ${toNum(s.net_margin) >= 0 ? 'text-neon' : 'text-rose-300'}">${fmtEur(s.net_margin, { sign: true })}</span>
          ${V.pending.has(`sales:${s.id}`) ? badge('En attente', 'warn', { dot: true }) : ''}</span>
      </button>`)}</div>`
      : emptyCard({ icon: 'ShoppingBag', title: 'Aucune vente sur la période', text: 'Enregistre une vente : le stock est déstocké et la marge nette calculée.', actions: btn('Enregistrer une vente', { variant: 'primary', icon: 'Plus', action: 'st-sale' }) })}`;
}

function productionsTab(V) {
  const period = App.ui.prodPeriod || 'month';
  const range = periodRange(period);
  const prods = valuesOf(V.productions).filter((p) => inRange(p.occurred_at, range)).sort((a, b) => time(b.occurred_at) - time(a.occurred_at));
  const made = prods.filter((p) => p.kind === 'production');
  const failed = prods.filter((p) => p.kind === 'failure');
  return html`
    <div class="mb-3 flex flex-wrap items-center gap-2">${segmented('prodPeriod', PERIODS, period)}</div>
    <div class="mb-3 grid grid-cols-3 gap-2">
      <div class="card px-3 py-3"><div class="text-[11px] text-slate-500">Pièces produites</div><div class="font-display text-lg font-bold tabular-nums text-slate-50">${fmtNum(sum(made, (p) => p.quantity))}</div></div>
      <div class="card px-3 py-3"><div class="text-[11px] text-slate-500">Filament</div><div class="font-display text-lg font-bold tabular-nums text-slate-50">${fmtKg(sum(prods, (p) => p.grams_total))}</div></div>
      <div class="card px-3 py-3"><div class="text-[11px] text-slate-500">Pertes (ratés)</div><div class="font-display text-lg font-bold tabular-nums ${failed.length ? 'text-rose-300' : 'text-slate-50'}">${fmtEur(sum(failed, (p) => p.total_cost))}</div></div>
    </div>
    ${prods.length ? html`<div class="card divide-y divide-white/[0.05] overflow-hidden">${prods.map((p) => {
      const meta = p.kind === 'failure' ? EVENT_META.failure : EVENT_META.production;
      return html`<button data-action="production-open" data-id="${p.id}" class="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-white/[0.03] sm:px-4">
        <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl ${meta.cls}">${icon(meta.icon, 'w-5 h-5')}</span>
        <span class="min-w-0 flex-1"><span class="line-clamp-2 text-sm font-medium leading-snug text-slate-100">${p.item_name} × ${fmtNum(p.quantity)}</span>
          <span class="block truncate text-[12px] text-slate-500">${fmtDate(p.occurred_at, 'short')} · ${p.kind === 'failure' ? `raté à ${fmtNum(p.failed_pct)} %` : 'production'} · ${fmtG(p.grams_total)}</span></span>
        <span class="shrink-0 text-right"><span class="block font-display text-sm font-semibold tabular-nums ${p.kind === 'failure' ? 'text-rose-300' : 'text-slate-100'}">${fmtEur(p.total_cost)}</span>
          <span class="block text-[12px] text-slate-500">${p.kind === 'failure' ? 'perte' : `${fmtEur(p.unit_cost)} / pièce`}</span>
          ${V.pending.has(`productions:${p.id}`) ? badge('En attente', 'warn', { dot: true }) : ''}</span>
      </button>`;
    })}</div>`
      : emptyCard({ icon: 'Printer', title: 'Aucune production sur la période', text: 'Chaque production déduit le filament des bobines et ajoute les pièces au stock.', actions: btn('Lancer une production', { variant: 'primary', icon: 'Printer', action: 'st-production' }) })}`;
}

Actions['sale-open'] = (el) => openSaleDetails(el.dataset.id);
Actions['production-open'] = (el) => openProductionDetails(el.dataset.id);

/* ---------- lancer une production / déclarer un print raté ---------- */
function openProductionModal({ kind = 'production', templateId = null }) {
  const V0 = Store.V;
  const templates = valuesOf(V0.templates).filter((t) => !t.archived || t.id === templateId).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  if (!templates.length) {
    Modal.open({
      title: kind === 'failure' ? 'Déclarer un print raté' : 'Lancer une production',
      size: 'sm',
      render: () => emptyCard({ icon: 'Layers', title: "Crée d'abord un template", text: 'La production part d’un modèle : matières, grammes et temps.', actions: btn('Nouveau template', { variant: 'primary', icon: 'Plus', action: 'new-tpl' }) }),
      actions: { 'new-tpl': (el, e, m) => { m.close(); openTemplateModal({}); } },
    });
    return;
  }
  const first = (templateId && V0.templates.get(templateId)) || templates[0];
  const d = {
    kind,
    templateId: first.id,
    quantity: kind === 'failure' ? 1 : Math.max(1, toNum(first.pieces_per_print, 1)),
    failedPct: 100,
    reason: FAILURE_REASONS[0],
    machineId: first.machine_id || '',
    spoolIds: null,
    occurredAt: toLocalInput(),
    note: '',
    showMore: false,
    busy: false,
  };

  const currentTemplate = () => Store.V.templates.get(d.templateId) || first;

  const initSpools = () => {
    const V = Store.V;
    const t = currentTemplate();
    const q = Math.max(1, Math.round(toNum(d.quantity, 1)));
    const lines = Array.isArray(t.materials) ? t.materials : [];
    const gramsModel = sum(lines, (l) => l.grams);
    d.spoolIds = lines.map((l) => {
      const need = (toNum(l.grams) + (gramsModel > 0 ? toNum(t.purge_g) * (toNum(l.grams) / gramsModel) : 0)) * q;
      const s = suggestSpool(V, l, need);
      return s ? s.id : null;
    });
  };
  initSpools();

  const plan = () => planProduction(Store.V, {
    template: currentTemplate(),
    kind: d.kind,
    quantity: d.quantity,
    failedPct: d.failedPct,
    machineId: d.machineId || null,
    spoolIds: d.spoolIds,
    // date non modifiée : heure exacte de la validation (la saisie ne va qu'à la minute)
    occurredAt: d.dateEdited ? fromLocalInput(d.occurredAt) : new Date().toISOString(),
    note: d.note,
    reason: d.reason,
  });

  const summaryBlock = () => {
    const { payload: p, warnings } = plan();
    const isFail = d.kind === 'failure';
    return html`<div class="rounded-2xl border ${isFail ? 'border-rose-500/20 bg-rose-500/[0.04]' : 'border-neon/20 bg-neon/[0.04]'} p-4">
      <div class="flex items-end justify-between gap-3">
        <div><div class="text-[12px] font-medium text-slate-400">${isFail ? 'Perte enregistrée' : 'Coût de revient total'}</div>
          <div class="font-display text-3xl font-bold tabular-nums ${isFail ? 'text-rose-300' : 'text-slate-50'}">${fmtEur(p.total_cost)}</div></div>
        ${isFail ? '' : html`<div class="text-right"><div class="text-[12px] text-slate-400">par pièce</div><div class="font-display text-xl font-bold tabular-nums text-neon">${fmtEur(p.unit_cost)}</div></div>`}
      </div>
      <div class="mt-3 grid grid-cols-2 gap-x-4">
        ${statRow('Filament', fmtG(p.grams_total))}
        ${statRow('Temps machine', fmtDuration(p.print_time_min_total))}
        ${statRow('Matière + purge', fmtEur(p.material_cost + p.purge_cost))}
        ${statRow('Machine', fmtEur(p.machine_cost))}
        ${isFail ? '' : statRow('Quincaillerie', fmtEur(p.hardware_cost))}
        ${isFail ? '' : statRow("Main-d'œuvre", fmtEur(p.labor_cost))}
      </div>
      ${warnings.length ? html`<div class="mt-3 space-y-1.5">${warnings.map((w) => html`<p class="flex gap-2 text-[12px] text-amber-200">${icon('TriangleAlert', 'w-4 h-4 shrink-0')}<span>${w.type === 'spool_short'
        ? `Il reste ${fmtG(Math.max(0, w.have))} sur « ${spoolLabel(w.spool)} », il en faut ${fmtG(w.need)}. C'est enregistré quand même : pèse la bobine ensuite.`
        : `Pas de bobine pour ${w.line.material} ${w.line.color_name || ''} : coût moyen utilisé, rien n'est déduit.`}</span></p>`)}</div>` : ''}
    </div>`;
  };

  const spoolsBlock = () => {
    const V = Store.V;
    const t = currentTemplate();
    const lines = Array.isArray(t.materials) ? t.materials : [];
    if (!lines.length) return html`<p class="text-[13px] text-slate-500">Ce template n'a aucune matière : seuls le temps machine et la main-d'œuvre sont comptés.</p>`;
    const q = Math.max(1, Math.round(toNum(d.quantity, 1)));
    const k = d.kind === 'failure' ? clamp(toNum(d.failedPct, 100), 1, 100) / 100 : 1;
    const gramsModel = sum(lines, (l) => l.grams);
    return html`<div class="space-y-2">${lines.map((l, i) => {
      const need = (toNum(l.grams) + (gramsModel > 0 ? (toNum(t.purge_g) * toNum(l.grams)) / gramsModel : 0)) * q * k;
      const cands = candidateSpools(V, l, { needGrams: need });
      const opts = [{ value: '', label: 'Aucune (coût moyen, rien déduit)' }, ...cands.map((c) => ({ value: c.spool.id, label: `${c.close ? '● ' : ''}${c.spool.color_name || 'Sans nom'}${c.spool.brand ? ` · ${c.spool.brand}` : ''} — ${fmtG(Math.max(0, toNum(c.spool.remaining_weight_g)))}${c.enough ? '' : ' ⚠'}` }))];
      const chosen = d.spoolIds[i];
      if (chosen && !cands.some((c) => c.spool.id === chosen)) {
        const s = V.spools.get(chosen);
        if (s) opts.push({ value: s.id, label: `${spoolLabel(s)} — ${fmtG(s.remaining_weight_g)}` });
      }
      const s = chosen ? V.spools.get(chosen) : null;
      return html`<div class="rounded-2xl border border-white/[0.06] bg-ink-850 p-3">
        <div class="mb-2 flex items-center justify-between gap-2">
          <span class="flex min-w-0 items-center gap-2 text-sm text-slate-200"><span class="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-white/20" style="background:${safeHex(l.color_hex)}"></span><span class="truncate">${l.material} ${l.color_name || ''}</span></span>
          <span class="font-display text-sm font-semibold tabular-nums text-slate-100">${fmtG(need)}</span>
        </div>
        ${selectInput('spool', opts, chosen || '', { attrs: { 'data-line': i } })}
        ${s ? html`<div class="mt-1.5 flex items-center justify-between text-[12px]"><span class="text-slate-500">Après : ${fmtG(toNum(s.remaining_weight_g) - need)}</span>${toNum(s.remaining_weight_g) - need < settingsOf(V).spool_critical_g ? html`<span class="text-amber-300">bobine presque vide</span>` : ''}</div>` : ''}
      </div>`;
    })}</div>`;
  };

  Modal.open({
    title: kind === 'failure' ? 'Déclarer un print raté' : 'Lancer une production',
    subtitle: kind === 'failure' ? 'Le filament est déduit, la perte comptée, aucun stock créé' : 'Le filament est déduit et les pièces ajoutées au stock',
    size: 'lg',
    render: () => {
      const t = currentTemplate();
      const V = Store.V;
      const isFail = d.kind === 'failure';
      return {
        body: html`<div class="grid gap-5 lg:grid-cols-2">
          <div class="space-y-4">
            ${field('Template', selectInput('templateId', templates.map((x) => ({ value: x.id, label: x.archived ? `${x.name} (archivé)` : x.name })), d.templateId))}
            <div class="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-ink-850 p-3">
              <div class="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-ink-900 p-1">${layeredThumb(t.materials, t.photo)}</div>
              <div class="min-w-0 flex-1 text-[12px] text-slate-400"><div class="truncate text-sm font-semibold text-slate-100">${t.name}</div>${fmtG(templateCost(V, t).grams)} · ${fmtDuration(t.print_time_min)} par pièce · stock actuel ${fmtNum(stockForTemplate(V, t.id))}</div>
            </div>
            <div>
              <span class="label">${isFail ? 'Pièces ratées' : 'Quantité de pièces'}</span>
              <div class="flex items-center gap-2">
                ${btn('', { size: 'icon', icon: 'Minus', action: 'qty-minus', title: 'Moins' })}
                ${inputNum('quantity', d.quantity, { placeholder: '1', inputmode: 'numeric', cls: 'w-24 [&_input]:text-center [&_input]:font-display [&_input]:text-lg' })}
                ${btn('', { size: 'icon', icon: 'Plus', action: 'qty-plus', title: 'Plus' })}
                ${toNum(t.pieces_per_print) > 1 && !isFail ? html`<span class="text-[12px] text-slate-500">${fmtNum(toNum(d.quantity) / toNum(t.pieces_per_print), 1)} plateau(x)</span>` : ''}
              </div>
            </div>
            ${isFail ? html`<div>
              <div class="flex items-center justify-between"><span class="label">Arrêté à</span><span class="font-display text-sm font-semibold text-rose-300" id="pct-label">${fmtNum(d.failedPct)} %</span></div>
              <input type="range" name="failedPct" min="5" max="100" step="5" value="${d.failedPct}" class="range w-full"/>
              <p class="mt-1 text-[12px] text-slate-500">Seule la part imprimée est déduite (filament et temps machine).</p>
            </div>
            <div><span class="label">Cause</span><div class="flex flex-wrap gap-1.5">${FAILURE_REASONS.map((r) => html`<button data-action="reason" data-value="${r}" class="chip ${d.reason === r ? 'chip-active' : ''}">${r}</button>`)}</div></div>` : ''}
            ${field('Machine', selectInput('machineId', machineOptions(V, d.machineId), d.machineId))}
            <details class="rounded-2xl border border-white/[0.06] bg-ink-850 p-3" ${d.showMore ? raw('open') : ''}>
              <summary class="cursor-pointer list-none text-sm text-slate-300">Date et note <span class="text-slate-500">· ${fmtDate(fromLocalInput(d.occurredAt), 'long')}</span></summary>
              <div class="mt-3 space-y-3">
                ${field('Date et heure', html`<input class="input" type="datetime-local" name="occurredAt" value="${d.occurredAt}"/>`)}
                ${field('Note', inputText('note', d.note, { placeholder: 'Commande, réglages…', maxlength: 1000 }))}
              </div>
            </details>
          </div>
          <div class="space-y-4">
            <div><h3 class="section-title mb-2">Bobines utilisées</h3><div id="prod-spools">${spoolsBlock()}</div></div>
            <div id="prod-summary">${summaryBlock()}</div>
          </div>
        </div>`,
        footer: html`<div class="flex justify-end gap-2">${btn('Annuler', { variant: 'ghost', action: 'cancel' })}${btn(isFail ? 'Enregistrer le print raté' : 'Lancer la production', { variant: isFail ? 'danger' : 'primary', icon: isFail ? 'Flame' : 'Printer', action: 'submit' })}</div>`,
      };
    },
    onInput: (e, m) => {
      const el = e.target;
      const name = el.name;
      if (!name) return;
      if (name === 'templateId' && e.type === 'change') {
        d.templateId = el.value;
        const t = currentTemplate();
        d.machineId = t.machine_id || '';
        if (d.kind === 'production') d.quantity = Math.max(1, toNum(t.pieces_per_print, 1));
        initSpools();
        m.render();
        return;
      }
      if (name === 'quantity') {
        const q = parseNum(el.value);
        d.quantity = Number.isFinite(q) ? Math.max(1, Math.round(q)) : 1;
      } else if (name === 'failedPct') {
        d.failedPct = +el.value;
        const lbl = m.q('#pct-label');
        if (lbl) lbl.textContent = `${d.failedPct} %`;
      } else if (name === 'spool') {
        d.spoolIds[+el.dataset.line] = el.value || null;
      } else if (name === 'machineId') {
        d.machineId = el.value;
      } else if (name === 'occurredAt') {
        d.occurredAt = el.value;
        d.dateEdited = el.value !== toLocalInput();
        d.showMore = true;
      } else if (name === 'note') {
        d.note = el.value;
        d.showMore = true;
        return;
      }
      if (e.type === 'change' || name === 'failedPct' || name === 'quantity') {
        m.update('#prod-spools', spoolsBlock());
      }
      m.update('#prod-summary', summaryBlock());
    },
    actions: {
      cancel: (el, e, m) => m.close(),
      'qty-minus': (el, e, m) => {
        d.quantity = Math.max(1, Math.round(toNum(d.quantity, 1)) - 1);
        m.render();
      },
      'qty-plus': (el, e, m) => {
        d.quantity = Math.round(toNum(d.quantity, 1)) + 1;
        m.render();
      },
      reason: (el, e, m) => {
        d.reason = el.dataset.value;
        m.render();
      },
      submit: async (el, e, m) => {
        if (d.busy) return;
        const q = Math.round(toNum(d.quantity, 0));
        if (!(q >= 1)) return setFieldError(m.el, 'quantity', 'Au moins 1 pièce.');
        d.busy = true;
        el.disabled = true;
        const { payload } = plan();
        const t = currentTemplate();
        const res = await runOp('production.launch', payload, {
          success: d.kind === 'failure'
            ? `Print raté enregistré : ${fmtEur(payload.total_cost)} de perte`
            : `Production enregistrée : ${t.name} +${fmtNum(q)} en stock`,
        });
        d.busy = false;
        el.disabled = false;
        if (opAccepted(res)) m.close();
      },
    },
  });
}

/* ---------- enregistrer une vente ---------- */
function openSaleModal({ templateId = null, itemName = null }) {
  const V0 = Store.V;
  const st0 = settingsOf(V0);
  const priceFor = (V, tid) => {
    const t = tid ? V.templates.get(tid) : null;
    return t ? templatePrice(V, t).price : null;
  };
  const initialGroup = stockGroups(V0).find((g) => (templateId ? g.template_id === templateId : itemName && !g.template_id && g.item_name === itemName));
  const tpl = templateId ? V0.templates.get(templateId) : null;
  const firstItem = initialGroup || tpl
    ? { key: uuid(), from_stock: true, template_id: templateId || null, item_name: initialGroup ? initialGroup.item_name : tpl.name, quantity: 1, unit_price: priceFor(V0, templateId), unit_cost: null }
    : { key: uuid(), from_stock: true, template_id: null, item_name: '', quantity: 1, unit_price: null, unit_cost: null };
  const d = {
    id: uuid(),
    items: [firstItem],
    channel: lsGet('p3d_last_channel', 'direct'),
    customer: '',
    note: '',
    shipping_charged: null,
    shipping_cost: null,
    packaging_cost: null,
    platform_fee: null,
    feeTouched: false,
    occurredAt: toLocalInput(),
    busy: false,
  };
  if (!st0.sales_channels.some((c) => c.id === d.channel)) d.channel = st0.sales_channels[0].id;

  const form = () => ({
    id: d.id,
    channel: d.channel,
    customer: d.customer,
    note: d.note,
    occurred_at: d.dateEdited ? fromLocalInput(d.occurredAt) : new Date().toISOString(),
    shipping_charged: toNum(d.shipping_charged),
    shipping_cost: toNum(d.shipping_cost),
    packaging_cost: toNum(d.packaging_cost),
    platform_fee: toNum(d.platform_fee),
    items: d.items.map((i) => ({ ...i, id: i.key, unit_price: toNum(i.unit_price), unit_cost: toNum(i.unit_cost) })),
  });

  const autoFee = () => {
    if (d.feeTouched) return;
    const V = Store.V;
    const p = planSale(V, { ...form(), platform_fee: 0 });
    const fee = channelFee(settingsOf(V), d.channel, p.amount);
    d.platform_fee = fee > 0 ? fee : null;
  };
  autoFee();

  const summaryBlock = () => {
    const V = Store.V;
    const p = planSale(V, form());
    const tone = p.net >= 0 ? 'text-neon' : 'text-rose-300';
    return html`<div class="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4">
      ${statRow('Articles', fmtEur(p.itemsTotal))}
      ${toNum(d.shipping_charged) > 0 ? statRow('Port payé par le client', `+ ${fmtEur(d.shipping_charged)}`) : ''}
      ${statRow('Encaissé', fmtEur(p.amount), { strong: true, tone: 'text-cyan-200' })}
      <div class="my-2 border-t border-white/[0.06]"></div>
      ${statRow('Coût de revient des pièces', `− ${fmtEur(p.cogs)}`, { tone: 'text-slate-300' })}
      ${toNum(d.shipping_cost) > 0 ? statRow('Port payé', `− ${fmtEur(d.shipping_cost)}`, { tone: 'text-slate-300' }) : ''}
      ${toNum(d.packaging_cost) > 0 ? statRow('Emballage', `− ${fmtEur(d.packaging_cost)}`, { tone: 'text-slate-300' }) : ''}
      ${toNum(d.platform_fee) > 0 ? statRow('Commission', `− ${fmtEur(d.platform_fee)}`, { tone: 'text-slate-300' }) : ''}
      <div class="mt-2 flex items-end justify-between border-t border-white/[0.06] pt-3">
        <div><div class="text-[12px] font-medium text-slate-400">Marge nette réelle</div><div class="font-display text-3xl font-bold tabular-nums ${tone}">${fmtEur(p.net)}</div></div>
        <div class="text-right font-display text-lg font-semibold tabular-nums ${tone}">${fmtPct(p.marginPct)}</div>
      </div>
      ${p.shortages.length ? html`<div class="mt-3 space-y-1">${p.shortages.map((s) => html`<p class="flex gap-2 text-[12px] text-rose-200">${icon('CircleAlert', 'w-4 h-4 shrink-0')}Stock insuffisant pour « ${s.item_name} » : il manque ${plural(s.shortage, 'pièce', 'pièces')}.</p>`)}</div>` : ''}
    </div>`;
  };

  const itemsBlock = () => {
    const V = Store.V;
    const groups = stockGroups(V).filter((g) => g.qty > 0);
    return html`<div class="space-y-2">${d.items.map((it, i) => {
      if (!it.from_stock) {
        return html`<div class="rounded-2xl border border-violet-400/20 bg-violet-500/[0.04] p-3">
          <div class="mb-2 flex items-center justify-between"><span class="text-[12px] font-semibold text-violet-200">Pièce sur mesure (hors stock)</span>${d.items.length > 1 ? btn('', { size: 'icon', variant: 'ghost', icon: 'X', action: 'item-remove', attrs: { 'data-i': i }, title: 'Retirer', cls: 'h-8 w-8' }) : ''}</div>
          ${inputText('item_name', it.item_name, { placeholder: 'Description de la pièce', attrs: { 'data-i': i } })}
          <div class="mt-2 grid grid-cols-3 gap-2">
            ${field('Quantité', inputNum('quantity', it.quantity, { placeholder: '1', inputmode: 'numeric', attrs: { 'data-i': i } }))}
            ${field('Prix unitaire', inputNum('unit_price', it.unit_price, { suffix: '€', attrs: { 'data-i': i } }))}
            ${field('Coût unitaire', inputNum('unit_cost', it.unit_cost, { suffix: '€', attrs: { 'data-i': i } }))}
          </div>
        </div>`;
      }
      const keyOf = (g) => g.key;
      const cur = groups.find((g) => (it.template_id ? g.template_id === it.template_id : !g.template_id && g.item_name === it.item_name));
      const opts = [{ value: '', label: groups.length ? 'Choisir une pièce en stock…' : 'Aucune pièce en stock' }, ...groups.map((g) => ({ value: keyOf(g), label: `${g.item_name} — ${fmtNum(g.qty)} en stock` }))];
      if (it.item_name && !cur) opts.push({ value: '__missing', label: `${it.item_name} — 0 en stock`, disabled: true });
      return html`<div class="rounded-2xl border border-white/[0.06] bg-ink-850 p-3">
        <div class="flex items-center gap-2">
          ${selectInput('stock_key', opts, cur ? cur.key : it.item_name ? '__missing' : '', { attrs: { 'data-i': i }, cls: 'min-w-0 flex-1' })}
          ${d.items.length > 1 ? btn('', { size: 'icon', variant: 'ghost', icon: 'X', action: 'item-remove', attrs: { 'data-i': i }, title: 'Retirer' }) : ''}
        </div>
        <div class="mt-2 grid grid-cols-2 gap-2">
          ${field('Quantité', inputNum('quantity', it.quantity, { placeholder: '1', inputmode: 'numeric', attrs: { 'data-i': i } }))}
          ${field('Prix unitaire encaissé', inputNum('unit_price', it.unit_price, { suffix: '€', attrs: { 'data-i': i } }))}
        </div>
        ${!cur && it.template_id ? html`<p class="mt-2 text-[12px] text-amber-300">Aucune pièce en stock pour ce modèle. ${raw(`<button class="underline" data-action="produce-first" data-tid="${esc(it.template_id)}">Lancer une production</button>`)} ou vends-la « sur mesure ».</p>` : ''}
      </div>`;
    })}
      <div class="flex flex-wrap gap-2">${btn('Ajouter une pièce du stock', { size: 'sm', variant: 'ghost', icon: 'Plus', action: 'item-add' })}${btn('Pièce sur mesure', { size: 'sm', variant: 'ghost', icon: 'Sparkles', action: 'item-custom' })}</div>
    </div>`;
  };

  Modal.open({
    title: 'Enregistrer une vente',
    subtitle: 'Le stock est déstocké, la marge nette calculée',
    size: 'lg',
    render: () => {
      const st = settingsOf(Store.V);
      return {
        body: html`<div class="grid gap-5 lg:grid-cols-2">
          <div class="space-y-4">
            <div><h3 class="section-title mb-2">Articles</h3><div id="sale-items">${itemsBlock()}</div></div>
            <div><span class="label">Canal de vente</span><div class="flex flex-wrap gap-1.5">${st.sales_channels.map((c) => html`<button data-action="channel" data-value="${c.id}" class="chip ${d.channel === c.id ? 'chip-active' : ''}">${c.name}${toNum(c.pct) > 0 || toNum(c.fixed) > 0 ? html`<span class="text-slate-500"> · ${toNum(c.pct) > 0 ? `${fmtNum(c.pct, 1)} %` : ''}${toNum(c.pct) > 0 && toNum(c.fixed) > 0 ? ' + ' : ''}${toNum(c.fixed) > 0 ? fmtEur(c.fixed) : ''}</span>` : ''}</button>`)}</div></div>
            <div class="grid grid-cols-2 gap-3">
              ${field('Port payé par toi', inputNum('shipping_cost', d.shipping_cost, { suffix: '€', placeholder: '0,00' }))}
              ${field('Carton / emballage', inputNum('packaging_cost', d.packaging_cost, { suffix: '€', placeholder: '0,00' }))}
              ${field('Commission plateforme', inputNum('platform_fee', d.platform_fee, { suffix: '€', placeholder: '0,00' }), { hint: d.feeTouched ? 'Saisie manuelle.' : 'Calculée selon le canal (modifiable).' })}
              ${field('Port facturé au client', inputNum('shipping_charged', d.shipping_charged, { suffix: '€', placeholder: '0,00' }), { hint: 'Ajouté à l’encaissé.' })}
            </div>
            <details class="rounded-2xl border border-white/[0.06] bg-ink-850 p-3">
              <summary class="cursor-pointer list-none text-sm text-slate-300">Client, date et note <span class="text-slate-500">· ${fmtDate(fromLocalInput(d.occurredAt), 'long')}</span></summary>
              <div class="mt-3 space-y-3">
                ${field('Client (optionnel)', inputText('customer', d.customer, { placeholder: 'Prénom, pseudo, n° de commande…' }))}
                ${field('Date et heure', html`<input class="input" type="datetime-local" name="occurredAt" value="${d.occurredAt}"/>`)}
                ${field('Note', inputText('note', d.note, { placeholder: 'Remarque', maxlength: 1000 }))}
              </div>
            </details>
          </div>
          <div id="sale-summary" class="lg:sticky lg:top-0 lg:self-start">${summaryBlock()}</div>
        </div>`,
        footer: html`<div class="flex justify-end gap-2">${btn('Annuler', { variant: 'ghost', action: 'cancel' })}${btn('Enregistrer la vente', { variant: 'primary', icon: 'Check', action: 'submit' })}</div>`,
      };
    },
    onInput: (e, m) => {
      const el = e.target;
      const name = el.name;
      if (!name) return;
      const num = () => (el.value.trim() === '' ? null : parseNum(el.value));
      if (el.dataset.i !== undefined) {
        const it = d.items[+el.dataset.i];
        if (!it) return;
        if (name === 'stock_key') {
          if (e.type !== 'change') return;
          const g = stockGroups(Store.V).find((x) => x.key === el.value);
          if (g) {
            it.template_id = g.template_id;
            it.item_name = g.item_name;
            const price = priceFor(Store.V, g.template_id);
            if (price !== null) it.unit_price = price;
          }
          autoFee();
          m.render();
          return;
        }
        if (name === 'item_name') it.item_name = el.value;
        if (name === 'quantity') it.quantity = num();
        if (name === 'unit_price') it.unit_price = num();
        if (name === 'unit_cost') it.unit_cost = num();
      } else if (name === 'platform_fee') {
        d.platform_fee = num();
        d.feeTouched = true;
      } else if (['shipping_cost', 'packaging_cost', 'shipping_charged'].includes(name)) {
        d[name] = num();
      } else if (name === 'customer' || name === 'note' || name === 'occurredAt') {
        d[name] = el.value;
        if (name === 'occurredAt') d.dateEdited = el.value !== toLocalInput();
        return;
      }
      if (name !== 'platform_fee') {
        const before = d.platform_fee;
        autoFee();
        if (before !== d.platform_fee) {
          const feeInput = m.q('input[name="platform_fee"]');
          if (feeInput && document.activeElement !== feeInput) feeInput.value = d.platform_fee === null ? '' : String(d.platform_fee).replace('.', ',');
        }
      }
      m.update('#sale-summary', summaryBlock());
    },
    actions: {
      cancel: (el, e, m) => m.close(),
      channel: (el, e, m) => {
        d.channel = el.dataset.value;
        d.feeTouched = false;
        autoFee();
        m.render();
      },
      'item-add': (el, e, m) => {
        d.items.push({ key: uuid(), from_stock: true, template_id: null, item_name: '', quantity: 1, unit_price: null, unit_cost: null });
        m.render();
      },
      'item-custom': (el, e, m) => {
        const blank = d.items.length === 1 && !d.items[0].item_name;
        const item = { key: uuid(), from_stock: false, template_id: null, item_name: '', quantity: 1, unit_price: null, unit_cost: null };
        if (blank) d.items = [item];
        else d.items.push(item);
        m.render();
      },
      'item-remove': (el, e, m) => {
        d.items.splice(+el.dataset.i, 1);
        autoFee();
        m.render();
      },
      'produce-first': (el, e, m) => {
        m.close();
        openProductionModal({ kind: 'production', templateId: el.dataset.tid });
      },
      submit: async (el, e, m) => {
        if (d.busy) return;
        const V = Store.V;
        const items = d.items.filter((it) => String(it.item_name || '').trim());
        if (!items.length) return toast('Choisis au moins une pièce à vendre.', { tone: 'bad' });
        for (const it of items) {
          if (!(Math.round(toNum(it.quantity)) >= 1)) return toast(`Quantité invalide pour « ${it.item_name} ».`, { tone: 'bad' });
          if (!Number.isFinite(it.unit_price) || it.unit_price < 0) return toast(`Indique le prix encaissé pour « ${it.item_name} ».`, { tone: 'bad' });
          if (!it.from_stock && it.unit_cost !== null && (!Number.isFinite(it.unit_cost) || it.unit_cost < 0)) return toast('Coût unitaire invalide.', { tone: 'bad' });
        }
        for (const k of ['shipping_cost', 'packaging_cost', 'platform_fee', 'shipping_charged']) {
          if (d[k] !== null && (!Number.isFinite(d[k]) || d[k] < 0)) return setFieldError(m.el, k, 'Montant invalide.');
        }
        const p = planSale(V, { ...form(), items: items.map((i) => ({ ...i, id: i.key, unit_price: toNum(i.unit_price), unit_cost: toNum(i.unit_cost) })) });
        if (p.shortages.length) return toast(`Stock insuffisant pour « ${p.shortages[0].item_name} ».`, { tone: 'bad' });
        d.busy = true;
        el.disabled = true;
        lsSet('p3d_last_channel', d.channel);
        const res = await Sync.enqueue('sale.record', p.payload);
        d.busy = false;
        el.disabled = false;
        if (res.state === 'confirmed') {
          const sale = Store.V.sales.get(p.payload.id);
          toast(`Marge nette ${fmtEur(sale ? sale.net_margin : p.net)} sur ${fmtEur(sale ? sale.amount : p.amount)}`, { tone: 'ok', title: 'Vente enregistrée' });
          m.close();
        } else if (res.state === 'queued') {
          toast("Pas de connexion : la vente est gardée sur cet appareil et partira automatiquement.", { tone: 'warn', title: "En attente d'envoi" });
          m.close();
        } else {
          toast(res.error.message, { tone: 'bad', title: res.state === 'failed' ? 'Refusée par la base' : 'Non enregistrée' });
        }
      },
    },
  });
}

/* ---------- détails ---------- */
function openSaleDetails(id) {
  Modal.open({
    title: 'Détail de la vente',
    size: 'md',
    refreshOnStore: (m) => {
      if (!Store.V.sales.get(id)) m.close();
      else m.render();
    },
    render: () => {
      const V = Store.V;
      const s = V.sales.get(id);
      if (!s) return html`<p class="text-sm text-slate-400">Cette vente n'existe plus.</p>`;
      const st = settingsOf(V);
      const items = saleItemsOf(V, s.id);
      const allocs = valuesOf(V.sale_allocations);
      const pending = V.pending.has(`sales:${s.id}`);
      return {
        body: html`<div class="space-y-4">
          <div class="flex flex-wrap items-center gap-2 text-[13px] text-slate-400">${fmtDate(s.occurred_at, 'long')} · ${badge(channelOf(st, s.channel).name, 'info')}${s.customer ? html`<span>· ${s.customer}</span>` : ''}${pending ? badge('En attente d’envoi', 'warn', { dot: true }) : ''}</div>
          <div class="divide-y divide-white/[0.05] rounded-2xl border border-white/[0.06]">${items.map((i) => {
            const lots = allocs.filter((a) => a.sale_item_id === i.id);
            return html`<div class="px-3 py-2.5">
              <div class="flex items-center justify-between gap-2"><span class="text-sm text-slate-100">${i.quantity} × ${i.item_name}</span><span class="font-display text-sm font-semibold tabular-nums text-slate-100">${fmtEur(i.quantity * i.unit_price)}</span></div>
              <div class="text-[12px] text-slate-500">${fmtEur(i.unit_price)} / pièce · coût de revient ${fmtEur(i.cogs)}${i.from_stock ? '' : ' · sur mesure'}</div>
              ${lots.length ? html`<div class="mt-1 text-[11px] text-slate-600">Pris dans : ${lots.map((a) => {
                const lot = V.production_stock.get(a.lot_id);
                return `${a.quantity} du ${lot ? fmtDate(lot.occurred_at, 'short') : 'lot supprimé'} (${fmtEur(a.unit_cost)})`;
              }).join(', ')}</div>` : ''}
            </div>`;
          })}</div>
          <div class="rounded-2xl border border-white/[0.06] bg-ink-850 p-4">
            ${statRow('Encaissé', fmtEur(s.amount), { strong: true, tone: 'text-cyan-200' })}
            ${toNum(s.shipping_charged) > 0 ? statRow('dont port facturé', fmtEur(s.shipping_charged), { tone: 'text-slate-400' }) : ''}
            ${statRow('Coût de revient', `− ${fmtEur(s.cogs)}`)}
            ${statRow('Port payé', `− ${fmtEur(s.shipping_cost)}`)}
            ${statRow('Emballage', `− ${fmtEur(s.packaging_cost)}`)}
            ${statRow('Commission', `− ${fmtEur(s.platform_fee)}`)}
            <div class="mt-2 border-t border-white/[0.06] pt-2">${statRow('Marge nette réelle', fmtEur(s.net_margin), { strong: true, tone: toNum(s.net_margin) >= 0 ? 'text-neon' : 'text-rose-300' })}</div>
          </div>
          ${s.note ? html`<p class="text-[13px] text-slate-400">Note : ${s.note}</p>` : ''}
        </div>`,
        footer: html`<div class="flex justify-between gap-2">${btn('Supprimer la vente', { variant: 'danger', icon: 'Trash2', action: 'delete' })}${btn('Fermer', { action: 'close' })}</div>`,
      };
    },
    actions: {
      close: (el, e, m) => m.close(),
      delete: async (el, e, m) => {
        const ok = await confirmBox({ title: 'Supprimer cette vente ?', message: 'Les pièces reviennent dans le stock et la vente disparaît des statistiques.', confirm: 'Supprimer la vente' });
        if (!ok) return;
        const res = await runOp('sale.delete', { id }, { success: 'Vente supprimée, pièces remises en stock' });
        if (opAccepted(res)) m.close();
      },
    },
  });
}

function openProductionDetails(id) {
  Modal.open({
    title: 'Détail de la production',
    size: 'md',
    refreshOnStore: (m) => {
      if (!Store.V.productions.get(id)) m.close();
      else m.render();
    },
    render: () => {
      const V = Store.V;
      const p = V.productions.get(id);
      if (!p) return html`<p class="text-sm text-slate-400">Cette production n'existe plus.</p>`;
      const lot = valuesOf(V.production_stock).find((l) => l.production_id === p.id);
      const sold = lot ? sum(valuesOf(V.sale_allocations).filter((a) => a.lot_id === lot.id), (a) => a.quantity) : 0;
      const isFail = p.kind === 'failure';
      const machine = p.machine_id ? V.machines.get(p.machine_id) : null;
      return {
        body: html`<div class="space-y-4">
          <div class="flex flex-wrap items-center gap-2 text-[13px] text-slate-400">${badge(isFail ? 'Print raté' : 'Production', isFail ? 'bad' : 'ok')}<span>${fmtDate(p.occurred_at, 'long')}</span>${V.pending.has(`productions:${p.id}`) ? badge('En attente d’envoi', 'warn', { dot: true }) : ''}</div>
          <div class="rounded-2xl border border-white/[0.06] bg-ink-850 p-4">
            <div class="font-semibold text-slate-100">${p.item_name} × ${fmtNum(p.quantity)}</div>
            <div class="text-[12px] text-slate-500">${isFail ? `arrêté à ${fmtNum(p.failed_pct)} %${p.failure_reason ? ` · ${p.failure_reason}` : ''}` : `${fmtEur(p.unit_cost)} par pièce`} · ${machine ? machine.name : `machine à ${fmtNum(p.machine_rate, 2)} €/h`}</div>
            ${lot ? html`<div class="mt-2 text-[13px] text-slate-300">${fmtNum(lot.qty_available)} en stock · ${plural(sold, 'vendue', 'vendues')}${lot.quantity - lot.qty_available - sold > 0 ? ` · ${plural(lot.quantity - lot.qty_available - sold, 'retirée', 'retirées')}` : ''}</div>` : ''}
          </div>
          <div><h3 class="section-title mb-2">Filament consommé</h3>
            <div class="divide-y divide-white/[0.05] rounded-2xl border border-white/[0.06]">${(p.consumption || []).map((c) => html`<div class="flex items-center gap-3 px-3 py-2.5">
              <span class="h-4 w-4 shrink-0 rounded-full ring-1 ring-white/20" style="background:${safeHex(c.color_hex)}"></span>
              <span class="min-w-0 flex-1 truncate text-sm text-slate-200">${c.material} ${c.color_name || ''}${c.spool_id ? '' : html` <span class="text-[12px] text-slate-500">(sans bobine)</span>`}</span>
              <span class="text-right"><span class="block font-display text-sm font-semibold tabular-nums text-slate-100">${fmtG(c.grams)}</span><span class="block text-[11px] text-slate-500">${fmtEur(toNum(c.grams) * toNum(c.cost_per_g))}</span></span>
            </div>`)}${!(p.consumption || []).length ? html`<p class="px-3 py-2.5 text-[13px] text-slate-500">Aucun filament.</p>` : ''}</div>
          </div>
          <div class="rounded-2xl border border-white/[0.06] bg-ink-850 p-4">
            ${statRow('Matière', fmtEur(p.material_cost))}
            ${statRow('Purge', fmtEur(p.purge_cost))}
            ${statRow('Quincaillerie', fmtEur(p.hardware_cost))}
            ${statRow(`Machine (${fmtDuration(p.print_time_min_total)})`, fmtEur(p.machine_cost))}
            ${statRow(`Main-d'œuvre (${fmtNum(p.labor_min_total)} min)`, fmtEur(p.labor_cost))}
            <div class="mt-2 border-t border-white/[0.06] pt-2">${statRow(isFail ? 'Perte totale' : 'Coût total', fmtEur(p.total_cost), { strong: true, tone: isFail ? 'text-rose-300' : 'text-slate-50' })}</div>
          </div>
          ${p.note ? html`<p class="text-[13px] text-slate-400">Note : ${p.note}</p>` : ''}
          ${sold > 0 ? html`<p class="text-[12px] text-slate-500">Des pièces de ce lot ont été vendues : pour annuler cette production, supprime d'abord ces ventes.</p>` : ''}
        </div>`,
        footer: html`<div class="flex justify-between gap-2">${sold > 0 ? html`<span></span>` : btn(isFail ? 'Supprimer' : 'Annuler la production', { variant: 'danger', icon: 'Undo2', action: 'delete' })}${btn('Fermer', { action: 'close' })}</div>`,
      };
    },
    actions: {
      close: (el, e, m) => m.close(),
      delete: async (el, e, m) => {
        const ok = await confirmBox({ title: 'Annuler cette production ?', message: 'Le filament est rendu aux bobines, les pièces retirées du stock et le coût retiré des statistiques.', confirm: 'Annuler la production' });
        if (!ok) return;
        const res = await runOp('production.delete', { id }, { success: 'Production annulée, filament rendu aux bobines' });
        if (opAccepted(res)) m.close();
      },
    },
  });
}

/* ---------- stock déjà fabriqué ---------- */
function openAddStockModal({ templateId = null, itemName = null }) {
  const V0 = Store.V;
  // le template demandé est proposé même s'il est archivé : la liste affiche toujours celui qui recevra le stock
  const templates = valuesOf(V0.templates).filter((t) => !t.archived || t.id === templateId).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const t0 = templateId ? V0.templates.get(templateId) : null;
  const d = {
    mode: t0 ? 'template' : itemName ? 'free' : templates.length ? 'template' : 'free',
    templateId: t0 ? t0.id : !itemName && templates[0] ? templates[0].id : null,
    itemName: itemName || '',
    quantity: 1,
    unitCost: null,
    occurredAt: toLocalInput(),
    note: '',
    busy: false,
  };
  const defaultCost = () => {
    const t = d.templateId ? Store.V.templates.get(d.templateId) : null;
    return t ? roundDb(templateCost(Store.V, t).total, 2) : null;
  };
  d.unitCost = d.mode === 'template' ? defaultCost() : null;
  Modal.open({
    title: 'Ajouter du stock déjà fabriqué',
    subtitle: "Pièces existantes : aucun filament n'est déduit",
    size: 'sm',
    render: () => ({
      body: html`<div class="space-y-4">
        ${templates.length ? segmented('mode', [{ value: 'template', label: 'Depuis un template' }, { value: 'free', label: 'Autre pièce' }], d.mode, { action: 'mode', cls: 'w-full [&>button]:flex-1' }) : ''}
        ${d.mode === 'template'
          ? field('Template', selectInput('templateId', templates.map((t) => ({ value: t.id, label: t.archived ? `${t.name} (archivé)` : t.name })), d.templateId))
          : field('Nom de la pièce', inputText('itemName', d.itemName, { placeholder: 'Pièce' }))}
        <div class="grid grid-cols-2 gap-3">
          ${field('Quantité', inputNum('quantity', d.quantity, { inputmode: 'numeric', placeholder: '1' }))}
          ${field('Coût unitaire', inputNum('unitCost', d.unitCost, { suffix: '€', placeholder: '0,00' }), { hint: d.mode === 'template' ? 'Prérempli avec le coût actuel.' : '' })}
        </div>
        ${field('Date', html`<input class="input" type="datetime-local" name="occurredAt" value="${d.occurredAt}"/>`)}
        ${field('Note', inputText('note', d.note, { placeholder: 'Stock initial, retour client…', maxlength: 1000 }))}
      </div>`,
      footer: html`<div class="flex justify-end gap-2">${btn('Annuler', { variant: 'ghost', action: 'cancel' })}${btn('Ajouter au stock', { variant: 'primary', icon: 'PackagePlus', action: 'submit' })}</div>`,
    }),
    onInput: (e, m) => {
      const el = e.target;
      if (!el.name) return;
      if (el.name === 'templateId') {
        d.templateId = el.value;
        if (e.type === 'change') {
          d.unitCost = defaultCost();
          m.render();
        }
        return;
      }
      d[el.name] = el.hasAttribute('data-num') ? (el.value.trim() === '' ? null : parseNum(el.value)) : el.value;
      if (el.name === 'occurredAt') d.dateEdited = el.value !== toLocalInput();
    },
    actions: {
      cancel: (el, e, m) => m.close(),
      mode: (el, e, m) => {
        d.mode = el.dataset.value;
        d.unitCost = d.mode === 'template' ? defaultCost() : null;
        m.render();
      },
      submit: async (el, e, m) => {
        if (d.busy) return;
        const t = d.mode === 'template' && d.templateId ? Store.V.templates.get(d.templateId) : null;
        const name = t ? t.name : String(d.itemName || '').trim();
        if (!name) return setFieldError(m.el, 'itemName', 'Nom obligatoire.');
        const q = Math.round(toNum(d.quantity, 0));
        if (!(q >= 1)) return setFieldError(m.el, 'quantity', 'Au moins 1.');
        if (d.unitCost !== null && (!Number.isFinite(d.unitCost) || d.unitCost < 0)) return setFieldError(m.el, 'unitCost', 'Coût invalide.');
        d.busy = true;
        const occurredAt = d.dateEdited ? fromLocalInput(d.occurredAt) : new Date().toISOString();
        const res = await runOp('stock.add', { id: uuid(), template_id: t ? t.id : null, item_name: name, unit_cost: roundDb(toNum(d.unitCost), 4), quantity: q, note: String(d.note || '').trim() || null, occurred_at: occurredAt }, { success: `${name} : +${fmtNum(q)} en stock` });
        d.busy = false;
        if (opAccepted(res)) m.close();
      },
    },
  });
}

function openAdjustStockModal(group) {
  const d = { quantity: 1, reason: 'casse', note: '', busy: false };
  Modal.open({
    title: 'Retirer du stock',
    subtitle: `${group.item_name} · ${fmtNum(group.qty)} en stock`,
    size: 'sm',
    render: () => ({
      body: html`<div class="space-y-4">
        ${field('Quantité à retirer', inputNum('quantity', d.quantity, { inputmode: 'numeric', placeholder: '1' }))}
        <div><span class="label">Raison</span><div class="flex flex-wrap gap-1.5">${Object.entries(ADJUST_REASONS).map(([k, v]) => html`<button data-action="reason" data-value="${k}" class="chip ${d.reason === k ? 'chip-active' : ''}">${v}</button>`)}</div></div>
        ${field('Note', inputText('note', d.note, { placeholder: 'Précision (optionnel)', maxlength: 500 }))}
        <p class="text-[12px] text-slate-500">Les pièces les plus anciennes sont retirées en premier. Leur coût est compté comme une perte.</p>
      </div>`,
      footer: html`<div class="flex justify-end gap-2">${btn('Annuler', { variant: 'ghost', action: 'cancel' })}${btn('Retirer', { variant: 'danger', icon: 'PackageMinus', action: 'submit' })}</div>`,
    }),
    onInput: (e) => {
      const el = e.target;
      if (el.name === 'quantity') d.quantity = parseNum(el.value);
      if (el.name === 'note') d.note = el.value;
    },
    actions: {
      cancel: (el, e, m) => m.close(),
      reason: (el, e, m) => {
        d.reason = el.dataset.value;
        m.render();
      },
      submit: async (el, e, m) => {
        if (d.busy) return;
        const q = Math.round(toNum(d.quantity, 0));
        if (!(q >= 1) || q > group.qty) return setFieldError(m.el, 'quantity', `Entre 1 et ${group.qty}.`);
        d.busy = true;
        const res = await runOp('stock.adjust', { id: uuid(), template_id: group.template_id, item_name: group.item_name, quantity: q, reason: d.reason, note: String(d.note || '').trim() || null, occurred_at: new Date().toISOString() }, { success: `${plural(q, 'pièce retirée', 'pièces retirées')} du stock` });
        d.busy = false;
        if (opAccepted(res)) m.close();
      },
    },
  });
}

function openLotsModal(group) {
  Modal.open({
    title: 'Lots en stock',
    subtitle: `${group.item_name} · les plus anciens partent en premier`,
    size: 'sm',
    render: () => html`<div class="divide-y divide-white/[0.05] rounded-2xl border border-white/[0.06]">${group.lots.map((l) => html`<div class="flex items-center justify-between gap-3 px-3 py-2.5">
      <span><span class="block text-sm text-slate-100">${fmtDate(l.occurred_at, 'day')}</span><span class="block text-[12px] text-slate-500">${l.production_id ? 'production' : 'stock ajouté'} · ${fmtEur(l.unit_cost)} / pièce</span></span>
      <span class="font-display text-lg font-bold tabular-nums text-slate-100">${fmtNum(l.qty_available)}<span class="text-[12px] font-normal text-slate-500"> / ${fmtNum(l.quantity)}</span></span>
    </div>`)}</div>`,
  });
}
