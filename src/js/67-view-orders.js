/* =============================================================================
   Commandes clients : ce qui a été promis, jusqu'à la livraison
   À faire → (Produire) → Prête → (Livrer = enregistrer la vente) → Livrée
   ============================================================================= */

// Date promise (jour sans heure) : lue comme un jour LOCAL, jamais décalée par le fuseau
function fmtDueDate(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

function orderDueBadge(o) {
  if (o.status !== 'todo' && o.status !== 'ready') return '';
  const n = orderDueIn(o);
  if (n === null) return '';
  if (n < 0) return badge(`En retard de ${plural(-n, 'jour', 'jours')}`, 'bad', { dot: true });
  if (n === 0) return badge("Pour aujourd'hui", 'warn', { dot: true });
  if (n === 1) return badge('Pour demain', 'warn');
  return badge(`Dans ${plural(n, 'jour', 'jours')}`, n <= 3 ? 'warn' : 'off');
}

function orderRow(V, o) {
  const t = o.template_id ? V.templates.get(o.template_id) : null;
  const total = orderTotal(o);
  const stock = t ? stockForTemplate(V, t.id) : 0;
  const pending = pendingBadge(V, `orders:${o.id}`);
  const open = o.status === 'todo' || o.status === 'ready';
  return html`<div class="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:px-4 ${open ? '' : 'opacity-70'}">
    <div class="flex min-w-0 flex-1 items-start gap-3">
      <div class="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-ink-850 p-1">${layeredThumb(t ? t.materials : [], t ? t.photo : null)}</div>
      <div class="min-w-0 flex-1">
        <div class="flex items-start gap-2">
          <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <span class="line-clamp-2 text-sm font-semibold leading-snug text-slate-100">${o.item_name} × ${fmtNum(o.quantity)}</span>
            ${orderDueBadge(o)}${open ? '' : badge(ORDER_STATUS[o.status].label, 'off')}
          </div>
          ${btn('', { size: 'iconSm', variant: 'ghost', icon: 'EllipsisVertical', action: 'order-menu', attrs: { 'data-id': o.id }, title: 'Plus d’actions', cls: '-mr-2 -mt-1 shrink-0' })}
        </div>
        <div class="mt-0.5 flex flex-wrap gap-x-1.5 text-[12px] text-slate-500">
          <span>${o.customer || 'Client non précisé'}</span>
          ${o.due_date ? html`<span>· pour ${fmtDueDate(o.due_date)}</span>` : ''}
          ${total !== null ? html`<span>· ${fmtEur(total)}</span>` : ''}
          ${t && o.status === 'todo' ? html`<span class="${stock >= o.quantity ? 'text-neon' : ''}">· ${fmtNum(stock)} en stock</span>` : ''}
        </div>
        ${o.note ? html`<div class="mt-1 line-clamp-2 text-[12px] text-slate-400">${o.note}</div>` : ''}
        ${pending ? html`<div class="mt-1">${pending}</div>` : ''}
      </div>
    </div>
    ${open ? html`<div class="flex shrink-0 flex-wrap gap-2 sm:justify-end">
      ${o.status === 'todo' && t ? btn('Produire', { size: 'sm', variant: 'ghost', icon: 'Printer', action: 'order-produce', attrs: { 'data-id': o.id } }) : ''}
      ${o.status === 'todo' ? btn('Prête', { size: 'sm', variant: 'ghost', icon: 'PackageCheck', action: 'order-ready', attrs: { 'data-id': o.id } }) : ''}
      ${btn('Livrer', { size: 'sm', variant: o.status === 'ready' ? 'primary' : 'ghost', icon: 'ShoppingBag', action: 'order-deliver', attrs: { 'data-id': o.id } })}
    </div>` : ''}
  </div>`;
}

function ordersTab(V) {
  const all = valuesOf(V.orders);
  const open = openOrders(V);
  const todo = open.filter((o) => o.status === 'todo');
  const ready = open.filter((o) => o.status === 'ready');
  const done = all.filter((o) => o.status === 'delivered' || o.status === 'cancelled')
    .sort((a, b) => time(b.updated_at) - time(a.updated_at)).slice(0, 20);
  const late = open.filter((o) => (orderDueIn(o) ?? 0) < 0).length;
  const section = (title, list) => (list.length ? html`<h3 class="mb-2 mt-5 px-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500">${title}</h3>
    <div class="card divide-y divide-white/[0.05] overflow-hidden">${list.map((o) => orderRow(V, o))}</div>` : '');
  return html`
    <div class="mb-1 flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm text-slate-400">${open.length
        ? html`<span class="font-semibold text-slate-100">${fmtNum(open.length)}</span> ${open.length >= 2 ? 'commandes en cours' : 'commande en cours'}${late ? html` · <span class="font-semibold text-rose-300">${plural(late, 'en retard', 'en retard')}</span>` : ''}`
        : 'Aucune commande en cours'}</p>
      ${btn('Nouvelle commande', { size: 'sm', variant: 'primary', icon: 'Plus', action: 'order-new' })}
    </div>
    ${all.length ? '' : emptyCard({ icon: 'ClipboardList', title: 'Aucune commande', text: 'Note ici ce que tes clients t’ont demandé : pièce, quantité, prix et date promise. Les échéances s’affichent sur le tableau de bord.', actions: btn('Nouvelle commande', { variant: 'primary', icon: 'Plus', action: 'order-new' }) })}
    ${section('À faire', todo)}
    ${section('Prêtes à livrer', ready)}
    ${section('Livrées et annulées (récentes)', done)}`;
}

// Tableau de bord : commandes en cours (seulement s'il y en a)
function ordersCard(V) {
  const open = openOrders(V);
  if (!open.length) return '';
  const late = open.filter((o) => (orderDueIn(o) ?? 0) < 0).length;
  const next = open[0];
  return html`<button data-action="order-tab" class="card mb-3 flex w-full flex-wrap items-center gap-3 p-4 text-left transition hover:border-white/15 ${late ? 'border-rose-500/30' : ''}">
    <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl ${late ? 'bg-rose-500/10 text-rose-300' : 'bg-cyan-400/10 text-cyan-300'}">${icon('ClipboardList', 'w-5 h-5')}</span>
    <span class="min-w-0 flex-1">
      <span class="block text-sm font-semibold text-slate-100">${plural(open.length, 'commande en cours', 'commandes en cours')}${late ? html` · <span class="text-rose-300">${plural(late, 'en retard', 'en retard')}</span>` : ''}</span>
      <span class="block truncate text-[12px] text-slate-400">Prochaine : ${next.item_name} × ${fmtNum(next.quantity)}${next.customer ? ` pour ${next.customer}` : ''}${next.due_date ? ` · ${fmtDueDate(next.due_date)}` : ''}</span>
    </span>
    <span class="text-slate-500">${icon('ChevronRight', 'w-5 h-5')}</span>
  </button>`;
}

Actions['order-tab'] = () => {
  App.ui.stockTab = 'orders';
  App.saveUi();
  go('#/stock');
};

function openOrderModal({ order = null, templateId = null }) {
  const V0 = Store.V;
  const st0 = settingsOf(V0);
  const editing = !!order;
  const templates = valuesOf(V0.templates).filter((t) => !t.archived || (order && t.id === order.template_id)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const priceFor = (tid) => {
    const t = tid ? Store.V.templates.get(tid) : null;
    return t ? templatePrice(Store.V, t).price : null;
  };
  const firstTpl = order ? order.template_id : templateId || (templates[0] && templates[0].id) || null;
  const d = order
    ? { ...pick(order, ORDER_FIELDS), mode: order.template_id ? 'template' : 'custom' }
    : {
      id: uuid(), customer: '', template_id: firstTpl, item_name: '', quantity: 1, unit_price: priceFor(firstTpl),
      due_date: '', channel: lsGet('p3d_last_channel', null), note: '', status: 'todo', sale_id: null, mode: firstTpl ? 'template' : 'custom',
    };
  d.busy = false;
  Modal.open({
    title: editing ? 'Modifier la commande' : 'Nouvelle commande',
    subtitle: 'Ce que le client a demandé, et pour quand',
    size: 'md',
    render: () => ({
      body: html`<div class="space-y-4">
        ${field('Client', inputText('customer', d.customer, { placeholder: 'ex. Marie (Vinted)', maxlength: 120, attrs: { autofocus: true } }))}
        ${templates.length ? segmented('mode', [{ value: 'template', label: 'Depuis un template' }, { value: 'custom', label: 'Autre pièce' }], d.mode, { action: 'mode', cls: 'w-full [&>button]:flex-1' }) : ''}
        ${d.mode === 'template' && templates.length
          ? field('Pièce', selectInput('template_id', templates.map((t) => ({ value: t.id, label: t.archived ? `${t.name} (archivé)` : t.name })), d.template_id))
          : field('Pièce', inputText('item_name', d.item_name, { placeholder: 'ex. Figurine sur mesure', maxlength: 120 }))}
        <div class="grid grid-cols-2 gap-3">
          ${field('Quantité', inputNum('quantity', d.quantity, { placeholder: '1', inputmode: 'numeric' }))}
          ${field('Prix unitaire convenu', inputNum('unit_price', d.unit_price, { suffix: '€', placeholder: '—' }))}
        </div>
        ${field('Pour le', html`<input class="input" type="date" name="due_date" value="${d.due_date || ''}"/>`, { hint: 'Date promise au client (facultatif).' })}
        <div><span class="label">Canal</span><div class="flex flex-wrap gap-1.5">
          <button type="button" data-action="channel" data-value="" aria-pressed="${!d.channel}" class="chip ${!d.channel ? 'chip-active' : ''}">Non précisé</button>
          ${st0.sales_channels.map((c) => html`<button type="button" data-action="channel" data-value="${c.id}" aria-pressed="${d.channel === c.id}" class="chip ${d.channel === c.id ? 'chip-active' : ''}">${c.name}</button>`)}
        </div></div>
        ${field('Note', html`<textarea class="input h-20 py-2" name="note" maxlength="1000" placeholder="Couleur, taille, personnalisation, adresse…">${d.note || ''}</textarea>`)}
      </div>`,
      footer: html`<div class="flex justify-end gap-2">${btn('Annuler', { variant: 'ghost', action: 'cancel' })}${btn(editing ? 'Enregistrer' : 'Ajouter la commande', { variant: 'primary', icon: 'Check', action: 'submit' })}</div>`,
    }),
    onInput: (e, m) => {
      const el = e.target;
      if (!el.name) return;
      if (el.name === 'quantity' || el.name === 'unit_price') {
        d[el.name] = el.value.trim() === '' ? null : parseNum(el.value);
        if (el.name === 'quantity') setFieldError(m.el, 'quantity', el.value.trim() && !isPieceCount(d.quantity) ? PIECES_ERROR : '');
        return;
      }
      if (el.name === 'template_id') {
        d.template_id = el.value;
        const price = priceFor(el.value);
        if (price !== null) d.unit_price = price;
        m.render();
        return;
      }
      d[el.name] = el.value;
    },
    actions: {
      cancel: (el, e, m) => m.close(),
      mode: (el, e, m) => {
        d.mode = el.dataset.value;
        if (d.mode === 'template' && !d.template_id && templates[0]) {
          d.template_id = templates[0].id;
          d.unit_price = priceFor(d.template_id);
        }
        m.render();
      },
      channel: (el, e, m) => {
        d.channel = el.dataset.value || null;
        m.render();
      },
      submit: async (el, e, m) => {
        if (d.busy) return;
        const t = d.mode === 'template' && d.template_id ? Store.V.templates.get(d.template_id) : null;
        const name = t ? t.name : String(d.item_name || '').trim();
        if (!name) return setFieldError(m.el, 'item_name', 'Indique la pièce commandée.');
        if (!isPieceCount(d.quantity)) return setFieldError(m.el, 'quantity', PIECES_ERROR);
        if (toNum(d.quantity) > ORDER_MAX_QTY) return setFieldError(m.el, 'quantity', `${fmtNum(ORDER_MAX_QTY)} pièces au plus.`);
        if (d.unit_price !== null && (!Number.isFinite(d.unit_price) || d.unit_price < 0 || d.unit_price >= 1e8)) return setFieldError(m.el, 'unit_price', 'Prix invalide.');
        d.busy = true;
        const fields = {
          customer: String(d.customer || '').trim().slice(0, 120),
          template_id: t ? t.id : null,
          item_name: name.slice(0, 120),
          quantity: toNum(d.quantity),
          unit_price: d.unit_price === null ? null : roundDb(d.unit_price, 2),
          due_date: d.due_date || null,
          channel: d.channel || null,
          note: String(d.note || '').trim().slice(0, 1000) || null,
        };
        // modification : seulement ces champs, JAMAIS l'état ni le lien vers la vente (une livraison faite
        // sur un autre appareil pendant que cette fenêtre était ouverte ne doit pas être défaite)
        const res = editing
          ? await runOp('order.patch', { id: d.id, fields }, { success: 'Commande modifiée' })
          : await runOp('order.save', { id: d.id, ...fields, status: 'todo', sale_id: null }, { success: 'Commande ajoutée' });
        d.busy = false;
        if (opAccepted(res)) m.close();
      },
    },
  });
}

const orderById = (id) => Store.V.orders.get(id);

Actions['order-new'] = () => openOrderModal({});

Actions['order-ready'] = async (el) => {
  const o = orderById(el.dataset.id);
  if (o) await runOp('order.patch', { id: o.id, fields: { status: 'ready' }, from: ['todo'] }, { success: `Commande prête : ${o.item_name} × ${fmtNum(o.quantity)}` });
};

// Produire pour une commande : la production est préremplie ; une fois lancée, la commande est prête
Actions['order-produce'] = (el) => {
  const o = orderById(el.dataset.id);
  if (!o || !o.template_id) return;
  openProductionModal({
    kind: 'production',
    templateId: o.template_id,
    quantity: o.quantity,
    onDone: () => Sync.enqueue('order.patch', { id: o.id, fields: { status: 'ready' }, from: ['todo'] }, { wait: 0, silent: true }),
  });
};

// Livrer = enregistrer la vente (préremplie) ; la commande passe « livrée » et garde le lien vers la vente
Actions['order-deliver'] = (el) => {
  const o = orderById(el.dataset.id);
  if (o) openSaleModal({ templateId: o.template_id, itemName: o.template_id ? null : o.item_name, order: o });
};

Actions['order-menu'] = (el) => {
  const o = orderById(el.dataset.id);
  if (!o) return;
  const row = (ic, label, action, tone = 'text-slate-200') => html`<button data-action="${action}" class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] ${tone} hover:bg-white/[0.04]">${icon(ic, 'w-5 h-5 text-slate-400')}${label}</button>`;
  Modal.open({
    title: `${o.item_name} × ${fmtNum(o.quantity)}`,
    subtitle: o.customer || '',
    size: 'sm',
    render: () => html`<div class="-mx-2">
      ${row('Pencil', 'Modifier', 'm-edit')}
      ${o.status === 'ready' || o.status === 'cancelled' ? row('RotateCcw', 'Remettre « à faire »', 'm-todo') : ''}
      ${o.status === 'todo' || o.status === 'ready' ? row('CircleX', 'Annuler la commande', 'm-cancel') : ''}
      ${row('Trash2', 'Supprimer', 'm-delete', 'text-rose-300')}
      ${o.status === 'delivered' ? html`<p class="px-3 pt-2 text-[12px] text-slate-500">Livraison à annuler ? Supprime la vente (Stock &amp; Ventes → Ventes) : les pièces reviennent en stock et la commande redevient « prête ».</p>` : ''}
    </div>`,
    actions: {
      'm-edit': (b, e, m) => { m.close(); openOrderModal({ order: o }); },
      'm-todo': async (b, e, m) => { m.close(); await runOp('order.patch', { id: o.id, fields: { status: 'todo' }, from: ['ready', 'cancelled'] }, { success: 'Commande remise « à faire »' }); },
      'm-cancel': async (b, e, m) => { m.close(); await runOp('order.patch', { id: o.id, fields: { status: 'cancelled' }, from: ['todo', 'ready'] }, { success: 'Commande annulée' }); },
      'm-delete': async (b, e, m) => {
        m.close();
        const ok = await confirmBox({ title: 'Supprimer cette commande ?', message: o.sale_id ? 'La vente déjà enregistrée n’est pas touchée : seule la commande disparaît.' : 'Elle disparaît de la liste. Rien d’autre n’est modifié (stock, ventes).', confirm: 'Supprimer' });
        if (ok) await runOp('order.delete', { id: o.id }, { success: 'Commande supprimée' });
      },
    },
  });
};
