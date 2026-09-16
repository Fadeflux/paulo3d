/* =============================================================================
   Paramètres
   ============================================================================= */

const QR_URL = 'https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.js';
const QR_SRI = '__SRI_QR__';

function settingsSection(id, ic, title, subtitle, body, footer = '') {
  return html`<section class="card overflow-hidden" id="${id}" data-form="${id}">
    <div class="flex items-start gap-3 border-b border-white/[0.06] px-4 py-4 sm:px-5">
      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.04] text-neon">${icon(ic, 'w-[18px] h-[18px]')}</span>
      <div class="min-w-0"><h2 class="font-semibold text-slate-100">${title}</h2>${subtitle ? html`<p class="text-[13px] text-slate-400">${subtitle}</p>` : ''}</div>
    </div>
    <div class="space-y-4 px-4 py-4 sm:px-5">${body}</div>
    ${footer ? html`<div class="flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.06] bg-white/[0.015] px-4 py-3 sm:px-5">${footer}</div>` : ''}
  </section>`;
}

function maskKey(k) {
  const s = String(k || '');
  return s.length > 16 ? `${s.slice(0, 12)}…${s.slice(-4)}` : s ? '••••' : '—';
}

VIEWS.parametres = {
  render(V) {
    const st = settingsOf(V);
    const backend = Sync.backend;
    const isDemo = backend && backend.kind === 'demo';
    const cfg = lsGet(LS.supa, null);
    const machines = valuesOf(V.machines).sort((a, b) => (a.archived - b.archived) || (b.is_default - a.is_default) || a.name.localeCompare(b.name, 'fr'));
    const example = suggestPrice(4, pricingOf(null, st));
    const pendingOps = Store.Q.length;

    return html`
      ${pageHeader('Paramètres', 'Connexion, taux horaires, prix et sauvegardes')}
      <div class="grid gap-4 lg:grid-cols-2">
        <div class="space-y-4">
          ${settingsSection('s-connexion', 'Database', 'Base de données', isDemo ? 'Mode démo : rien ne quitte cet appareil' : 'Supabase (PostgreSQL)', isDemo
            ? html`<p class="text-sm text-slate-300">Les données de démo sont stockées uniquement dans ce navigateur. Connecte Supabase pour les vraies données : PC et téléphone seront synchronisés.</p>
               <p class="text-[12px] text-slate-500">Les données de démo ne sont pas transférées vers Supabase.</p>`
            : html`<div class="grid gap-2 text-sm">
                <div class="flex justify-between gap-3"><span class="text-slate-400">Adresse du projet</span><span class="truncate font-mono text-[13px] text-slate-200">${cfg ? cfg.url : '—'}</span></div>
                <div class="flex justify-between gap-3"><span class="text-slate-400">Clé publique</span><span class="font-mono text-[13px] text-slate-200">${cfg ? maskKey(cfg.key) : '—'}</span></div>
                <div class="flex justify-between gap-3"><span class="text-slate-400">État</span><span class="text-slate-200">${Sync.summary().label}</span></div>
                <div class="flex justify-between gap-3"><span class="text-slate-400">Temps réel</span><span class="text-slate-200">${Sync.state.realtime === 'on' ? 'actif' : 'coupé'}</span></div>
                <div class="flex justify-between gap-3"><span class="text-slate-400">Schéma</span><span class="text-slate-200">${Sync.state.schemaVersion === null ? 'non vérifié' : `version ${Sync.state.schemaVersion}`}</span></div>
              </div>`,
            isDemo
              ? html`${btn('Remplir avec des exemples', { size: 'sm', variant: 'ghost', icon: 'Sparkles', action: 'demo-seed' })}${btn('Vider la démo', { size: 'sm', variant: 'ghost', icon: 'Trash2', action: 'demo-reset' })}${btn('Connecter Supabase', { size: 'sm', variant: 'primary', icon: 'PlugZap', action: 'connect-supabase' })}`
              : html`${btn('Autre appareil (QR code)', { size: 'sm', variant: 'ghost', icon: 'QrCode', action: 'pair-device' })}${btn('Modifier la connexion', { size: 'sm', icon: 'Pencil', action: 'connect-supabase' })}`)}

          ${isDemo ? '' : settingsSection('s-compte', 'UserRound', 'Compte', backend && backend.email ? backend.email : '', html`<p class="text-[13px] text-slate-400">Tu peux rester connecté sur plusieurs appareils avec le même compte : tout est synchronisé.</p>
            ${pendingOps ? html`<p class="rounded-xl bg-amber-400/10 p-3 text-[12px] text-amber-200">${pendingOps >= 2 ? `${pendingOps} actions pas encore envoyées : reste connecté jusqu'à ce qu'elles partent.` : "1 action pas encore envoyée : reste connecté jusqu'à ce qu'elle parte."}</p>` : ''}`,
            html`${btn('Changer le mot de passe', { size: 'sm', variant: 'ghost', icon: 'KeyRound', action: 'change-password' })}${btn('Se déconnecter', { size: 'sm', variant: 'danger', icon: 'LogOut', action: 'logout' })}`)}

          ${settingsSection('s-costs', 'Zap', "Coûts de l'atelier", 'Utilisés pour tous les calculs de coût de revient', html`
            ${field('Nom de l’atelier', inputText('workshop_name', st.workshop_name, { maxlength: 80 }))}
            <div class="grid grid-cols-2 gap-3">
              ${field('Taux machine par défaut', inputNum('machine_rate', st.machine_rate, { suffix: '€/h' }), { hint: 'Électricité + usure (buses, plateaux).' })}
              ${field("Taux main-d'œuvre", inputNum('labor_rate', st.labor_rate, { suffix: '€/h' }), { hint: 'Post-traitement, finitions.' })}
            </div>
            ${field('Prix du filament par défaut', inputNum('filament_price_kg', st.filament_price_kg, { suffix: '€/kg' }), { hint: 'Utilisé seulement si aucune bobine ne correspond à une matière.' })}`,
            btn('Enregistrer', { size: 'sm', variant: 'primary', icon: 'Check', action: 'save-settings', attrs: { 'data-section': 's-costs' } }))}

          ${settingsSection('s-machines', 'Printer', 'Machines', 'Chacune avec son coût horaire', machines.length
            ? html`<div class="divide-y divide-white/[0.05] rounded-2xl border border-white/[0.06]">${machines.map((mc) => html`<button data-action="machine-edit" data-id="${mc.id}" class="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-white/[0.03] ${mc.archived ? 'opacity-60' : ''}">
                <span class="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.04] text-slate-300">${icon('Printer', 'w-4 h-4')}</span>
                <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium text-slate-100">${mc.name}</span><span class="block truncate text-[12px] text-slate-500">${mc.model || 'Modèle non précisé'}</span></span>
                ${mc.is_default ? badge('Par défaut', 'ok') : ''}${mc.archived ? badge('Archivée', 'off') : ''}
                <span class="font-display text-sm font-semibold tabular-nums text-slate-200">${fmtNum(mc.hourly_rate, 2)} €/h</span>
              </button>`)}</div>`
            : html`<p class="text-[13px] text-slate-400">Aucune machine : le taux par défaut (${fmtNum(st.machine_rate, 2)} €/h) est utilisé partout.</p>`,
            btn('Ajouter une machine', { size: 'sm', icon: 'Plus', action: 'machine-new' }))}
        </div>

        <div class="space-y-4">
          ${settingsSection('s-pricing', 'Calculator', 'Prix de vente conseillé', `Exemple : pour 4,00 € de coût → ${fmtEur(example.rounded)}`, html`
            <div><span class="label">Méthode</span>${segmented('pricing_mode_setting', [{ value: 'coef', label: 'Coefficient' }, { value: 'margin', label: 'Marge brute visée' }], App.ui.pricingDraft || st.pricing_mode, { action: 'pricing-draft', cls: 'w-full [&>button]:flex-1' })}</div>
            <div class="grid grid-cols-2 gap-3">
              ${field('Coefficient', inputNum('price_coef', st.price_coef, { suffix: '×' }), { hint: 'Prix = coût × coefficient.' })}
              ${field('Marge brute', inputNum('target_margin_pct', st.target_margin_pct, { suffix: '%' }), { hint: 'Prix = coût ÷ (1 − marge).' })}
            </div>
            ${field('Arrondi du prix conseillé', selectInput('price_rounding', [
              { value: 'x.90', label: 'Terminé en ,90 (12,90 €)' },
              { value: '0.10', label: 'Aux 10 centimes supérieurs' },
              { value: '0.50', label: 'Aux 50 centimes supérieurs' },
              { value: '1', label: "À l'euro supérieur" },
              { value: 'none', label: 'Pas d’arrondi' },
            ], st.price_rounding))}`,
            btn('Enregistrer', { size: 'sm', variant: 'primary', icon: 'Check', action: 'save-settings', attrs: { 'data-section': 's-pricing' } }))}

          ${settingsSection('s-alerts', 'BellRing', 'Alertes bobines', 'Couleur des bobines selon le poids restant', html`
            <div class="grid grid-cols-2 gap-3">
              ${field('Orange sous', inputNum('spool_low_g', st.spool_low_g, { suffix: 'g', inputmode: 'numeric' }), { hint: 'Bientôt vide.' })}
              ${field('Rouge sous', inputNum('spool_critical_g', st.spool_critical_g, { suffix: 'g', inputmode: 'numeric' }), { hint: 'Stock critique.' })}
            </div>`,
            btn('Enregistrer', { size: 'sm', variant: 'primary', icon: 'Check', action: 'save-settings', attrs: { 'data-section': 's-alerts' } }))}

          ${settingsSection('s-channels', 'Store', 'Canaux de vente', 'Commission retirée automatiquement de la marge nette', html`
            <div class="space-y-2" id="channels-list">${(App.ui.channelsDraft || st.sales_channels).map((c, i) => html`<div class="grid grid-cols-[1fr_5.5rem_5.5rem_2.5rem] items-end gap-2">
              ${field(i === 0 ? 'Nom' : '', inputText('ch_name', c.name, { maxlength: 40, attrs: { 'data-ch': i } }))}
              ${field(i === 0 ? '%' : '', inputNum('ch_pct', c.pct, { suffix: '%', attrs: { 'data-ch': i } }))}
              ${field(i === 0 ? 'Fixe' : '', inputNum('ch_fixed', c.fixed, { suffix: '€', attrs: { 'data-ch': i } }))}
              ${btn('', { size: 'icon', variant: 'ghost', icon: 'X', action: 'channel-remove', attrs: { 'data-ch': i }, title: 'Retirer ce canal' })}
            </div>`)}</div>
            <p class="text-[12px] text-slate-500">Renseigne les frais réels de chaque plateforme (ils changent régulièrement). 0 = aucune commission.</p>`,
            html`${btn('Ajouter un canal', { size: 'sm', variant: 'ghost', icon: 'Plus', action: 'channel-add' })}${btn('Enregistrer', { size: 'sm', variant: 'primary', icon: 'Check', action: 'save-channels' })}`)}

          ${settingsSection('s-data', 'HardDriveDownload', 'Données et sauvegardes', '', html`
            <div class="grid gap-2 text-sm">
              <div class="flex justify-between"><span class="text-slate-400">Actions en attente d'envoi</span><span class="text-slate-200">${fmtNum(Store.Q.filter((o) => o.status !== 'failed').length)}</span></div>
              <div class="flex justify-between"><span class="text-slate-400">Actions refusées</span><span class="${Store.Q.some((o) => o.status === 'failed') ? 'text-rose-300' : 'text-slate-200'}">${fmtNum(Store.Q.filter((o) => o.status === 'failed').length)}</span></div>
              <div class="flex justify-between"><span class="text-slate-400">Dernière synchronisation</span><span class="text-slate-200">${Sync.state.lastPullAt ? fmtRelative(Sync.state.lastPullAt) : '—'}</span></div>
            </div>
            <p class="text-[12px] text-slate-500">Conseil : exporte une sauvegarde JSON de temps en temps (l'offre gratuite de Supabase ne garde pas d'historique restaurable).</p>`,
            html`${btn('Vider cet appareil', { size: 'sm', variant: 'ghost', icon: 'Eraser', action: 'clear-local' })}${btn('Synchro', { size: 'sm', variant: 'ghost', icon: 'RefreshCw', action: 'sync-panel' })}${btn('Exporter', { size: 'sm', variant: 'primary', icon: 'Download', action: 'export-open' })}`)}

          ${settingsSection('s-install', 'Smartphone', "Installer l'application", 'Icône sur l’écran d’accueil, plein écran, marche hors-ligne', html`
            ${isStandalone() ? html`<p class="flex items-center gap-2 text-sm text-neon">${icon('CircleCheck', 'w-4 h-4')}L'application est installée sur cet appareil.</p>` : ''}
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="rounded-2xl border border-white/[0.06] bg-ink-850 p-3 text-[13px] text-slate-300"><div class="mb-1 flex items-center gap-2 font-semibold text-slate-100">${icon('Smartphone', 'w-4 h-4')}iPhone / iPad</div>Dans <b>Safari</b> : bouton <b>Partager</b> ${icon('Share', 'w-3.5 h-3.5 inline')} puis <b>« Sur l'écran d'accueil »</b>.</div>
              <div class="rounded-2xl border border-white/[0.06] bg-ink-850 p-3 text-[13px] text-slate-300"><div class="mb-1 flex items-center gap-2 font-semibold text-slate-100">${icon('MonitorSmartphone', 'w-4 h-4')}Android / PC</div>Dans <b>Chrome</b> ou <b>Edge</b> : menu ⋮ puis <b>« Installer l'application »</b>.</div>
            </div>`,
            App.installPrompt ? btn('Installer maintenant', { size: 'sm', variant: 'primary', icon: 'Download', action: 'install-app' }) : '')}

          <p class="px-1 text-center text-[12px] text-slate-600">Paulo3D · version ${APP_VERSION} · schéma ${SCHEMA_VERSION}</p>
        </div>
      </div>`;
  },
};

function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}

Actions['pricing-draft'] = (el) => {
  App.ui.pricingDraft = el.dataset.value;
  App.render();
};

Actions['save-settings'] = async (el) => {
  const section = document.getElementById(el.dataset.section);
  if (!section) return;
  const f = readForm(section);
  const patch = {};
  const numFields = ['machine_rate', 'labor_rate', 'filament_price_kg', 'price_coef', 'target_margin_pct', 'spool_low_g', 'spool_critical_g'];
  for (const [k, v] of Object.entries(f)) {
    if (!SETTINGS_FIELDS.includes(k)) continue;
    if (numFields.includes(k)) {
      if (!Number.isFinite(v) || v < 0) return setFieldError(section, k, 'Valeur invalide.');
      patch[k] = roundDb(v, k === 'machine_rate' ? 4 : k === 'price_coef' ? 3 : 2);
    } else patch[k] = typeof v === 'string' ? v.trim() : v;
  }
  if ('workshop_name' in patch) patch.workshop_name = patch.workshop_name || 'Paulo3D';
  if ('price_coef' in patch && !(patch.price_coef > 0)) return setFieldError(section, 'price_coef', 'Doit être supérieur à 0.');
  if ('target_margin_pct' in patch && patch.target_margin_pct >= 100) return setFieldError(section, 'target_margin_pct', 'Doit être inférieure à 100 %.');
  if (el.dataset.section === 's-pricing') patch.pricing_mode = App.ui.pricingDraft || settingsOf(Store.V).pricing_mode;
  if ('spool_low_g' in patch && patch.spool_critical_g > patch.spool_low_g) return setFieldError(section, 'spool_critical_g', 'Le seuil rouge doit être sous le seuil orange.');
  const res = await runOp('settings.save', patch, { success: 'Paramètres enregistrés' });
  if (opAccepted(res) && el.dataset.section === 's-pricing') {
    delete App.ui.pricingDraft;
    App.saveUi();
  }
};

function channelsDraft() {
  if (!App.ui.channelsDraft) App.ui.channelsDraft = JSON.parse(JSON.stringify(settingsOf(Store.V).sales_channels));
  return App.ui.channelsDraft;
}

// Ce qui est tapé dans les champs → brouillon (avant tout réaffichage, sinon la saisie serait perdue)
function readChannelInputs() {
  const list = channelsDraft();
  const section = document.getElementById('s-channels');
  if (!section) return list;
  for (const inp of $$('[data-ch]', section)) {
    const i = +inp.dataset.ch;
    if (!list[i] || !inp.name) continue;
    if (inp.name === 'ch_name') list[i].name = inp.value.trim();
    if (inp.name === 'ch_pct') list[i].pct = inp.value.trim() === '' ? 0 : parseNum(inp.value);
    if (inp.name === 'ch_fixed') list[i].fixed = inp.value.trim() === '' ? 0 : parseNum(inp.value);
  }
  return list;
}

Actions['channel-add'] = () => {
  readChannelInputs().push({ id: `c${Date.now().toString(36)}`, name: '', pct: 0, fixed: 0 });
  App.render();
};
Actions['channel-remove'] = (el) => {
  const list = readChannelInputs();
  if (list.length <= 1) return toast('Garde au moins un canal de vente.', { tone: 'warn' });
  list.splice(+el.dataset.ch, 1);
  App.render();
};
Actions['save-channels'] = async () => {
  const list = readChannelInputs();
  for (const c of list) {
    if (!c.name) return toast('Chaque canal doit avoir un nom.', { tone: 'bad' });
    if (!Number.isFinite(c.pct) || c.pct < 0 || c.pct >= 100 || !Number.isFinite(c.fixed) || c.fixed < 0) return toast(`Frais invalides pour « ${c.name} ».`, { tone: 'bad' });
  }
  const res = await runOp('settings.save', { sales_channels: list.map((c) => ({ id: c.id, name: c.name.slice(0, 40), pct: roundDb(c.pct, 2), fixed: roundDb(c.fixed, 2) })) }, { success: 'Canaux de vente enregistrés' });
  if (opAccepted(res)) {
    delete App.ui.channelsDraft;
    App.render();
  }
};

Actions['machine-new'] = () => openMachineModal(null);
Actions['machine-edit'] = (el) => openMachineModal(Store.V.machines.get(el.dataset.id));

function openMachineModal(machine) {
  const st = settingsOf(Store.V);
  const d = machine ? { ...pick(machine, MACHINE_FIELDS) } : { id: uuid(), name: '', model: '', hourly_rate: st.machine_rate, is_default: !activeMachines(Store.V).length, archived: false };
  Modal.open({
    title: machine ? 'Modifier la machine' : 'Nouvelle machine',
    size: 'sm',
    render: () => ({
      body: html`<div class="space-y-4">
        ${field('Nom', inputText('name', d.name, { placeholder: 'P1S atelier', maxlength: 80, attrs: { autofocus: true } }))}
        ${field('Modèle', inputText('model', d.model, { placeholder: 'Bambu Lab P1S + AMS', maxlength: 80 }))}
        ${field('Coût horaire', inputNum('hourly_rate', d.hourly_rate, { suffix: '€/h' }), { hint: 'Électricité + usure. Ex. : 0,15 kW × 0,25 €/kWh + usure ≈ 0,30 €/h.' })}
        <label class="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-ink-850 p-3"><span class="text-sm text-slate-200">Machine par défaut</span><input type="checkbox" name="is_default" class="toggle" ${d.is_default ? raw('checked') : ''}/></label>
        ${machine ? html`<label class="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-ink-850 p-3"><span class="text-sm text-slate-200">Archivée (plus utilisée)</span><input type="checkbox" name="archived" class="toggle" ${d.archived ? raw('checked') : ''}/></label>` : ''}
      </div>`,
      footer: html`<div class="flex items-center justify-between gap-2">${machine ? btn('Supprimer', { variant: 'danger', size: 'sm', icon: 'Trash2', action: 'delete' }) : html`<span></span>`}<div class="flex gap-2">${btn('Annuler', { variant: 'ghost', action: 'cancel' })}${btn('Enregistrer', { variant: 'primary', icon: 'Check', action: 'submit' })}</div></div>`,
    }),
    actions: {
      cancel: (el, e, m) => m.close(),
      delete: async (el, e, m) => {
        const ok = await confirmBox({ title: 'Supprimer cette machine ?', message: 'Les templates qui l’utilisaient passeront sur le taux par défaut. L’historique garde les coûts déjà calculés.', confirm: 'Supprimer' });
        if (!ok) return;
        const res = await runOp('machine.delete', { id: machine.id }, { success: 'Machine supprimée' });
        if (opAccepted(res)) m.close();
      },
      submit: async (el, e, m) => {
        const f = readForm(m.el);
        if (!String(f.name || '').trim()) return setFieldError(m.el, 'name', 'Nom obligatoire.');
        if (!Number.isFinite(f.hourly_rate) || f.hourly_rate < 0) return setFieldError(m.el, 'hourly_rate', 'Coût invalide.');
        const payload = { id: d.id, name: f.name.trim(), model: String(f.model || '').trim() || null, hourly_rate: roundDb(f.hourly_rate, 4), is_default: !!f.is_default, archived: !!f.archived };
        const res = await runOp('machine.save', payload, { success: 'Machine enregistrée' });
        if (opAccepted(res)) m.close();
      },
    },
  });
}

Actions['install-app'] = async () => {
  const p = App.installPrompt;
  if (!p) return;
  p.prompt();
  try {
    await p.userChoice;
  } catch { /* fermé */ }
  App.installPrompt = null;
  App.render();
};

Actions['change-password'] = () => openNewPasswordModal({ title: 'Changer le mot de passe' });

Actions.logout = async () => {
  const pending = Store.Q.length;
  const ok = await confirmBox({
    title: 'Se déconnecter ?',
    message: pending
      ? (pending >= 2
        ? `${pending} actions ne sont pas encore enregistrées dans la base. Elles restent gardées sur cet appareil et partiront quand tu te reconnecteras avec ce compte.`
        : "1 action n'est pas encore enregistrée dans la base. Elle reste gardée sur cet appareil et partira quand tu te reconnecteras avec ce compte.")
      : 'Les données restent dans la base. Tu pourras te reconnecter à tout moment.',
    confirm: 'Se déconnecter',
    tone: pending ? 'danger' : 'warn',
  });
  if (ok) Boot.logout();
};

Actions['clear-local'] = async () => {
  const pending = Store.Q.length;
  const ok = await confirmBox({
    title: 'Vider les données de cet appareil ?',
    message: pending
      ? (pending >= 2
        ? `Attention : ${pending} actions n'ont PAS été enregistrées dans la base et seront perdues définitivement. Les données déjà dans Supabase ne sont pas touchées.`
        : "Attention : 1 action n'a PAS été enregistrée dans la base et sera perdue définitivement. Les données déjà dans Supabase ne sont pas touchées.")
      : "La copie locale est effacée puis rechargée depuis la base. Rien n'est supprimé dans Supabase.",
    confirm: pending ? 'Vider quand même' : 'Vider et recharger',
  });
  if (!ok) return;
  await Boot.clearLocal();
};

Actions['connect-supabase'] = () => Screens.setup({ fromSettings: true });

Actions['demo-seed'] = async () => {
  const ok = await confirmBox({ title: 'Remplir avec des exemples ?', message: 'Des bobines, templates, productions et ventes fictives sont ajoutés à la démo (sur cet appareil uniquement).', confirm: 'Ajouter les exemples', tone: 'warn', icon: 'Sparkles' });
  if (ok) await Demo.seed();
};

Actions['demo-reset'] = async () => {
  const ok = await confirmBox({ title: 'Vider la démo ?', message: 'Toutes les données de démo de cet appareil sont effacées.', confirm: 'Vider la démo' });
  if (ok) await Demo.reset();
};

function b64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(s + '='.repeat((4 - (s.length % 4)) % 4))));
}

Actions['pair-device'] = async () => {
  const cfg = lsGet(LS.supa, null);
  if (!cfg) return;
  const link = `${location.origin}${location.pathname}#setup=${b64urlEncode(JSON.stringify({ u: cfg.url, k: cfg.key }))}`;
  let svg = '';
  try {
    if (!globalThis.qrcode) await loadScript(QR_URL, QR_SRI);
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    svg = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  } catch {
    svg = '';
  }
  Modal.open({
    title: 'Configurer un autre appareil',
    subtitle: 'Scanne avec l’appareil photo du téléphone',
    size: 'sm',
    render: () => html`<div class="space-y-4">
      ${svg ? html`<div class="mx-auto w-56 rounded-2xl bg-white p-3 [&_svg]:h-auto [&_svg]:w-full">${raw(svg)}</div>` : html`<p class="text-[13px] text-amber-300">QR code indisponible hors-ligne : utilise le lien ci-dessous.</p>`}
      <p class="text-[13px] text-slate-400">Le lien contient l'adresse du projet et la clé publique (pas de mot de passe). Il faudra ensuite se connecter avec ton email.</p>
      <div class="flex gap-2"><input class="input font-mono text-[12px]" readonly value="${link}"/>${btn('', { size: 'icon', icon: 'Copy', action: 'copy', title: 'Copier le lien' })}</div>
    </div>`,
    actions: {
      copy: async () => {
        try {
          await navigator.clipboard.writeText(link);
          toast('Lien copié', { tone: 'ok' });
        } catch {
          toast('Copie impossible : sélectionne le lien à la main.', { tone: 'warn' });
        }
      },
    },
  });
};
