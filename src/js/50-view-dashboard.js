/* =============================================================================
   Tableau de bord + historique
   ============================================================================= */

const PERIODS = [
  { value: 'month', label: 'Ce mois' },
  { value: 'prev', label: 'Mois dernier' },
  { value: 'year', label: 'Année' },
  { value: 'all', label: 'Global' },
];

const EVENT_META = {
  sale: { icon: 'ShoppingBag', cls: 'text-cyan-300 bg-cyan-400/10', label: 'Ventes' },
  production: { icon: 'Printer', cls: 'text-neon bg-neon/10', label: 'Productions' },
  failure: { icon: 'Flame', cls: 'text-rose-300 bg-rose-500/10', label: 'Prints ratés' },
  spool: { icon: 'Disc3', cls: 'text-violet-300 bg-violet-500/10', label: 'Bobines' },
  weigh: { icon: 'Scale', cls: 'text-slate-300 bg-white/5', label: 'Pesées' },
  stock: { icon: 'PackagePlus', cls: 'text-amber-300 bg-amber-400/10', label: 'Stock ajouté' },
  adjust: { icon: 'PackageMinus', cls: 'text-amber-300 bg-amber-400/10', label: 'Retraits' },
};

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function dayHeader(iso) {
  const d = new Date(iso);
  const today = new Date();
  const k = dayKey(iso);
  if (k === dayKey(today.toISOString())) return "Aujourd'hui";
  if (k === dayKey(new Date(today.getTime() - DAY).toISOString())) return 'Hier';
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}${d.getFullYear() !== today.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

function kpiCard({ label, value, sub = '', ic, tone = 'text-slate-50', accent = 'text-neon bg-neon/10' }) {
  return html`<div class="card p-4">
    <div class="flex items-center justify-between gap-2">
      <span class="text-[12px] font-medium text-slate-400">${label}</span>
      <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg ${accent}">${icon(ic, 'w-4 h-4')}</span>
    </div>
    <div class="mt-2 truncate font-display text-[22px] font-bold tabular-nums tracking-tight ${tone} sm:text-2xl">${value}</div>
    ${sub ? html`<div class="mt-0.5 truncate text-[12px] text-slate-500">${sub}</div>` : ''}
  </div>`;
}

function eventRow(V, e, { compact = false } = {}) {
  const meta = EVENT_META[e.type] || EVENT_META.stock;
  const pending = V.pending.has(e.key);
  const amountTone = e.amount === null ? '' : e.type === 'sale' ? 'text-cyan-200' : e.amount < 0 ? 'text-slate-300' : 'text-neon';
  return html`<button data-action="event-open" data-type="${e.type}" data-id="${e.id}" class="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-white/[0.03] active:bg-white/[0.06] sm:px-4">
    <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl ${meta.cls}">${icon(meta.icon, 'w-5 h-5')}</span>
    <span class="min-w-0 flex-1">
      <span class="line-clamp-2 text-sm font-medium leading-snug text-slate-100">${e.title}</span>
      <span class="flex items-center gap-2 truncate text-[12px] text-slate-500">${compact ? `${fmtDate(e.date, 'short')} · ` : ''}${fmtDate(e.date, 'time')} · ${e.sub}</span>
    </span>
    <span class="flex shrink-0 flex-col items-end gap-1">
      ${e.amount === null ? '' : html`<span class="font-display text-sm font-semibold tabular-nums ${amountTone}">${fmtEur(e.amount, { sign: e.type === 'sale' })}</span>`}
      ${pending ? badge('En attente', 'warn', { dot: true }) : ''}
    </span>
  </button>`;
}

function onboardingCard(V) {
  const hasSpools = V.spools.size > 0;
  const hasTemplates = V.templates.size > 0;
  const hasProd = V.productions.size > 0;
  const step = (done, n, title, text, action, label) => html`<div class="flex items-start gap-3 rounded-2xl border ${done ? 'border-neon/20 bg-neon/[0.04]' : 'border-white/[0.06] bg-ink-850'} p-4">
    <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full ${done ? 'bg-neon text-ink-950' : 'bg-white/5 text-slate-300'} text-sm font-bold">${done ? icon('Check', 'w-4 h-4') : n}</span>
    <div class="min-w-0 flex-1"><div class="font-semibold text-slate-100">${title}</div><div class="text-[13px] text-slate-400">${text}</div></div>
    ${done ? '' : btn(label, { size: 'sm', variant: n === 1 || (n === 2 && hasSpools) || (n === 3 && hasTemplates) ? 'primary' : 'secondary', action })}
  </div>`;
  return html`<div class="card mb-5 overflow-hidden p-5">
    <div class="flex items-center gap-3">
      <span class="grid h-10 w-10 place-items-center rounded-xl bg-neon/10 text-neon">${icon('Rocket', 'w-5 h-5')}</span>
      <div><h2 class="font-display text-lg font-semibold text-slate-50">Bien démarrer</h2><p class="text-[13px] text-slate-400">Trois étapes et le tableau de bord se remplit tout seul.</p></div>
    </div>
    <div class="mt-4 grid gap-2.5 lg:grid-cols-3">
      ${step(hasSpools, 1, 'Ajoute tes bobines', 'Prix et poids : le coût au gramme est calculé.', 'q-new-spool', 'Ajouter')}
      ${step(hasTemplates, 2, 'Crée un template', 'Dépose ton fichier Bambu Studio, tout se remplit.', 'q-new-template', 'Créer')}
      ${step(hasProd, 3, 'Produis, puis vends', 'Le filament est déduit, la marge calculée.', 'q-new-production', 'Produire')}
    </div>
  </div>`;
}

Actions['q-new-spool'] = () => openSpoolModal({});
Actions['q-new-template'] = () => openTemplateModal({});
Actions['q-new-production'] = () => openProductionModal({ kind: 'production' });

VIEWS.dashboard = {
  render(V) {
    const period = App.ui.period || 'month';
    const range = periodRange(period);
    const st = settingsOf(V);
    const s = computeStats(V, range);
    const groups = stockGroups(V).filter((g) => g.qty > 0);
    const piecesReady = sum(groups, (g) => g.qty);
    const alerts = activeSpools(V)
      .map((sp) => ({ sp, status: spoolStatus(sp, st) }))
      .filter((x) => x.status !== 'ok')
      .sort((a, b) => toNum(a.sp.remaining_weight_g) - toNum(b.sp.remaining_weight_g));
    const recent = historyEvents(V).slice(0, 6);
    const fresh = !V.spools.size || !V.templates.size || !V.productions.size;
    const netTone = s.net >= 0 ? 'text-neon' : 'text-rose-300';
    const b = s.breakdown;
    const parts = [
      { key: 'material', label: 'Matières', value: b.material, color: COST_COLORS.material },
      { key: 'machine', label: 'Machine & électricité', value: b.machine, color: COST_COLORS.machine },
      { key: 'labor', label: "Main-d'œuvre", value: b.labor, color: COST_COLORS.labor },
      { key: 'hardware', label: 'Quincaillerie', value: b.hardware, color: COST_COLORS.hardware },
      { key: 'fees', label: 'Port, emballage, commissions', value: b.fees, color: COST_COLORS.fees },
      { key: 'failures', label: 'Prints ratés & casse', value: b.failures, color: COST_COLORS.failures },
      { key: 'other', label: 'Autres (sur mesure, stock initial)', value: b.other, color: COST_COLORS.other },
    ];

    return html`
      ${pageHeader('Tableau de bord', `${st.workshop_name} · ${range.label}`, segmented('period', PERIODS, period))}
      ${backupReminder(V)}
      ${fresh ? onboardingCard(V) : ''}

      <div class="grid gap-3 lg:grid-cols-3">
        <div class="card hero-card relative overflow-hidden p-5 lg:col-span-2">
          <div class="hero-glow"></div>
          <div class="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <div class="flex items-center gap-2 text-[13px] font-medium text-slate-400">${icon('PiggyBank', 'w-4 h-4 text-neon')}Bénéfice net réel</div>
              <div class="mt-1 font-display text-[40px] font-bold leading-none tracking-tight tabular-nums ${netTone} sm:text-5xl">${fmtEur(s.net)}</div>
              <div class="mt-2 text-sm text-slate-400">sur <span class="font-semibold text-slate-200">${fmtEur(s.revenue)}</span> encaissés · marge <span class="font-semibold ${s.marginRate === null ? 'text-slate-300' : s.marginRate >= 0 ? 'text-neon' : 'text-rose-300'}">${fmtPct(s.marginRate)}</span></div>
            </div>
            <div class="grid grid-cols-2 gap-2 text-center">
              <div class="rounded-xl bg-white/[0.04] px-3 py-2"><div class="font-display text-xl font-bold tabular-nums text-slate-100">${fmtNum(s.salesCount)}</div><div class="text-[11px] text-slate-500">vente${s.salesCount > 1 ? 's' : ''}</div></div>
              <div class="rounded-xl bg-white/[0.04] px-3 py-2"><div class="font-display text-xl font-bold tabular-nums text-slate-100">${fmtNum(s.piecesSold)}</div><div class="text-[11px] text-slate-500">pièce${s.piecesSold > 1 ? 's' : ''} vendue${s.piecesSold > 1 ? 's' : ''}</div></div>
            </div>
          </div>
        </div>
        <a href="#/stock" class="card group flex flex-col justify-between p-5 transition hover:border-neon/25">
          <div class="flex items-center justify-between text-[13px] font-medium text-slate-400"><span class="flex items-center gap-2">${icon('Boxes', 'w-4 h-4 text-amber-300')}Stock prêt à vendre</span><span class="text-slate-600 group-hover:text-slate-300">${icon('ArrowUpRight', 'w-4 h-4')}</span></div>
          <div class="mt-3 font-display text-3xl font-bold tabular-nums text-slate-50">${fmtNum(piecesReady)} <span class="text-base font-medium text-slate-400">pièce${piecesReady > 1 ? 's' : ''}</span></div>
          <div class="mt-1 text-[13px] text-slate-400">valeur au coût de revient : <span class="font-semibold text-slate-200">${fmtEur(stockValue(V))}</span></div>
        </a>
      </div>

      <div class="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        ${kpiCard({ label: "Chiffre d'affaires", value: fmtEur(s.revenue), sub: 'brut encaissé', ic: 'Euro', accent: 'text-cyan-300 bg-cyan-400/10' })}
        ${kpiCard({ label: 'Coûts engagés', value: fmtEur(s.costs), sub: 'pièces vendues, frais, pertes', ic: 'Receipt', accent: 'text-amber-300 bg-amber-400/10' })}
        ${kpiCard({ label: 'Taux de marge', value: fmtPct(s.marginRate), sub: 'bénéfice ÷ CA', ic: 'Percent', tone: s.marginRate === null ? 'text-slate-300' : s.marginRate >= 0 ? 'text-slate-50' : 'text-rose-300' })}
        ${kpiCard({ label: 'Plastique transformé', value: fmtKg(s.gramsTotal), sub: `${fmtNum(s.piecesMade)} pièce${s.piecesMade > 1 ? 's' : ''} produite${s.piecesMade > 1 ? 's' : ''}`, ic: 'Weight', accent: 'text-violet-300 bg-violet-500/10' })}
        ${kpiCard({ label: 'Taux de rebut', value: fmtPct(s.scrapRate), sub: `${fmtNum(s.piecesFailed)} raté${s.piecesFailed > 1 ? 's' : ''} · ${fmtEur(s.failureLoss)} perdus`, ic: 'Flame', tone: s.scrapRate > 10 ? 'text-rose-300' : 'text-slate-50', accent: 'text-rose-300 bg-rose-500/10' })}
        ${kpiCard({ label: 'Alertes bobines', value: fmtNum(alerts.length), sub: alerts.length ? 'à racheter bientôt' : 'tout va bien', ic: 'TriangleAlert', tone: alerts.some((a) => a.status !== 'low') ? 'text-rose-300' : 'text-slate-50', accent: 'text-amber-300 bg-amber-400/10' })}
      </div>

      ${alerts.length ? html`<div class="card mt-3 p-4">
        <div class="mb-2 flex items-center justify-between"><h2 class="flex items-center gap-2 text-sm font-semibold text-slate-100">${icon('TriangleAlert', 'w-4 h-4 text-amber-300')}Bobines à surveiller</h2><a href="#/bobines" class="hit text-[13px] font-medium text-neon">Voir tout</a></div>
        <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">${alerts.slice(0, 4).map(({ sp, status }) => html`<button data-action="spool-weigh" data-id="${sp.id}" class="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-ink-850 p-2.5 text-left transition hover:border-white/15 active:bg-white/[0.05]">
          ${spoolDisc(sp.color_hex, spoolPct(sp), status, 40)}
          <span class="min-w-0 flex-1"><span class="block truncate text-[13px] font-medium text-slate-100">${sp.color_name || sp.material}</span><span class="block truncate text-[12px] text-slate-500">${sp.brand} · ${sp.material}</span></span>
          <span class="text-right"><span class="block font-display text-sm font-semibold tabular-nums ${status === 'low' ? 'text-amber-300' : 'text-rose-300'}">${fmtG(Math.max(0, toNum(sp.remaining_weight_g)))}</span><span class="block text-[11px] text-slate-500">${SPOOL_STATUS[status].label}</span></span>
        </button>`)}</div>
      </div>` : ''}

      <div class="mt-3 grid gap-3 lg:grid-cols-5">
        <div class="card p-4 lg:col-span-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-sm font-semibold text-slate-100">Chiffre d'affaires et bénéfice net</h2>
            <div class="flex items-center gap-3 text-[12px] text-slate-400"><span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-cyan-400"></span>CA</span><span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-neon"></span>Bénéfice</span></div>
          </div>
          ${valuesOf(V.sales).length
            ? html`<div class="relative mt-3 h-56 sm:h-64">${globalThis.Chart ? html`<canvas id="chart-revenue" role="img" aria-label="${`Évolution mensuelle du chiffre d'affaires et du bénéfice. ${range.label} : ${fmtEur(s.revenue)} encaissés, bénéfice net ${fmtEur(s.net)}.`}"></canvas>` : chartUnavailable()}</div>`
            : html`<div class="mt-3 flex h-56 flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] text-center text-[13px] text-slate-400 sm:h-64">${icon('ChartLine', 'w-8 h-8 mb-2 text-slate-500')}La courbe apparaîtra après ta première vente.</div>`}
        </div>
        <div class="card p-4 lg:col-span-2">
          <h2 class="text-sm font-semibold text-slate-100">Top ventes</h2>
          <p class="text-[12px] text-slate-500">${range.label}, par chiffre d'affaires</p>
          ${topProducts(V, range).length
            ? html`<div class="relative mt-3 h-56 sm:h-64">${globalThis.Chart ? html`<canvas id="chart-top" role="img" aria-label="${`Produits les plus vendus, ${range.label} : ${topProducts(V, range).slice(0, 3).map((t) => `${t.name} ${fmtEur(t.revenue)}`).join(', ')}.`}"></canvas>` : chartUnavailable()}</div>`
            : html`<div class="mt-6 flex h-48 flex-col items-center justify-center text-center text-[13px] text-slate-500">${icon('ChartBar', 'w-8 h-8 mb-2 text-slate-600')}Aucune vente sur la période.</div>`}
        </div>
      </div>

      <div class="mt-3 grid gap-3 lg:grid-cols-5">
        <div class="card p-4 lg:col-span-2">
          <h2 class="text-sm font-semibold text-slate-100">Où part l'argent</h2>
          <p class="mb-3 text-[12px] text-slate-500">Coûts engagés : ${fmtEur(s.costs)}</p>
          ${costBar(parts)}
          <div class="mt-3 space-y-1.5">${parts.filter((p) => p.value > 0.004).map((p) => html`<div class="flex items-center justify-between gap-2 text-[13px]"><span class="flex min-w-0 items-center gap-2 text-slate-400"><span class="h-2.5 w-2.5 shrink-0 rounded-sm" style="background:${p.color}"></span><span class="truncate">${p.label}</span></span><span class="tabular-nums text-slate-200">${fmtEur(p.value)}</span></div>`)}
            ${s.costs <= 0.004 ? html`<p class="text-[13px] text-slate-500">Aucun coût sur la période.</p>` : ''}</div>
        </div>
        <div class="card overflow-hidden lg:col-span-3">
          <div class="flex items-center justify-between px-4 pt-4"><h2 class="text-sm font-semibold text-slate-100">Activité récente</h2><a href="#/historique" class="hit text-[13px] font-medium text-neon">Tout l'historique</a></div>
          ${recent.length ? html`<div class="mt-2 divide-y divide-white/[0.05]">${recent.map((e) => eventRow(V, e, { compact: true }))}</div>`
            : html`<p class="px-4 pb-5 pt-3 text-[13px] text-slate-500">Rien pour l'instant.</p>`}
        </div>
      </div>`;
  },

  mount(V) {
    if (!globalThis.Chart) return;
    applyChartTheme();
    const period = App.ui.period || 'month';
    const series = monthlySeries(V, period);
    // Peu de mois connus (ex. en janvier, vue « Année ») : on montre les points, sinon la courbe serait invisible
    const dots = series.filter((x) => x.revenue !== null).length <= 2 ? 3 : 0;
    const c1 = document.getElementById('chart-revenue');
    if (c1) {
      App.charts.push(new Chart(c1, {
        type: 'line',
        data: {
          labels: series.map((x) => x.label),
          datasets: [
            { label: "Chiffre d'affaires", data: series.map((x) => (x.revenue === null ? null : round(x.revenue, 2))), borderColor: '#22D3EE', backgroundColor: fadeFill('34,211,238'), fill: true, tension: 0.35, borderWidth: 2, pointRadius: dots, pointHoverRadius: 4 },
            { label: 'Bénéfice net', data: series.map((x) => (x.net === null ? null : round(x.net, 2))), borderColor: '#22F2A0', backgroundColor: fadeFill('34,242,160'), fill: true, tension: 0.35, borderWidth: 2, pointRadius: dots, pointHoverRadius: 4 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label} : ${fmtEur(c.parsed.y)}` } } },
          scales: {
            x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 8 } },
            y: { grid: { color: 'rgba(148,163,184,.08)' }, border: { display: false }, ticks: { callback: (v) => fmtEur(v, { compact: true }), maxTicksLimit: 5 } },
          },
        },
      }));
    }
    const c2 = document.getElementById('chart-top');
    if (c2) {
      const tops = topProducts(V, periodRange(period));
      App.charts.push(new Chart(c2, {
        type: 'bar',
        data: {
          labels: tops.map((t) => (t.name.length > 22 ? `${t.name.slice(0, 21)}…` : t.name)),
          datasets: [{ label: "Chiffre d'affaires", data: tops.map((t) => round(t.revenue, 2)), backgroundColor: tops.map((_, i) => (i === 0 ? '#22F2A0' : 'rgba(34,242,160,.45)')), borderRadius: 6, barThickness: 16 }],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { title: (items) => tops[items[0].dataIndex].name, label: (c) => ` ${fmtEur(c.parsed.x)} · ${plural(tops[c.dataIndex].qty, 'pièce', 'pièces')}` } } },
          scales: {
            x: { grid: { color: 'rgba(148,163,184,.08)' }, border: { display: false }, ticks: { callback: (v) => fmtEur(v, { compact: true }), maxTicksLimit: 4 } },
            y: { grid: { display: false }, ticks: { color: '#CBD5E1' } },
          },
        },
      }));
    }
  },
};

function chartUnavailable() {
  return html`<div class="flex h-full items-center justify-center text-center text-[13px] text-slate-500">Graphique indisponible hors-ligne tant que l'appli n'a pas été ouverte une fois avec internet.</div>`;
}

let chartThemed = false;
function applyChartTheme() {
  if (chartThemed || !globalThis.Chart) return;
  Chart.defaults.color = '#94A3B8';
  Chart.defaults.borderColor = 'rgba(148,163,184,.1)';
  Chart.defaults.font.family = 'Inter, ui-sans-serif, system-ui, sans-serif';
  Chart.defaults.font.size = 11;
  Chart.defaults.plugins.tooltip.backgroundColor = '#0D1218';
  Chart.defaults.plugins.tooltip.borderColor = 'rgba(255,255,255,.1)';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.titleColor = '#F1F5F9';
  Chart.defaults.plugins.tooltip.bodyColor = '#CBD5E1';
  // animations réduites demandées par le téléphone : graphiques affichés directement
  if (globalThis.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) Chart.defaults.animation = false;
  chartThemed = true;
}

function fadeFill(rgb) {
  return (ctx) => {
    const { chart } = ctx;
    const area = chart.chartArea;
    if (!area) return `rgba(${rgb},0.08)`;
    const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, `rgba(${rgb},0.28)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    return g;
  };
}

Actions['event-open'] = (el) => {
  const { type, id } = el.dataset;
  const V = Store.V;
  if (type === 'sale') return openSaleDetails(id);
  if (type === 'production' || type === 'failure') return openProductionDetails(id);
  if (type === 'spool') {
    const sp = V.spools.get(id);
    return sp ? openSpoolHistory(sp) : toast('Cette bobine a été supprimée.', { tone: 'info' });
  }
  if (type === 'weigh') {
    const m = V.spool_movements.get(id);
    const sp = m && V.spools.get(m.spool_id);
    return sp ? openSpoolHistory(sp) : null;
  }
  App.ui.stockTab = 'pieces';
  App.saveUi();
  go('#/stock');
};

/* ---------- historique complet ---------- */
VIEWS.historique = {
  render(V) {
    const period = App.ui.histPeriod || 'all';
    const type = App.ui.histType || 'all';
    const q = App.ui.histQ || '';
    const limit = App.ui.histLimit || 150;
    const events = historyEvents(V, { range: period === 'all' ? null : periodRange(period), type, q });
    const shown = events.slice(0, limit);
    const days = groupBy(shown, (e) => dayKey(e.date));
    const types = [{ value: 'all', label: 'Tout' }, ...Object.entries(EVENT_META).map(([value, m]) => ({ value, label: m.label }))];
    return html`
      ${pageHeader('Historique', `${fmtNum(events.length)} évènement${events.length > 1 ? 's' : ''}`, btn('Exporter', { icon: 'Download', action: 'export-open' }))}
      <div class="mb-4 flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
          ${segmented('histPeriod', PERIODS, period)}
          <div class="relative min-w-[12rem] flex-1">
            <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">${icon('Search', 'w-4 h-4')}</span>
            <input class="input pl-9" placeholder="Rechercher (article, bobine, canal…)" value="${q}" data-page-input="hist-search" data-keep="hist-search" autocomplete="off"/>
          </div>
        </div>
        <div class="no-scrollbar -mx-4 -my-1.5 flex gap-2 overflow-x-auto px-4 py-1.5 lg:mx-0 lg:flex-wrap lg:px-0">${types.map((t) => html`<button data-action="hist-type" data-value="${t.value}" aria-pressed="${t.value === type}" class="chip ${t.value === type ? 'chip-active' : ''}">${t.label}</button>`)}</div>
      </div>
      ${events.length ? html`<div class="space-y-4">${[...days.entries()].map(([k, list]) => html`<section>
          <h3 class="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500">${dayHeader(list[0].date)}</h3>
          <div class="card divide-y divide-white/[0.05] overflow-hidden">${list.map((e) => eventRow(V, e))}</div>
        </section>`)}</div>
        ${events.length > limit ? html`<div class="mt-4 flex justify-center">${btn(`Afficher plus (${fmtNum(events.length - limit)} restants)`, { action: 'hist-more' })}</div>` : ''}`
        : emptyCard({ icon: 'History', title: 'Aucun évènement', text: q || type !== 'all' || period !== 'all' ? 'Aucun résultat avec ces filtres.' : 'Les productions, ventes et bobines apparaîtront ici.' })}`;
  },
};

Actions['hist-type'] = (el) => {
  App.ui.histType = el.dataset.value;
  App.ui.histLimit = 150;
  App.saveUi();
  App.render();
};
Actions['hist-more'] = () => {
  App.ui.histLimit = (App.ui.histLimit || 150) + 300;
  App.render();
};
Actions['hist-search'] = debounce((el) => {
  App.ui.histQ = el.value;
  App.ui.histLimit = 150;
  App.render();
}, 200);

/* ---------- sauvegarde complète ---------- */
const BACKUP_SNOOZE = 'p3d_backup_snooze';
function backupReminder(V) {
  if (!Sync.backend || Sync.backend.kind !== 'supabase') return '';
  const b = backupStatus(V);
  if (!b.due || Date.now() < toNum(lsGet(BACKUP_SNOOZE, 0))) return '';
  const when = b.days === null ? 'Aucune sauvegarde pour l’instant' : `Dernière sauvegarde il y a ${plural(b.days, 'jour', 'jours')}`;
  return html`<div class="card mb-3 flex flex-wrap items-center gap-3 border-amber-400/25 p-4">
    <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-400/10 text-amber-300">${icon('DatabaseBackup', 'w-5 h-5')}</span>
    <div class="min-w-0 flex-1"><div class="text-sm font-semibold text-slate-100">Pense à sauvegarder tes données</div>
      <div class="text-[12px] text-slate-400">${when}. Supabase gratuit ne garde aucune copie : garde un fichier chez toi, une fois par mois.</div></div>
    <div class="flex gap-2">${btn('Plus tard', { size: 'sm', variant: 'ghost', action: 'backup-later' })}${btn('Sauvegarder', { size: 'sm', variant: 'primary', icon: 'Download', action: 'backup-now' })}</div>
  </div>`;
}
async function downloadBackup() {
  const stampDay = toLocalInput().slice(0, 10); // date LOCALE : après minuit en France, pas celle de la veille (UTC)
  const saved = await saveFile(`paulo3d-sauvegarde-${stampDay}.json`, exportJson(Store.V), 'application/json');
  if (!saved) return;
  if (Sync.backend && Sync.backend.kind === 'supabase') {
    await Sync.enqueue('settings.save', { last_backup_at: new Date().toISOString() }, { wait: 0, silent: true });
  }
  toast('Sauvegarde téléchargée : range-la en lieu sûr (ordinateur, clé USB, Drive…).', { tone: 'ok', title: 'Sauvegarde' });
}
Actions['backup-now'] = () => downloadBackup();
Actions['backup-later'] = () => {
  lsSet(BACKUP_SNOOZE, Date.now() + 7 * 86400000);
  App.render();
};

Actions['export-open'] = () => {
  const stampDay = toLocalInput().slice(0, 10); // date LOCALE : après minuit en France, pas celle de la veille (UTC)
  const opt = (ic, title, text, action) => html`<button data-action="${action}" class="flex w-full items-center gap-3 rounded-2xl border border-white/[0.06] bg-ink-850 p-3.5 text-left transition hover:border-neon/30">
    <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.04] text-neon">${icon(ic, 'w-5 h-5')}</span>
    <span class="min-w-0"><span class="block text-sm font-semibold text-slate-100">${title}</span><span class="block text-[12px] text-slate-400">${text}</span></span></button>`;
  Modal.open({
    title: 'Exporter les données',
    subtitle: 'Fichiers lisibles dans Excel, Numbers ou Google Sheets',
    size: 'sm',
    render: () => html`<div class="space-y-2">
      ${opt('FileJson', 'Sauvegarde complète (JSON)', 'Toutes les tables, à garder précieusement', 'x-json')}
      ${opt('FileSpreadsheet', 'Journal de l’atelier (CSV)', 'Tous les évènements, du plus ancien au plus récent', 'x-journal')}
      ${opt('ShoppingBag', 'Ventes détaillées (CSV)', 'Encaissé, coût de revient, frais, marge nette', 'x-sales')}
      ${opt('Printer', 'Productions et prints ratés (CSV)', 'Coûts figés, grammes, temps machine', 'x-prod')}
      ${opt('Disc3', 'Bobines (CSV)', 'Stock de filament, prix au gramme', 'x-spools')}
      ${Store.V.pendingCount ? html`<p class="rounded-xl bg-amber-400/10 p-3 text-[12px] text-amber-200">${Store.V.pendingCount >= 2 ? `${Store.V.pendingCount} actions pas encore envoyées sont incluses` : '1 action pas encore envoyée est incluse'} dans l'export.</p>` : ''}
    </div>`,
    actions: {
      'x-json': () => downloadBackup(),
      'x-journal': () => saveFile(`paulo3d-journal-${stampDay}.csv`, exportCsvJournal(Store.V), 'text/csv;charset=utf-8'),
      'x-sales': () => saveFile(`paulo3d-ventes-${stampDay}.csv`, exportCsvSales(Store.V), 'text/csv;charset=utf-8'),
      'x-prod': () => saveFile(`paulo3d-productions-${stampDay}.csv`, exportCsvProductions(Store.V), 'text/csv;charset=utf-8'),
      'x-spools': () => saveFile(`paulo3d-bobines-${stampDay}.csv`, exportCsvSpools(Store.V), 'text/csv;charset=utf-8'),
    },
  });
};
