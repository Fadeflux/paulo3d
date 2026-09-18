/* =============================================================================
   Templates : catalogue, calculateur de coût de revient, import Bambu Studio
   ============================================================================= */

VIEWS.templates = {
  render(V) {
    const st = settingsOf(V);
    const q = normalizeText(App.ui.tplQ || '');
    const all = valuesOf(V.templates);
    const archivedCount = all.filter((t) => t.archived).length;
    // plus aucun archivé (le dernier vient d'être réactivé ou supprimé) : retour au catalogue, sinon la
    // liste resterait vide sans bouton pour revenir (le choix « Archivés » est masqué quand il n'y en a pas)
    const showArchived = App.ui.tplArchived === 'yes' && archivedCount > 0;
    let list = all.filter((t) => !!t.archived === showArchived);
    if (q) list = list.filter((t) => normalizeText(`${t.name} ${t.description || ''}`).includes(q));
    list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return html`
      ${pageHeader('Templates', `${fmtNum(all.length - archivedCount)} modèle${all.length - archivedCount > 1 ? 's' : ''} au catalogue`, btn('Nouveau template', { variant: 'primary', icon: 'Plus', action: 'tpl-new' }))}
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <div class="relative min-w-[12rem] flex-1">
          <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">${icon('Search', 'w-4 h-4')}</span>
          <input class="input pl-9" placeholder="Rechercher un modèle…" value="${App.ui.tplQ || ''}" data-page-input="tpl-search" data-keep="tpl-search" autocomplete="off"/>
        </div>
        ${archivedCount ? segmented('tplArchived', [{ value: 'no', label: 'Catalogue' }, { value: 'yes', label: `Archivés (${archivedCount})` }], showArchived ? 'yes' : 'no') : ''}
      </div>
      ${list.length ? html`<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">${list.map((t) => templateCard(V, t, st))}</div>`
        : all.length
          ? emptyCard({ icon: 'SearchX', title: 'Aucun modèle trouvé', text: 'Essaie une autre recherche.' })
          : emptyCard({
            icon: 'Layers',
            title: 'Crée ton premier template',
            text: 'Dépose le fichier exporté de Bambu Studio : nom, grammes par couleur et temps sont remplis tout seuls.',
            actions: btn('Nouveau template', { variant: 'primary', icon: 'FileUp', action: 'tpl-new' }),
          })}`;
  },
};

function templateCard(V, t, st) {
  const p = templatePrice(V, t, st);
  const stock = stockForTemplate(V, t.id);
  const marginTone = p.margin.pct === null ? 'text-slate-300' : p.margin.pct >= 50 ? 'text-neon' : p.margin.pct >= 20 ? 'text-amber-300' : 'text-rose-300';
  return html`<article class="card flex flex-col overflow-hidden ${t.archived ? 'opacity-70' : ''}">
    <button data-action="tpl-edit" data-id="${t.id}" class="relative block h-36 overflow-hidden bg-ink-850" aria-label="Modifier ${t.name}">
      <div class="absolute inset-0 p-3">${layeredThumb(t.materials, t.photo)}</div>
      <div class="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink-900 to-transparent"></div>
      <div class="absolute right-3 top-3">${stock > 0 ? badge(`${fmtNum(stock)} en stock`, 'ok') : badge('Pas de stock', 'off')}</div>
      ${pendingBadge(V, `templates:${t.id}`) ? html`<div class="absolute left-3 top-3">${pendingBadge(V, `templates:${t.id}`)}</div>` : ''}
    </button>
    <div class="flex flex-1 flex-col p-4">
      <div class="flex items-start justify-between gap-2">
        <h3 class="line-clamp-2 font-semibold leading-snug text-slate-100">${t.name}</h3>
        ${btn('', { variant: 'ghost', size: 'iconSm', icon: 'EllipsisVertical', action: 'tpl-menu', attrs: { 'data-id': t.id }, title: 'Plus d’actions', cls: '-mr-2 -mt-1 shrink-0' })}
      </div>
      <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-slate-400">
        ${colorDots(t.materials)}<span>${fmtG(p.cost.grams)}</span><span class="text-slate-600">·</span><span>${fmtDuration(t.print_time_min)}</span>${toNum(t.labor_min) > 0 ? html`<span class="text-slate-600">·</span><span>${fmtNum(t.labor_min)} min finition</span>` : ''}
      </div>
      <div class="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-white/[0.03] p-2.5 text-center">
        <div><div class="text-[11px] text-slate-500">Coût</div><div class="font-display text-[15px] font-semibold tabular-nums text-slate-100">${fmtEur(p.cost.total)}</div></div>
        <div><div class="text-[11px] text-slate-500">${p.fixed ? 'Prix' : 'Conseillé'}</div><div class="font-display text-[15px] font-semibold tabular-nums text-slate-100">${fmtEur(p.price)}</div></div>
        <div><div class="text-[11px] text-slate-500">Marge</div><div class="font-display text-[15px] font-semibold tabular-nums ${marginTone}">${fmtPct(p.margin.pct, 0)}</div></div>
      </div>
      <div class="mt-auto flex gap-2 pt-3">
        ${t.archived ? btn('Réactiver', { size: 'sm', icon: 'ArchiveRestore', action: 'tpl-unarchive', attrs: { 'data-id': t.id }, cls: 'flex-1' })
          : html`${btn('Produire', { size: 'sm', variant: 'primary', icon: 'Printer', action: 'tpl-produce', attrs: { 'data-id': t.id }, cls: 'flex-1' })}${btn('Vendre', { size: 'sm', icon: 'ShoppingBag', action: 'tpl-sell', attrs: { 'data-id': t.id }, cls: 'flex-1' })}`}
      </div>
    </div>
  </article>`;
}

Actions['tpl-new'] = () => openTemplateModal({});
Actions['tpl-edit'] = (el) => {
  const t = Store.V.templates.get(el.dataset.id);
  if (t) openTemplateModal({ template: t });
};
Actions['tpl-produce'] = (el) => openProductionModal({ kind: 'production', templateId: el.dataset.id });
Actions['tpl-sell'] = (el) => openSaleModal({ templateId: el.dataset.id });
Actions['tpl-unarchive'] = async (el) => {
  const t = Store.V.templates.get(el.dataset.id);
  if (t) await runOp('template.patch', { id: t.id, fields: { archived: false } }, { success: 'Template réactivé' });
};
Actions['tpl-search'] = debounce((el) => {
  App.ui.tplQ = el.value;
  App.render();
}, 150);

Actions['tpl-menu'] = (el) => {
  const t = Store.V.templates.get(el.dataset.id);
  if (!t) return;
  const row = (ic, label, action, tone = 'text-slate-200') => html`<button data-action="${action}" class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] ${tone} hover:bg-white/[0.04]">${icon(ic, 'w-5 h-5 text-slate-400')}${label}</button>`;
  Modal.open({
    title: t.name,
    size: 'sm',
    render: () => html`<div class="-mx-2">
      ${row('Pencil', 'Modifier', 'm-edit')}
      ${row('Printer', 'Lancer une production', 'm-produce')}
      ${row('ShoppingBag', 'Enregistrer une vente', 'm-sell')}
      ${row('Flame', 'Déclarer un print raté', 'm-fail')}
      ${row('PackagePlus', 'Ajouter du stock déjà fabriqué', 'm-stock')}
      ${row('Copy', 'Dupliquer', 'm-dup')}
      ${row(t.archived ? 'ArchiveRestore' : 'Archive', t.archived ? 'Réactiver' : 'Archiver', 'm-archive')}
      ${row('Trash2', 'Supprimer', 'm-delete', 'text-rose-300')}
    </div>`,
    actions: {
      'm-edit': (b, e, m) => { m.close(); openTemplateModal({ template: t }); },
      'm-produce': (b, e, m) => { m.close(); openProductionModal({ kind: 'production', templateId: t.id }); },
      'm-sell': (b, e, m) => { m.close(); openSaleModal({ templateId: t.id }); },
      'm-fail': (b, e, m) => { m.close(); openProductionModal({ kind: 'failure', templateId: t.id }); },
      'm-stock': (b, e, m) => { m.close(); openAddStockModal({ templateId: t.id }); },
      'm-dup': (b, e, m) => { m.close(); openTemplateModal({ template: t, duplicate: true }); },
      'm-archive': async (b, e, m) => {
        m.close();
        await runOp('template.patch', { id: t.id, fields: { archived: !t.archived } }, { success: t.archived ? 'Template réactivé' : 'Template archivé' });
      },
      'm-delete': async (b, e, m) => {
        m.close();
        const ok = await confirmBox({
          title: 'Supprimer ce template ?',
          message: `« ${t.name} » disparaît du catalogue. L'historique (productions, stock, ventes) est conservé sous son nom. Pour simplement le ranger, archive-le.`,
          confirm: 'Supprimer',
        });
        if (ok) await runOp('template.delete', { id: t.id }, { success: 'Template supprimé' });
      },
    },
  });
};

function newMaterialLine(V, prev) {
  const spools = activeSpools(V);
  const first = spools.find((s) => !prev.some((l) => l.spool_id === s.id)) || null;
  return first
    ? { material: first.material, color_name: first.color_name, color_hex: safeHex(first.color_hex), grams: null, spool_id: first.id }
    : { material: 'PLA', color_name: '', color_hex: '#FFFFFF', grams: null, spool_id: null };
}

function openTemplateModal({ template = null, duplicate = false }) {
  const V0 = Store.V;
  const editing = template && !duplicate;
  const t = template
    ? JSON.parse(JSON.stringify(pick(template, TEMPLATE_FIELDS)))
    : { name: '', description: '', photo: null, machine_id: defaultMachine(V0) ? defaultMachine(V0).id : null, pieces_per_print: 1, materials: [], purge_g: 0, hardware_cost: 0, print_time_min: 0, labor_min: 0, pricing_mode: null, price_coef: null, target_margin_pct: null, catalog_price: null, archived: false };
  if (!editing) {
    t.id = uuid();
    t.archived = false;
    if (duplicate) t.name = `${template.name} (copie)`.slice(0, 120);
  }
  if (!Array.isArray(t.materials)) t.materials = [];
  if (!t.materials.length) t.materials.push(newMaterialLine(V0, []));
  const d = { t, imp: { mode: 'file', text: '', result: null, error: '', busy: false, pieces: 1, plate: null }, purgeIncluded: false, busy: false };

  const numbers = () => {
    const V = Store.V;
    const st = settingsOf(V);
    const cost = templateCost(V, d.t, st);
    const pr = pricingOf(d.t, st);
    const sug = suggestPrice(cost.total, pr);
    const price = d.t.catalog_price !== null && d.t.catalog_price !== undefined && Number.isFinite(d.t.catalog_price) ? d.t.catalog_price : null;
    return { st, cost, pr, sug, price, mi: marginInfo(price === null ? sug.rounded : price, cost.total) };
  };

  const costCard = () => {
    const { st, cost } = numbers();
    const parts = [
      { label: 'Matière', value: cost.material, color: COST_COLORS.material },
      { label: 'Purge', value: cost.purge, color: COST_COLORS.purge },
      { label: 'Quincaillerie', value: cost.hardware, color: COST_COLORS.hardware },
      { label: 'Machine', value: cost.machine, color: COST_COLORS.machine },
      { label: "Main-d'œuvre", value: cost.labor, color: COST_COLORS.labor },
    ];
    return html`<div class="rounded-2xl border border-white/[0.06] bg-ink-850 p-4">
      <div class="text-[12px] font-medium text-slate-400">Coût de revient par pièce</div>
      <div class="mt-1 font-display text-4xl font-bold tabular-nums tracking-tight text-slate-50">${fmtEur(cost.total)}</div>
      <div class="mt-3">${costBar(parts)}</div>
      <div class="mt-3 space-y-0.5">${parts.map((p) => html`<div class="flex items-center justify-between text-[13px]"><span class="flex items-center gap-2 text-slate-400"><span class="h-2 w-2 rounded-sm" style="background:${p.color}"></span>${p.label}${p.label === 'Machine' ? html`<span class="text-slate-600">(${fmtNum(cost.rate, 2)} €/h)</span>` : p.label === "Main-d'œuvre" ? html`<span class="text-slate-600">(${fmtNum(st.labor_rate, 2)} €/h)</span>` : ''}</span><span class="tabular-nums text-slate-200">${fmtEur(p.value)}</span></div>`)}</div>
      <div class="mt-2 border-t border-white/[0.06] pt-2 text-[12px] text-slate-500">${fmtG(cost.grams)} de filament par pièce${cost.purgeG > 0 ? ` dont ${fmtG(cost.purgeG)} de purge` : ''}</div>
      ${cost.lines.some((l) => l.source === 'default') ? html`<p class="mt-2 text-[12px] text-amber-300">Aucune bobine ne correspond à une matière : prix par défaut (${fmtNum(st.filament_price_kg, 2)} €/kg).</p>` : ''}
    </div>`;
  };

  const pricingControls = () => {
    const priceModeKey = d.t.pricing_mode || 'global';
    return html`<div class="mt-2">${segmented('pricing', [{ value: 'global', label: 'Réglage global' }, { value: 'coef', label: 'Coefficient' }, { value: 'margin', label: 'Marge brute' }], priceModeKey, { action: 'pricing-mode', cls: 'w-full [&>button]:flex-1 [&>button]:px-1' })}</div>
      ${priceModeKey === 'coef' ? html`<div class="mt-3">${field('Coefficient', inputNum('price_coef', d.t.price_coef, { suffix: '×', placeholder: '2,5' }))}</div>` : ''}
      ${priceModeKey === 'margin' ? html`<div class="mt-3">${field('Marge brute visée', inputNum('target_margin_pct', d.t.target_margin_pct, { suffix: '%', placeholder: '65' }))}</div>` : ''}`;
  };

  const suggestion = () => {
    const { st, pr, sug } = numbers();
    return html`<div class="mt-3 flex items-end justify-between gap-3">
      <div><div class="font-display text-2xl font-bold tabular-nums text-cyan-300">${fmtEur(sug.rounded)}</div><div class="text-[12px] text-slate-500">${pr.mode === 'margin' ? `marge ${fmtNum(pr.marginPct, 1)} %` : `coût × ${fmtNum(pr.coef, 2)}`} = ${fmtEur(sug.raw)}${st.price_rounding !== 'none' ? ', arrondi' : ''}</div></div>
      ${btn('Utiliser', { size: 'sm', action: 'use-suggested', icon: 'ArrowDown' })}
    </div>`;
  };

  const marginTiles = () => {
    const { mi, price } = numbers();
    return html`<p class="mt-1 text-[12px] text-slate-500">${price === null ? 'Vide : le prix conseillé est utilisé.' : 'Prix fixé pour ce produit.'}</p>
      <div class="mt-3 grid grid-cols-3 gap-2 text-center">
        <div class="rounded-xl bg-white/[0.04] py-2"><div class="text-[11px] text-slate-500">Marge</div><div class="font-display font-semibold tabular-nums ${mi.eur >= 0 ? 'text-neon' : 'text-rose-300'}">${fmtEur(mi.eur)}</div></div>
        <div class="rounded-xl bg-white/[0.04] py-2"><div class="text-[11px] text-slate-500">Taux</div><div class="font-display font-semibold tabular-nums text-slate-100">${fmtPct(mi.pct)}</div></div>
        <div class="rounded-xl bg-white/[0.04] py-2"><div class="text-[11px] text-slate-500">Coef.</div><div class="font-display font-semibold tabular-nums text-slate-100">${mi.coef === null ? '—' : `× ${fmtNum(mi.coef, 2)}`}</div></div>
      </div>`;
  };

  // Les champs de saisie ne sont jamais redessinés pendant la frappe : seuls les chiffres calculés le sont
  const summary = () => html`<div class="space-y-4">
    <div id="tpl-cost">${costCard()}</div>
    <div class="rounded-2xl border border-white/[0.06] bg-ink-850 p-4">
      <span class="text-[12px] font-medium text-slate-400">Prix de vente conseillé</span>
      <div id="tpl-pricing">${pricingControls()}</div>
      <div id="tpl-suggest">${suggestion()}</div>
    </div>
    <div class="rounded-2xl border border-neon/20 bg-neon/[0.04] p-4">
      ${field('Prix catalogue (fixé)', inputNum('catalog_price', d.t.catalog_price, { suffix: '€', placeholder: fmtNum(numbers().sug.rounded, 2) }))}
      <div id="tpl-margin">${marginTiles()}</div>
    </div>
  </div>`;

  const refreshNumbers = (m) => {
    m.update('#tpl-cost', costCard());
    m.update('#tpl-suggest', suggestion());
    m.update('#tpl-margin', marginTiles());
    const cat = m.q('input[name="catalog_price"]');
    if (cat) cat.placeholder = fmtNum(numbers().sug.rounded, 2);
  };

  const importPanel = () => {
    const imp = d.imp;
    const res = imp.result;
    const plate = res && res.plates ? res.plates.find((p) => p.index === imp.plate) || res.plates[0] : res;
    return html`<div id="import-zone" class="rounded-2xl border border-dashed border-neon/30 bg-neon/[0.03] p-4 transition">
      <div class="flex items-center gap-3">
        <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-neon/10 text-neon">${icon('FileUp', 'w-5 h-5')}</span>
        <div class="min-w-0"><div class="font-semibold text-slate-100">Import rapide Bambu Studio</div><div class="text-[12px] text-slate-400">Dépose le fichier <b class="text-slate-300">.gcode.3mf</b> ou <b class="text-slate-300">.gcode</b>, ou colle un récapitulatif</div></div>
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <label class="btn btn-secondary h-9 cursor-pointer rounded-lg px-3 text-[13px]">${icon('Upload', 'w-4 h-4')}<span>Choisir un fichier</span><input type="file" name="import_file" accept=".3mf,.gcode,.gco,.g" class="sr-only"/></label>
        ${btn(imp.mode === 'text' ? 'Masquer le texte' : 'Coller un texte', { size: 'sm', variant: 'ghost', icon: 'ClipboardPaste', action: 'import-text' })}
      </div>
      ${imp.mode === 'text' ? html`<div class="mt-3 space-y-2">
        <textarea class="input h-28 py-2 font-mono text-[13px]" name="import_text" placeholder="Support Manette Universel&#10;Poids : 45,2 g&#10;Temps d'impression : 2h35">${imp.text}</textarea>
        ${btn('Analyser', { size: 'sm', variant: 'primary', icon: 'Sparkles', action: 'import-parse' })}
      </div>` : ''}
      ${imp.busy ? html`<div class="mt-3 flex items-center gap-2 text-[13px] text-slate-300">${icon('LoaderCircle', 'w-4 h-4 animate-spin')}Lecture du fichier…</div>` : ''}
      ${imp.error ? html`<div class="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-[13px] text-rose-200">${imp.error}</div>` : ''}
      ${res ? html`<div class="mt-3 rounded-xl border border-white/[0.08] bg-ink-900 p-3">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0"><div class="truncate font-semibold text-slate-100">${res.name || 'Sans nom'}</div><div class="text-[12px] text-slate-400">${Number.isFinite(plate.timeMin) ? fmtDuration(plate.timeMin) : 'temps inconnu'} · ${fmtG(sum(plate.filaments || [], (f) => f.grams))}${res.purgeIncluded ? ' · purge incluse' : ''}</div></div>
          ${res.thumbnails && res.thumbnails[plate.index || 1] ? html`<img src="${res.thumbnails[plate.index || 1]}" alt="" class="h-14 w-14 rounded-lg bg-ink-850 object-contain"/>` : ''}
        </div>
        <div class="mt-2 flex flex-wrap gap-1.5">${(plate.filaments || []).map((f) => html`<span class="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[12px] text-slate-300"><span class="h-3 w-3 rounded-full" style="background:${safeHex(f.color)}"></span>${f.type} · ${fmtNum(f.grams, 1)} g</span>`)}</div>
        ${(res.warnings || []).map((w) => html`<p class="mt-2 text-[12px] text-amber-300">${w}</p>`)}
        <div class="mt-3 grid grid-cols-2 gap-2">
          ${res.plates && res.plates.length > 1 ? field('Plaque', selectInput('import_plate', res.plates.map((p) => ({ value: p.index, label: `Plaque ${p.index} · ${fmtG(sum(p.filaments, (f) => f.grams))}` })), imp.plate || res.plates[0].index)) : ''}
          ${field('Pièces sur le plateau', inputNum('import_pieces', imp.pieces, { placeholder: '1', inputmode: 'numeric' }), { hint: 'Les valeurs seront divisées par ce nombre.' })}
        </div>
        <div class="mt-3">${btn('Remplir la fiche', { variant: 'primary', icon: 'Wand', action: 'import-apply', size: 'sm' })}</div>
      </div>` : ''}
    </div>`;
  };

  const materialsBlock = () => {
    const V = Store.V;
    const knownMaterials = [...new Set([...MATERIALS, ...valuesOf(V.spools).map((x) => x.material), ...d.t.materials.map((l) => l.material)])];
    return html`<div class="space-y-2">${d.t.materials.map((l, i) => {
      const cands = candidateSpools(V, l);
      const opts = [{ value: '', label: 'Aucune bobine (prix moyen)' }, ...cands.map((c) => ({ value: c.spool.id, label: `${c.close ? '● ' : ''}${c.spool.color_name || 'Sans nom'}${c.spool.brand ? ` · ${c.spool.brand}` : ''} — ${fmtG(Math.max(0, toNum(c.spool.remaining_weight_g)))}` }))];
      if (l.spool_id && !cands.some((c) => c.spool.id === l.spool_id)) {
        const s = V.spools.get(l.spool_id);
        opts.push({ value: l.spool_id, label: s ? `${spoolLabel(s)}${s.archived ? ' (archivée)' : ''}` : 'Bobine supprimée' });
      }
      return html`<div class="rounded-2xl border border-white/[0.06] bg-ink-850 p-3">
        <div class="flex items-center gap-2">
          <label class="relative h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-white/10" style="background:${safeHex(l.color_hex)}">
            <input type="color" name="m_color_hex" data-line="${i}" value="${safeHex(l.color_hex)}" class="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Couleur"/>
          </label>
          ${selectInput('m_material', knownMaterials.map((m) => ({ value: m, label: m })), l.material, { attrs: { 'data-line': i }, cls: 'w-32 shrink-0' })}
          ${inputNum('m_grams', l.grams, { suffix: 'g', placeholder: 'Grammes', cls: 'flex-1', attrs: { 'data-line': i } })}
          ${d.t.materials.length > 1 ? btn('', { variant: 'ghost', size: 'icon', icon: 'X', action: 'line-remove', attrs: { 'data-line': i }, title: 'Retirer cette matière', cls: 'shrink-0' }) : ''}
        </div>
        <div class="mt-2 grid gap-2 sm:grid-cols-2">
          ${inputText('m_color_name', l.color_name, { placeholder: 'Nom de la couleur', maxlength: 60, attrs: { 'data-line': i } })}
          ${selectInput('m_spool', opts, l.spool_id || '', { attrs: { 'data-line': i } })}
        </div>
      </div>`;
    })}</div>`;
  };

  // Affichage h + min à partir des minutes ARRONDIES (119,7 min → 2 h 00, jamais « 1 h 60 »)
  const timeTotal = () => Math.max(0, Math.round(toNum(d.t.print_time_min)));
  const timeH = () => Math.floor(timeTotal() / 60);
  const timeM = () => timeTotal() - timeH() * 60;

  const handleImportFile = async (file, m) => {
    if (!file) return;
    d.imp = { ...d.imp, busy: true, error: '', result: null };
    m.render();
    try {
      const res = await parseSlicerFile(file);
      d.imp.result = res;
      d.imp.pieces = Number.isFinite(res.pieces) && res.pieces > 0 ? res.pieces : 1;
      d.imp.plate = res.plateIndex || null;
    } catch (e) {
      d.imp.error = e && e.message ? e.message : 'Fichier illisible.';
    }
    d.imp.busy = false;
    m.render();
  };

  Modal.open({
    title: editing ? 'Modifier le template' : duplicate ? 'Dupliquer le template' : 'Nouveau template',
    subtitle: 'Toutes les valeurs sont par pièce',
    size: 'xl',
    render: (m) => ({
      body: html`<div class="grid gap-5 lg:grid-cols-5">
        <div class="space-y-5 lg:col-span-3">
          ${importPanel()}
          <section class="space-y-3">
            <h3 class="section-title">Informations</h3>
            <div class="flex gap-3">
              <div class="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-ink-850 p-2">${layeredThumb(d.t.materials, d.t.photo)}</div>
              <div class="min-w-0 flex-1 space-y-2">
                ${field('Nom du produit', inputText('name', d.t.name, { placeholder: 'Support Manette Universel', attrs: editing ? null : { autofocus: true } }))}
                <div class="flex flex-wrap gap-2">
                  <label class="btn btn-ghost h-8 cursor-pointer rounded-lg px-2.5 text-[12px]">${icon('ImagePlus', 'w-4 h-4')}<span>${d.t.photo ? 'Changer la photo' : 'Ajouter une photo'}</span><input type="file" name="photo_file" accept="image/*" class="sr-only"/></label>
                  ${d.t.photo ? btn('Retirer', { size: 'sm', variant: 'ghost', action: 'photo-remove', cls: 'h-8 text-[12px]' }) : ''}
                </div>
              </div>
            </div>
            ${field('Description (optionnel)', html`<textarea class="input h-16 py-2" name="description" maxlength="2000" placeholder="Dimensions, variantes, remarques…">${d.t.description || ''}</textarea>`)}
          </section>

          <section class="space-y-3">
            <div class="flex items-center justify-between"><h3 class="section-title">Matières (multi-couleurs / AMS)</h3>${btn('Ajouter', { size: 'sm', variant: 'ghost', icon: 'Plus', action: 'line-add' })}</div>
            <div id="materials-block">${materialsBlock()}</div>
            ${d.purgeIncluded ? html`<p class="rounded-xl bg-cyan-400/10 p-2.5 text-[12px] text-cyan-200">Bambu Studio compte déjà la purge et la tour dans les grammes de chaque couleur : laisse la purge à 0.</p>` : ''}
            <div class="grid grid-cols-2 gap-3">
              ${field('Purge / tour de purge', inputNum('purge_g', d.t.purge_g, { suffix: 'g', placeholder: '0' }), { hint: 'Répartie sur les couleurs.' })}
              ${field('Quincaillerie & finitions', inputNum('hardware_cost', d.t.hardware_cost, { suffix: '€', placeholder: '0,00' }), { hint: 'Inserts, vis, aimants, colle, peinture.' })}
            </div>
          </section>

          <section class="space-y-3">
            <h3 class="section-title">Temps</h3>
            <div class="grid grid-cols-2 gap-3">
              <div><span class="label">Impression</span><div class="grid grid-cols-2 gap-2">${inputNum('time_h', timeH(), { suffix: 'h', placeholder: '0', inputmode: 'numeric' })}${inputNum('time_m', timeM(), { suffix: 'min', placeholder: '0', inputmode: 'numeric' })}</div></div>
              ${field('Post-traitement', inputNum('labor_min', d.t.labor_min, { suffix: 'min', placeholder: '0', inputmode: 'numeric' }), { hint: 'Supports, ponçage, assemblage.' })}
            </div>
            <div class="grid grid-cols-2 gap-3">
              ${field('Machine', selectInput('machine_id', machineOptions(Store.V, d.t.machine_id), d.t.machine_id || ''))}
              ${field('Pièces par plateau', inputNum('pieces_per_print', d.t.pieces_per_print, { placeholder: '1', inputmode: 'numeric' }), { hint: 'Pour information.' })}
            </div>
          </section>
        </div>
        <div class="lg:col-span-2"><div class="lg:sticky lg:top-0" id="tpl-summary">${summary()}</div></div>
      </div>`,
      footer: html`<div class="flex items-center gap-2">
        <div class="mr-auto hidden text-[13px] text-slate-400 sm:block" id="tpl-footer-note"></div>
        ${btn('Annuler', { variant: 'ghost', action: 'cancel' })}
        ${btn(editing ? 'Enregistrer' : 'Créer le template', { variant: 'primary', icon: 'Check', action: 'submit' })}
      </div>`,
    }),
    onMount: (m) => {
      m.el.addEventListener('dragover', (e) => {
        if (!e.target.closest('#import-zone')) return;
        e.preventDefault();
        e.target.closest('#import-zone').classList.add('border-neon', 'bg-neon/[0.08]');
      });
      m.el.addEventListener('dragleave', (e) => {
        const z = e.target.closest('#import-zone');
        if (z) z.classList.remove('border-neon', 'bg-neon/[0.08]');
      });
      m.el.addEventListener('drop', (e) => {
        if (!e.target.closest('#import-zone')) return;
        e.preventDefault();
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        handleImportFile(f, m);
      });
    },
    onInput: (e, m) => {
      const el = e.target;
      const name = el.name;
      if (!name) return;
      const num = () => (el.value.trim() === '' ? null : parseNum(el.value));
      if (name === 'import_file') {
        if (e.type === 'change') handleImportFile(el.files && el.files[0], m);
        return;
      }
      if (name === 'import_text') {
        d.imp.text = el.value;
        return;
      }
      if (name === 'import_pieces') {
        d.imp.pieces = num();
        return;
      }
      if (name === 'import_plate') {
        d.imp.plate = +el.value;
        if (e.type === 'change') m.render();
        return;
      }
      if (name === 'photo_file') {
        if (e.type !== 'change' || !el.files || !el.files[0]) return;
        blobToThumb(el.files[0], 384).then((thumb) => {
          if (thumb) {
            d.t.photo = thumb;
            m.render();
          } else toast("Cette image n'a pas pu être lue.", { tone: 'bad' });
        });
        return;
      }
      if (el.dataset.line !== undefined) {
        const i = +el.dataset.line;
        const line = d.t.materials[i];
        if (!line) return;
        if (name === 'm_grams') line.grams = num();
        if (name === 'm_color_name') line.color_name = el.value;
        if (name === 'm_color_hex') {
          line.color_hex = safeHex(el.value);
          if (e.type === 'change') m.update('#materials-block', materialsBlock());
        }
        if (name === 'm_material' && e.type === 'change') {
          line.material = el.value;
          const s = line.spool_id ? Store.V.spools.get(line.spool_id) : null;
          if (s && materialKey(s.material) !== materialKey(line.material)) line.spool_id = null;
          m.update('#materials-block', materialsBlock());
        }
        if (name === 'm_spool' && e.type === 'change') {
          line.spool_id = el.value || null;
          const s = line.spool_id ? Store.V.spools.get(line.spool_id) : null;
          if (s) {
            line.color_hex = safeHex(s.color_hex);
            line.color_name = s.color_name;
          }
          m.update('#materials-block', materialsBlock());
        }
        refreshNumbers(m);
        return;
      }
      if (name === 'time_h' || name === 'time_m') {
        // Les deux champs tels qu'ils sont affichés (ex. « 1 h 90 min » = 150 min)
        const readTime = (n) => {
          const f = m.q(`[name="${n}"]`);
          return f && f.value.trim() !== '' ? toNum(parseNum(f.value), 0) : 0;
        };
        d.t.print_time_min = Math.max(0, readTime('time_h') * 60 + readTime('time_m'));
      } else if (el.hasAttribute('data-num')) {
        d.t[name] = num();
      } else if (name === 'machine_id') {
        d.t.machine_id = el.value || null;
      } else {
        d.t[name] = el.value;
      }
      setFieldError(m.el, name, '');
      refreshNumbers(m);
    },
    actions: {
      cancel: (el, e, m) => m.close(),
      'line-add': (el, e, m) => {
        d.t.materials.push(newMaterialLine(Store.V, d.t.materials));
        m.update('#materials-block', materialsBlock());
        refreshNumbers(m);
      },
      'line-remove': (el, e, m) => {
        d.t.materials.splice(+el.dataset.line, 1);
        m.update('#materials-block', materialsBlock());
        refreshNumbers(m);
      },
      'photo-remove': (el, e, m) => {
        d.t.photo = null;
        m.render();
      },
      'pricing-mode': (el, e, m) => {
        const v = el.dataset.value;
        const st = settingsOf(Store.V);
        if (v === 'global') {
          d.t.pricing_mode = null;
          d.t.price_coef = null;
          d.t.target_margin_pct = null;
        } else {
          d.t.pricing_mode = v;
          if (v === 'coef' && d.t.price_coef === null) d.t.price_coef = st.price_coef;
          if (v === 'margin' && d.t.target_margin_pct === null) d.t.target_margin_pct = st.target_margin_pct;
        }
        m.update('#tpl-pricing', pricingControls());
        refreshNumbers(m);
      },
      'use-suggested': (el, e, m) => {
        const V = Store.V;
        const st = settingsOf(V);
        d.t.catalog_price = suggestPrice(templateCost(V, d.t, st).total, pricingOf(d.t, st)).rounded;
        const cat = m.q('input[name="catalog_price"]');
        if (cat) cat.value = String(d.t.catalog_price).replace('.', ',');
        refreshNumbers(m);
      },
      'import-text': (el, e, m) => {
        d.imp.mode = d.imp.mode === 'text' ? 'file' : 'text';
        m.render();
      },
      'import-parse': (el, e, m) => {
        const res = parseSlicerText(d.imp.text);
        if (!res || (!res.filaments.length && !Number.isFinite(res.timeMin) && !res.name)) {
          d.imp.error = "Je n'ai trouvé ni poids ni temps dans ce texte. Exemple : « Poids : 45 g » et « Temps : 2h35 ».";
          d.imp.result = null;
        } else {
          d.imp.error = '';
          d.imp.result = res;
          d.imp.pieces = Number.isFinite(res.pieces) && res.pieces > 0 ? res.pieces : 1;
          d.imp.plate = res.plateIndex || null;
        }
        m.render();
      },
      'import-apply': (el, e, m) => {
        const res = d.imp.result;
        if (!res) return;
        if (d.imp.pieces !== null && d.imp.pieces !== undefined && d.imp.pieces !== '' && !isPieceCount(d.imp.pieces)) return setFieldError(m.el, 'import_pieces', PIECES_ERROR);
        const pieces = Math.max(1, toNum(d.imp.pieces, 1));
        const vals = importToTemplate(Store.V, res, { pieces, plateIndex: d.imp.plate || undefined });
        if (!String(d.t.name || '').trim() && vals.name) d.t.name = vals.name;
        if (vals.materials.length) d.t.materials = vals.materials;
        d.t.purge_g = vals.purge_g;
        if (vals.print_time_min !== null) d.t.print_time_min = vals.print_time_min;
        d.t.pieces_per_print = vals.pieces_per_print;
        if (vals.photo && !d.t.photo) d.t.photo = vals.photo;
        d.purgeIncluded = !!res.purgeIncluded;
        d.imp = { mode: 'file', text: '', result: null, error: '', busy: false, pieces: 1, plate: null };
        m.render();
        toast('Fiche remplie depuis le slicer : vérifie les bobines associées.', { tone: 'ok' });
      },
      submit: async (el, e, m) => {
        if (d.busy) return;
        const t0 = d.t;
        let bad = false;
        if (!String(t0.name || '').trim()) { setFieldError(m.el, 'name', 'Donne un nom au produit.'); bad = true; }
        const lines = t0.materials.filter((l) => l.grams !== null && l.grams !== undefined && l.grams !== '');
        if (lines.some((l) => !Number.isFinite(l.grams) || l.grams < 0)) {
          toast('Un poids de matière est invalide.', { tone: 'bad' });
          bad = true;
        }
        for (const k of ['purge_g', 'hardware_cost', 'labor_min', 'catalog_price', 'price_coef', 'target_margin_pct']) {
          const v = t0[k];
          if (v !== null && v !== undefined && (!Number.isFinite(v) || v < 0)) { setFieldError(m.el, k, 'Valeur invalide.'); bad = true; }
        }
        if (t0.pieces_per_print !== null && t0.pieces_per_print !== undefined && t0.pieces_per_print !== '' && !isPieceCount(t0.pieces_per_print)) { setFieldError(m.el, 'pieces_per_print', PIECES_ERROR); bad = true; }
        if (t0.pricing_mode === 'margin' && Number.isFinite(t0.target_margin_pct) && t0.target_margin_pct >= 100) { setFieldError(m.el, 'target_margin_pct', 'Doit être inférieure à 100 %.'); bad = true; }
        if (t0.pricing_mode === 'coef' && t0.price_coef !== null && !(t0.price_coef > 0)) { setFieldError(m.el, 'price_coef', 'Doit être supérieur à 0.'); bad = true; }
        if (bad) return;
        const payload = {
          ...pick(t0, TEMPLATE_FIELDS),
          name: String(t0.name).trim().slice(0, 120),
          description: String(t0.description || '').trim() || null,
          machine_id: t0.machine_id || null,
          pieces_per_print: Math.max(1, toNum(t0.pieces_per_print, 1)),
          materials: lines.filter((l) => toNum(l.grams) > 0).map((l) => ({
            material: String(l.material || 'PLA').trim().slice(0, 40) || 'PLA',
            color_name: String(l.color_name || '').trim().slice(0, 60),
            color_hex: safeHex(l.color_hex, '#FFFFFF'),
            grams: roundDb(l.grams, 2),
            spool_id: l.spool_id || null,
          })),
          purge_g: roundDb(toNum(t0.purge_g), 2),
          hardware_cost: roundDb(toNum(t0.hardware_cost), 2),
          print_time_min: roundDb(toNum(t0.print_time_min), 2),
          labor_min: roundDb(toNum(t0.labor_min), 2),
          pricing_mode: t0.pricing_mode || null,
          price_coef: t0.pricing_mode === 'coef' && Number.isFinite(t0.price_coef) ? roundDb(t0.price_coef, 3) : null,
          target_margin_pct: t0.pricing_mode === 'margin' && Number.isFinite(t0.target_margin_pct) ? roundDb(t0.target_margin_pct, 2) : null,
          catalog_price: Number.isFinite(t0.catalog_price) ? roundDb(t0.catalog_price, 2) : null,
          archived: !!t0.archived,
        };
        // Modification : l'archivage passe par template.patch (bouton Archiver, parfois sur un autre
        // appareil pendant que ce formulaire est ouvert) — le formulaire ne doit pas le défaire.
        if (editing) delete payload.archived;
        d.busy = true;
        const res = await runOp('template.save', payload, { success: editing ? 'Template enregistré' : `Template « ${payload.name} » créé` });
        d.busy = false;
        if (opAccepted(res)) m.close();
      },
    },
  });
}
