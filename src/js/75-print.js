/* =============================================================================
   Impressions : bilan du mois et étiquettes QR des bobines (scannées : la pesée
   de la bobine s'ouvre directement).
   Deux sorties : un vrai fichier PDF (marche partout, même sur iPhone en appli
   installée, et hors-ligne) et l'impression directe du navigateur quand elle existe.
   ============================================================================= */

function monthRange(ym) {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
  const now = new Date();
  const y = m ? +m[1] : now.getFullYear();
  const mo = m ? +m[2] - 1 : now.getMonth();
  const start = new Date(y, mo, 1);
  return { start, end: new Date(y, mo + 1, 1), label: `${MONTHS_LONG[start.getMonth()]} ${start.getFullYear()}`, ym: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}` };
}
const shiftMonth = (ym, delta) => {
  const r = monthRange(ym);
  const d = new Date(r.start.getFullYear(), r.start.getMonth() + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
// « 2026-09-12 » → « 12 sept. 2026 »
const fmtPlainDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m && +m[2] >= 1 && +m[2] <= 12 ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : '';
};

// Livraison d'une commande : la date de SA vente (retoucher la commande plus tard ne la déplace pas)
function orderDeliveredAt(V, o) {
  const s = o.sale_id ? V.sales.get(o.sale_id) : null;
  return s ? s.occurred_at : o.updated_at;
}

// Données du bilan d'un mois (mêmes calculs que le tableau de bord)
function monthReport(V, ym, now = new Date()) {
  const range = monthRange(ym);
  const st = settingsOf(V);
  const stats = computeStats(V, range);
  const sales = valuesOf(V.sales).filter((s) => inRange(s.occurred_at, range)).sort((a, b) => time(a.occurred_at) - time(b.occurred_at));
  const prods = valuesOf(V.productions).filter((p) => inRange(p.occurred_at, range)).sort((a, b) => time(a.occurred_at) - time(b.occurred_at));
  const spools = valuesOf(V.spools).filter((s) => {
    const d = s.purchased_at ? new Date(`${s.purchased_at}T12:00:00`) : new Date(s.created_at);
    return !Number.isNaN(d.getTime()) && d >= range.start && d < range.end;
  });
  const delivered = valuesOf(V.orders).filter((o) => o.status === 'delivered' && inRange(orderDeliveredAt(V, o), range)).length;
  return {
    range, st, stats, sales, prods, spools, delivered,
    // commandes en cours : c'est l'état d'AUJOURD'HUI, sans objet pour un autre mois
    openOrders: now >= range.start && now < range.end ? openOrders(V, now).length : null,
    spoolSpend: sum(spools, (s) => s.price),
    tops: topProducts(V, range, 8),
  };
}

function reportKpis(r) {
  const s = r.stats;
  return [
    ['Chiffre d’affaires', fmtEur(s.revenue)],
    ['Coûts engagés', fmtEur(s.costs)],
    ['Bénéfice net', fmtEur(s.net)],
    ['Marge', fmtPct(s.marginRate)],
    ['Ventes', fmtNum(s.salesCount)],
    ['Pièces vendues', fmtNum(s.piecesSold)],
    ['Pièces produites', fmtNum(s.piecesMade)],
    ['Prints ratés', `${fmtNum(s.piecesFailed)} · ${fmtEur(s.failureLoss)}`],
    ['Filament utilisé', fmtKg(s.gramsTotal)],
    ['Achats de bobines', fmtEur(r.spoolSpend)],
    ['Commandes livrées', fmtNum(r.delivered)],
    ...(r.openOrders === null ? [] : [['Commandes en cours', fmtNum(r.openOrders)]]),
  ];
}

// Tableaux du bilan, communs à l'aperçu et au PDF. Colonnes : [titre, largeur relative, 'num' | 'wrap']
function reportTables(V, r) {
  const s = r.stats;
  const fees = (x) => toNum(x.shipping_cost) + toNum(x.packaging_cost) + toNum(x.platform_fee);
  return [
    {
      title: 'Ventes',
      empty: 'Aucune vente ce mois-ci.',
      cols: [['Date', 42], ['Articles', 140, 'wrap'], ['Canal', 58], ['Client', 71], ['Encaissé', 54, 'num'], ['Coût', 50, 'num'], ['Frais', 46, 'num'], ['Marge', 54, 'num']],
      rows: r.sales.map((x) => [fmtDate(x.occurred_at, 'short'), saleTitle(V, x), channelOf(r.st, x.channel).name, x.customer || '', fmtEur(x.amount), fmtEur(x.cogs), fmtEur(fees(x)), fmtEur(x.net_margin)]),
      total: r.sales.length ? ['Total', '', '', '', fmtEur(s.revenue), fmtEur(s.cogs), fmtEur(s.shipping + s.packaging + s.platform), fmtEur(sum(r.sales, (x) => x.net_margin))] : null,
    },
    {
      title: 'Productions et prints ratés',
      empty: 'Aucune production ce mois-ci.',
      cols: [['Date', 42], ['Pièce', 190, 'wrap'], [ui('Type'), 90], ['Quantité', 55, 'num'], ['Filament', 65, 'num'], ['Coût', 73, 'num']],
      rows: r.prods.map((p) => [fmtDate(p.occurred_at, 'short'), p.item_name, p.kind === 'failure' ? `Raté (${fmtNum(p.failed_pct)} %)` : 'Production', fmtNum(p.quantity), fmtG(p.grams_total), fmtEur(p.total_cost)]),
    },
    {
      title: 'Meilleures ventes',
      cols: [['Pièce', 315, 'wrap'], ['Quantité', 90, 'num'], ['Chiffre d’affaires', 110, 'num']],
      rows: r.tops.map((t) => [t.name, fmtNum(t.qty), fmtEur(t.revenue)]),
    },
    {
      title: 'Bobines achetées',
      cols: [['Bobine', 315, 'wrap'], ['Poids', 90, 'num'], ['Prix', 110, 'num']],
      rows: r.spools.map((sp) => [spoolLabel(sp), fmtG(sp.initial_weight_g), fmtEur(sp.price)]),
    },
  ];
}
const REPORT_FORMULA = 'Bénéfice net = encaissé − coût de revient des pièces vendues − port, emballage et commissions − prints ratés et casse.';

function reportHtml(V, r) {
  const kpi = ([label, value]) => html`<div class="pr-kpi"><span>${label}</span><b>${value}</b></div>`;
  const cell = (t, i, v) => html`<td class="${t.cols[i][2] === 'num' ? 'num' : ''}">${v}</td>`;
  const table = (t) => {
    if (!t.rows.length) return t.empty ? html`<h2>${t.title}</h2><p class="pr-empty">${t.empty}</p>` : '';
    return html`<h2>${t.title}</h2><table class="pr-table"><thead><tr>${t.cols.map((c) => html`<th class="${c[2] === 'num' ? 'num' : ''}">${c[0]}</th>`)}</tr></thead><tbody>
      ${t.rows.map((row) => html`<tr>${row.map((v, i) => cell(t, i, v))}</tr>`)}
      ${t.total ? html`<tr class="pr-total">${t.total.map((v, i) => cell(t, i, v))}</tr>` : ''}
    </tbody></table>`;
  };
  return html`<div class="pr-sheet">
    <div class="pr-head"><div><h1>Bilan de ${r.range.label}</h1><p>${r.st.workshop_name} · imprimé le ${fmtDate(new Date().toISOString(), 'long')}</p></div></div>
    <div class="pr-kpis">${reportKpis(r).map(kpi)}</div>
    ${reportTables(V, r).map(table)}
    <p class="pr-foot">${REPORT_FORMULA}</p>
  </div>`;
}

// Bilan en PDF (A4) : chiffres clés, puis les tableaux ; en-têtes répétés à chaque nouvelle page
function reportPdf(V, r) {
  const doc = pdfDocument(`Bilan de ${r.range.label}`);
  const M = 40;
  const W = doc.W - 2 * M;
  const TOP = 48;
  const BOTTOM = doc.H - 50;
  const GRAY = '#6b7280';
  const DARK = '#374151';
  let y = TOP;
  doc.page();
  doc.text(`Bilan de ${r.range.label}`, M, y + 14, { size: 18, bold: true, maxWidth: W });
  doc.text(`${r.st.workshop_name} · imprimé le ${fmtDate(new Date().toISOString(), 'long')}`, M, y + 31, { size: 9, color: GRAY, maxWidth: W });
  y += 46;
  const kpis = reportKpis(r);
  const gap = 8;
  const kw = (W - 3 * gap) / 4;
  const kh = 38;
  kpis.forEach(([label, value], i) => {
    const x = M + (i % 4) * (kw + gap);
    const ky = y + Math.floor(i / 4) * (kh + gap);
    doc.rect(x, ky, kw, kh, { stroke: '#e5e7eb', width: 0.8, radius: 5 });
    doc.text(label, x + 8, ky + 14, { size: 7.5, color: GRAY, maxWidth: kw - 16 });
    doc.text(value, x + 8, ky + 30, { size: 12.5, bold: true, maxWidth: kw - 16 });
  });
  y += Math.ceil(kpis.length / 4) * (kh + gap);

  const size = 8;
  const lh = 10;
  const pad = 4;
  for (const t of reportTables(V, r)) {
    if (!t.rows.length && !t.empty) continue;
    const scale = W / t.cols.reduce((a, c) => a + c[1], 0);
    const cols = t.cols.map(([label, w, kind]) => ({ label, w: w * scale, kind }));
    const at = (c, x) => (c.kind === 'num' ? x + c.w - pad : x + pad);
    const head = () => {
      let x = M;
      for (const c of cols) {
        doc.text(c.label, at(c, x), y + 9, { size: 7.5, bold: true, color: DARK, align: c.kind === 'num' ? 'right' : 'left', maxWidth: c.w - 2 * pad });
        x += c.w;
      }
      y += 13;
      doc.line(M, y, M + W, y, { color: '#9ca3af', width: 0.9 });
    };
    // titre de section jamais seul en bas de page
    if (y + 60 > BOTTOM) {
      doc.page();
      y = TOP;
    }
    y += 18;
    doc.text(t.title.toUpperCase(), M, y, { size: 9, bold: true, color: DARK });
    y += 4;
    if (!t.rows.length) {
      doc.text(t.empty, M, y + 12, { size: 8.5, color: GRAY });
      y += 16;
      continue;
    }
    head();
    const row = (cells, bold) => {
      const lines = cells.map((v, i) => (cols[i].kind === 'wrap' ? pdfWrap(v, cols[i].w - 2 * pad, size, bold, 3) : [String(v ?? '')]));
      const h = Math.max(...lines.map((l) => l.length)) * lh + 5;
      if (y + h > BOTTOM) {
        doc.page();
        y = TOP;
        head();
      }
      if (bold) doc.line(M, y, M + W, y, { color: '#9ca3af', width: 0.9 });
      let x = M;
      cols.forEach((c, i) => {
        // un montant n'est JAMAIS coupé : aligné à droite, il déborde plutôt sur la marge de la colonne voisine
        for (const [j, ln] of lines[i].entries()) doc.text(ln, at(c, x), y + 10 + j * lh, { size, bold, align: c.kind === 'num' ? 'right' : 'left', maxWidth: c.kind === 'num' ? 0 : c.w - 2 * pad });
        x += c.w;
      });
      y += h;
      if (!bold) doc.line(M, y, M + W, y, { color: '#e5e7eb', width: 0.5 });
    };
    for (const cells of t.rows) row(cells, false);
    if (t.total) row(t.total, true);
  }

  const formula = pdfWrap(REPORT_FORMULA, W, 7.5);
  if (y + 22 + formula.length * 10 > BOTTOM) {
    doc.page();
    y = TOP;
  }
  y += 22;
  for (const ln of formula) {
    doc.text(ln, M, y, { size: 7.5, color: GRAY });
    y += 10;
  }
  const n = doc.pageCount;
  for (let i = 0; i < n; i++) {
    doc.usePage(i);
    doc.text(`${SITE.name} · Bilan de ${r.range.label}`, M, doc.H - 26, { size: 7.5, color: GRAY });
    doc.text(`Page ${i + 1}/${n}`, doc.W - M, doc.H - 26, { size: 7.5, color: GRAY, align: 'right' });
  }
  return doc.output();
}

// Impression directe du navigateur. Sur iPhone en appli installée (écran d'accueil),
// window.print() ne fait RIEN : seul le PDF est alors proposé.
function canPrint() {
  if (typeof window.print !== 'function') return false;
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
  return !(ios && standalone);
}

// Imprime un contenu seul (la page de l'appli est masquée pendant l'impression, classe pr-on).
// La feuille reste en place jusqu'au changement d'écran : sur certains téléphones, l'aperçu
// est préparé APRÈS l'évènement afterprint (l'effacer à ce moment imprimerait une page blanche).
function printSheet(content) {
  let root = document.getElementById('print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'print-root';
    document.body.appendChild(root);
    window.addEventListener('hashchange', () => {
      root.innerHTML = '';
      document.documentElement.classList.remove('pr-on');
    });
  }
  root.innerHTML = String(content);
  document.documentElement.classList.add('pr-on');
  window.print();
}

// Crée le PDF puis le partage (téléphone : Imprimer, Enregistrer, envoyer…) ou le télécharge (ordinateur)
async function sharePdf(filename, build) {
  let pdf;
  try {
    pdf = build();
  } catch (e) {
    console.error(`[${SITE.id}] PDF`, e);
    toast('Le PDF n’a pas pu être créé. Réessaie dans un instant.', { tone: 'bad' });
    return false;
  }
  return saveFile(filename, pdf, 'application/pdf');
}

VIEWS.bilan = {
  render(V, route) {
    const r = monthReport(V, route.params.m);
    return html`
      ${pageHeader('Bilan du mois', 'À garder, imprimer ou envoyer', html`${btn('', { size: 'icon', variant: 'ghost', icon: 'ChevronLeft', action: 'bilan-month', attrs: { 'data-value': shiftMonth(r.range.ym, -1) }, title: 'Mois précédent' })}${btn('', { size: 'icon', variant: 'ghost', icon: 'ChevronRight', action: 'bilan-month', attrs: { 'data-value': shiftMonth(r.range.ym, 1) }, title: 'Mois suivant' })}${btn('PDF', { variant: 'primary', icon: 'FileDown', action: 'bilan-pdf', title: 'Créer le PDF du bilan' })}${canPrint() ? btn('Imprimer', { variant: 'ghost', icon: 'Printer', action: 'bilan-print' }) : ''}`)}
      <p class="mb-3 text-[12px] text-slate-500">« PDF » crée le fichier : sur téléphone, le menu de partage s’ouvre (Imprimer, Enregistrer dans Fichiers, WhatsApp…).</p>
      <div class="pr-preview">${reportHtml(V, r)}</div>`;
  },
};
Actions['bilan-month'] = (el) => go(`#/bilan?m=${el.dataset.value}`);
Actions['bilan-print'] = () => printSheet(reportHtml(Store.V, monthReport(Store.V, App.route.params.m)));
Actions['bilan-pdf'] = () => {
  const r = monthReport(Store.V, App.route.params.m);
  return sharePdf(`${SITE.id}-bilan-${r.range.ym}.pdf`, () => reportPdf(Store.V, r));
};
Actions['open-bilan'] = () => go('#/bilan');

/* ---------- étiquettes QR des bobines ---------- */
const Labels = { selected: null };
const spoolLink = (id) => `${location.origin}${location.pathname}#/bobines?peser=${id}`;

function makeQr(text) {
  if (!globalThis.qrcode) return null;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr;
  } catch {
    return null;
  }
}
function qrSvg(text) {
  const qr = makeQr(text);
  return qr ? qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true }) : '';
}

const labelSpools = (V, ids) => ids.map((id) => V.spools.get(id)).filter(Boolean);
const labelPrice = (s) => `${fmtG(s.initial_weight_g)} · ${fmtEur(s.price)} · ${fmtNum(spoolCpg(s) * 1000, 2)} €/kg`;

function labelsHtml(V, ids) {
  return html`<div class="pr-labels">${labelSpools(V, ids).map((s) => html`<div class="pr-label">
    <div class="qr">${raw(qrSvg(spoolLink(s.id)))}</div>
    <div class="txt">
      <b><span class="pr-swatch" style="background:${safeHex(s.color_hex)}"></span> ${s.color_name || 'Sans nom'}</b>
      <span>${[s.brand, s.material].filter(Boolean).join(' · ')}</span>
      <span>${labelPrice(s)}</span>
      ${s.purchased_at ? html`<span>Achat : ${fmtPlainDate(s.purchased_at)}</span>` : ''}
      <small>Scanne pour peser</small>
    </div>
  </div>`)}</div>`;
}

// Planche A4 : 2 × 7 étiquettes de 93 × 37 mm, pointillés de découpe
const LABEL_GRID = { cols: 2, rows: 7 };
function labelsPdf(V, ids, linkOf = spoolLink) {
  const doc = pdfDocument('Étiquettes des bobines');
  const { cols, rows } = LABEL_GRID;
  const mx = 10 * MM;
  const my = 10 * MM;
  const gx = 4 * MM;
  const gy = 3 * MM;
  const lw = (doc.W - 2 * mx - gx) / cols;
  const lh = (doc.H - 2 * my - (rows - 1) * gy) / rows;
  const pad = 3 * MM;
  const qs = lh - 2 * pad;
  labelSpools(V, ids).forEach((s, i) => {
    const k = i % (cols * rows);
    if (k === 0) doc.page();
    const x = mx + (k % cols) * (lw + gx);
    const y = my + Math.floor(k / cols) * (lh + gy);
    doc.rect(x, y, lw, lh, { stroke: '#9ca3af', width: 0.6, dash: [3, 2], radius: 2.5 * MM });
    const code = makeQr(linkOf(s.id));
    if (code) doc.qr(code, x + pad, y + pad, qs);
    const tx = x + pad + qs + 4 * MM;
    const tw = x + lw - pad - tx;
    doc.circle(tx + 4.5, y + pad + 9, 4.2, { fill: safeHex(s.color_hex), stroke: '#6b7280', width: 0.5 });
    doc.text(s.color_name || 'Sans nom', tx + 12, y + pad + 13, { size: 12, bold: true, maxWidth: tw - 12 });
    doc.text([s.brand, s.material].filter(Boolean).join(' · '), tx, y + pad + 29, { size: 9, color: '#374151', maxWidth: tw });
    doc.text(labelPrice(s), tx, y + pad + 42, { size: 9, color: '#374151', maxWidth: tw });
    if (s.purchased_at) doc.text(`Achat : ${fmtPlainDate(s.purchased_at)}`, tx, y + pad + 55, { size: 8, color: '#6b7280', maxWidth: tw });
    doc.text('Scanne pour peser', tx, y + lh - pad - 2, { size: 7.5, color: '#6b7280', maxWidth: tw });
  });
  return doc.output();
}

const selectedLabelIds = () => [...(Labels.selected || [])].filter((id) => Store.V.spools.has(id));

VIEWS.etiquettes = {
  render(V, route) {
    const active = activeSpools(V).sort((a, b) => a.material.localeCompare(b.material, SITE.lang) || (a.color_name || '').localeCompare(b.color_name || '', SITE.lang));
    if (!Labels.selected) {
      const wanted = String(route.params.ids || '').split(',').filter((id) => V.spools.has(id));
      Labels.selected = new Set(wanted.length ? wanted : active.map((s) => s.id));
    }
    const ids = [...Labels.selected].filter((id) => V.spools.has(id));
    const ready = !!globalThis.qrcode;
    const off = ids.length && ready ? {} : { disabled: true };
    return html`
      ${pageHeader('Étiquettes des bobines', 'Colle-les sur les bobines : scannées, la pesée s’ouvre directement', html`${btn(`PDF (${fmtNum(ids.length)})`, { variant: 'primary', icon: 'FileDown', action: 'labels-pdf', attrs: off, title: 'Créer le PDF des étiquettes' })}${canPrint() ? btn('Imprimer', { variant: 'ghost', icon: 'Printer', action: 'labels-print', attrs: off }) : ''}`)}
      <p class="mb-3 text-[12px] text-slate-500">Feuille A4 : ${fmtNum(LABEL_GRID.cols * LABEL_GRID.rows)} étiquettes par page, à découper le long des pointillés.</p>
      ${active.length ? html`<div class="card mb-4 p-3">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[13px] text-slate-400"><span>${plural(ids.length, 'bobine choisie', 'bobines choisies')}</span>
          <span class="flex gap-2">${btn('Toutes', { size: 'sm', variant: 'ghost', action: 'labels-all' })}${btn('Aucune', { size: 'sm', variant: 'ghost', action: 'labels-none' })}</span></div>
        <div class="flex flex-wrap gap-1.5">${active.map((s) => html`<button data-action="labels-toggle" data-id="${s.id}" aria-pressed="${Labels.selected.has(s.id)}" class="chip ${Labels.selected.has(s.id) ? 'chip-active' : ''}"><span class="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style="background:${safeHex(s.color_hex)}"></span>${s.color_name || 'Sans nom'} · ${s.material}</button>`)}</div>
      </div>` : emptyCard({ icon: 'Disc3', title: 'Aucune bobine active', text: 'Ajoute d’abord des bobines.' })}
      ${ready ? html`<div class="pr-preview">${labelsHtml(V, ids)}</div>` : html`<p class="text-[13px] text-slate-400">Préparation des QR codes… (connexion internet nécessaire la première fois)</p>`}`;
  },
  mount() {
    if (globalThis.qrcode || this.loading) return;
    this.loading = true;
    loadScript(QR_URL, QR_SRI)
      .then(() => App.render())
      .catch(() => toast('QR codes indisponibles : vérifie la connexion internet puis réessaie.', { tone: 'warn' }))
      .finally(() => { this.loading = false; });
  },
};
Actions['labels-toggle'] = (el) => {
  const id = el.dataset.id;
  if (Labels.selected.has(id)) Labels.selected.delete(id);
  else Labels.selected.add(id);
  App.render();
};
Actions['labels-all'] = () => {
  Labels.selected = new Set(activeSpools(Store.V).map((s) => s.id));
  App.render();
};
Actions['labels-none'] = () => {
  Labels.selected = new Set();
  App.render();
};
Actions['labels-print'] = () => {
  const ids = selectedLabelIds();
  if (ids.length) printSheet(html`<div class="pr-sheet pr-sheet-labels">${labelsHtml(Store.V, ids)}</div>`);
};
Actions['labels-pdf'] = () => {
  const ids = selectedLabelIds();
  if (!ids.length || !globalThis.qrcode) return;
  return sharePdf(`${SITE.id}-etiquettes-${dayKey(new Date().toISOString())}.pdf`, () => labelsPdf(Store.V, ids));
};
Actions['open-labels'] = (el) => {
  Labels.selected = null;
  go(el && el.dataset.id ? `#/etiquettes?ids=${el.dataset.id}` : '#/etiquettes');
};

/* ---------- scanner une étiquette avec la caméra, DANS l'appli ---------- */
// Sur iPhone, l'appareil photo ouvre les liens dans Safari, pas dans l'appli installée (qui a sa propre
// mémoire : il faudrait s'y reconnecter). Le bouton « Scanner » lit l'étiquette sans quitter l'appli.
const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
const JSQR_SRI = '__SRI_JSQR__';
const canScan = () => !!(typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

// Identifiant de bobine dans le lien d'une étiquette (…#/bobines?peser=<id>) ; rien d'autre n'est lu
function spoolIdFromLabel(text) {
  const m = /[#&?]peser=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f-])/i.exec(String(text || ''));
  return m ? m[1].toLowerCase() : null;
}

function cameraError(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Accès à la caméra refusé. Autorise-le dans les réglages du navigateur (sur iPhone : Réglages → Safari → Caméra), puis réessaie.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError') return 'Aucune caméra trouvée sur cet appareil.';
  if (n === 'NotReadableError') return 'La caméra est déjà utilisée par une autre appli : ferme-la puis réessaie.';
  return 'La caméra n’a pas pu démarrer.';
}

function openScanner() {
  const st = { stream: null, timer: 0, closed: false, lastOther: '' };
  const say = (m, text, bad = false) => {
    const p = m.q('[data-scan-msg]');
    if (!p) return;
    p.textContent = text;
    p.className = `text-[13px] ${bad ? 'text-rose-300' : 'text-slate-400'}`;
  };
  const stop = () => {
    st.closed = true;
    clearTimeout(st.timer);
    if (st.stream) for (const t of st.stream.getTracks()) t.stop();
    st.stream = null;
  };
  const found = (m, id) => {
    stop();
    m.close();
    const s = Store.V.spools.get(id);
    if (s) openWeighModal(s);
    else toast('Bobine introuvable sur cet appareil (supprimée, ou pas encore synchronisée).', { tone: 'warn' });
  };
  const start = async (m) => {
    try {
      if (!globalThis.jsQR) await loadScript(JSQR_URL, JSQR_SRI);
    } catch {
      return say(m, 'Lecteur de QR code indisponible : il faut internet la première fois.', true);
    }
    if (st.closed) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (e) {
      return say(m, cameraError(e), true);
    }
    // fenêtre fermée pendant l'autorisation : on rend la caméra tout de suite
    if (st.closed) {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    st.stream = stream;
    const video = m.q('video');
    video.srcObject = stream;
    try {
      await video.play();
    } catch { /* lecture automatique : la vidéo démarre quand même (muette) */ }
    say(m, 'Vise le QR code de l’étiquette.');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = () => {
      if (st.closed) return;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w && h) {
        const k = Math.min(1, 720 / Math.max(w, h));
        canvas.width = Math.round(w * k);
        canvas.height = Math.round(h * k);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = globalThis.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (code && code.data) {
          const id = spoolIdFromLabel(code.data);
          if (id) return found(m, id);
          if (code.data !== st.lastOther) {
            st.lastOther = code.data;
            say(m, 'Ce QR code n’est pas une étiquette de bobine.', true);
          }
        }
      }
      st.timer = setTimeout(tick, 160);
    };
    tick();
  };
  Modal.open({
    title: 'Scanner une étiquette',
    subtitle: 'La pesée de la bobine s’ouvre directement',
    size: 'md',
    render: () => ({
      body: html`<div class="space-y-3">
        <div class="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-2xl bg-black">
          <video class="h-full w-full object-cover" playsinline muted autoplay></video>
          <div class="pointer-events-none absolute inset-[16%] rounded-2xl border-2 border-neon/70"></div>
        </div>
        <p class="text-[13px] text-slate-400" data-scan-msg aria-live="polite">Démarrage de la caméra…</p>
      </div>`,
      footer: html`<div class="flex justify-end">${btn('Fermer', { variant: 'ghost', action: 'cancel' })}</div>`,
    }),
    onMount: (m) => { start(m); },
    actions: { cancel: (el, e, m) => m.close() },
    onClose: stop,
  });
}
Actions['scan-label'] = () => openScanner();

// Étiquette scannée : #/bobines?peser=<id> ouvre la pesée de cette bobine
VIEWS.bobines.mount = function mountBobines(V, route) {
  const id = route.params.peser;
  if (!id) return;
  history.replaceState(null, '', '#/bobines');
  App.route = parseHash();
  const open = () => {
    const s = Store.V.spools.get(id);
    if (s) openWeighModal(s);
    else toast('Bobine introuvable sur cet appareil (supprimée, ou pas encore synchronisée).', { tone: 'warn' });
  };
  if (Store.V.spools.has(id) || Sync.state.firstPullDone || !Sync.backend || Sync.backend.kind !== 'supabase') return open();
  // appareil qui démarre : on attend la première synchronisation (30 s au plus, hors-ligne elle ne vient pas)
  let timer = null;
  const off = Sync.subscribe((st) => {
    if (!st.firstPullDone && !Store.V.spools.has(id)) return;
    off();
    clearTimeout(timer);
    open();
  });
  timer = setTimeout(() => {
    off();
    open();
  }, 30000);
};
