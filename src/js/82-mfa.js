/* =============================================================================
   Double authentification : un code à 6 chiffres, affiché par une appli gratuite
   (Google Authenticator, Microsoft Authenticator, 2FAS…), en plus du mot de passe.
   La base refuse toute donnée à une session « mot de passe seul » d'un compte qui l'a
   activée (p3d_private.mfa_ok) : l'appli demande le code à la connexion, et si besoin
   pendant la synchronisation (code activé sur un autre appareil).
   ============================================================================= */

const Mfa = {
  // état affiché dans Paramètres (rechargé après connexion, activation ou désactivation)
  info: { loaded: false, loading: false, factor: null, error: '' },

  reset() {
    this.info = { loaded: false, loading: false, factor: null, error: '' };
  },

  async load(backend) {
    if (!backend || backend.kind !== 'supabase' || this.info.loading) return;
    this.info.loading = true;
    try {
      const { data, error } = await backend.sb.auth.mfa.listFactors();
      if (error) throw error;
      this.info = { loaded: true, loading: false, factor: (data && data.totp && data.totp[0]) || null, error: '' };
    } catch (e) {
      const offline = classifyError(wrapError(e, e && e.status)) === 'network';
      this.info = { loaded: true, loading: false, factor: null, error: offline ? "Pas de connexion : l'état de la double authentification n'a pas pu être vérifié." : authErrorMessage(e) };
    }
    if (App.mounted && App.route.name === 'parametres') App.render();
  },

  // Code exigé pour cette session ? Renvoie l'identifiant du facteur à vérifier, sinon null.
  // Lecture locale (la session garde la liste des facteurs) : marche aussi hors-ligne.
  async factorToVerify(backend) {
    try {
      const { data, error } = await backend.sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error || !data || data.currentLevel === 'aal2' || data.nextLevel !== 'aal2') return null;
      const { data: s } = await backend.sb.auth.getSession();
      const f = ((s && s.session && s.session.user && s.session.user.factors) || []).find((x) => x.status === 'verified' && x.factor_type === 'totp');
      return f ? f.id : null;
    } catch {
      return null;
    }
  },

  // Facteur à vérifier quand la BASE a réclamé le code (activé ailleurs : la session l'ignore encore)
  async factorFromServer(backend) {
    const { data, error } = await backend.sb.auth.mfa.listFactors();
    if (error) throw error;
    const f = data && data.totp && data.totp[0];
    return f ? f.id : null;
  },

  // Obligatoire et pas encore activée ? (liste lue sur le serveur ; hors-ligne : non, la base protège)
  async needsEnroll(backend) {
    if (!SITE.mfaRequired) return false;
    try {
      const { data, error } = await backend.sb.auth.mfa.listFactors();
      if (error) return false;
      return !((data && data.totp) || []).some((f) => f.status === 'verified');
    } catch {
      return false;
    }
  },

  async verify(backend, factorId, code) {
    const { error } = await backend.sb.auth.mfa.challengeAndVerify({ factorId, code });
    return error || null;
  },
};

const codeInput = (name = 'code') => html`<input class="input text-center font-mono text-2xl tracking-[0.4em]" name="${name}" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000"/>`;
const readCode = (root, name = 'code') => String((root.querySelector(`[name="${name}"]`) || {}).value || '').replace(/\D/g, '');

// Étape de connexion : après le mot de passe, le code
Screens.mfa = function mfaScreen({ backend, user, factorId }) {
  const el = this.frame(html`
    <div class="card p-5 sm:p-6">
      <div class="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-neon/10 text-neon">${icon('ShieldCheck', 'w-6 h-6')}</div>
      <h1 class="font-display text-2xl font-bold text-slate-50">Code de sécurité</h1>
      <p class="mt-1 text-sm text-slate-400">Ouvre ton appli d'authentification et tape le code à 6 chiffres affiché pour « ${SITE.name} ».</p>
      <form class="mt-5 space-y-4" id="mfa-form" novalidate>
        ${field('Code à 6 chiffres', codeInput())}
        <div id="mfa-msg"></div>
        <button type="submit" class="btn btn-primary h-12 w-full rounded-xl text-[15px]">${icon('ShieldCheck', 'w-5 h-5')}<span>Valider</span></button>
      </form>
      <div class="mt-4 flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <button class="text-slate-400 hover:text-slate-200" id="mfa-logout">Se déconnecter</button>
        ${navigator.onLine === false ? html`<button class="font-medium text-neon" id="mfa-offline">Continuer hors-ligne</button>` : ''}
      </div>
    </div>`);
  const form = el.querySelector('#mfa-form');
  const msg = el.querySelector('#mfa-msg');
  const show = (text, tone = 'bad') => {
    const t = TONES[tone];
    msg.innerHTML = text ? String(html`<div class="rounded-xl border ${t.border} ${t.bg} p-3 text-[13px] ${t.text}">${text}</div>`) : '';
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = readCode(form);
    if (!/^\d{6}$/.test(code)) return show('Le code fait 6 chiffres.');
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    show('Vérification…', 'info');
    try {
      const err = await Mfa.verify(backend, factorId, code);
      if (err) return show(authErrorMessage(err));
      await Boot.enter(backend, user);
    } catch (err) {
      show(authErrorMessage(err));
    } finally {
      button.disabled = false;
    }
  });
  el.querySelector('#mfa-logout').addEventListener('click', () => Boot.logout());
  const off = el.querySelector('#mfa-offline');
  // hors-ligne : la copie de l'appareil reste consultable ; le code sera demandé au retour du réseau
  if (off) off.addEventListener('click', () => Boot.enter(backend, user));
  if (window.matchMedia('(pointer: fine)').matches) form.code.focus();
};

// Double authentification obligatoire, pas encore activée : on ne rentre pas sans l'activer
Screens.mfaEnroll = function mfaEnrollScreen({ backend, user }) {
  const el = this.frame(html`
    <div class="card p-5 sm:p-6">
      <div class="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-neon/10 text-neon">${icon('ShieldCheck', 'w-6 h-6')}</div>
      <h1 class="font-display text-2xl font-bold text-slate-50">Protège ton compte</h1>
      <p class="mt-1 text-sm text-slate-400">Pour entrer dans ${SITE.name}, active la double authentification : en plus du mot de passe, un code à 6 chiffres affiché par une appli gratuite sur ton téléphone. 2 minutes, une seule fois.</p>
      <button class="btn btn-primary mt-5 h-12 w-full rounded-xl text-[15px]" id="mfa-go">${icon('ShieldCheck', 'w-5 h-5')}<span>Activer maintenant</span></button>
      <div class="mt-4 text-[13px]"><button class="text-slate-400 hover:text-slate-200" id="mfa-logout">Se déconnecter</button></div>
    </div>`);
  el.querySelector('#mfa-go').addEventListener('click', () => openMfaEnroll({ onDone: () => Boot.enter(backend, user), backend }));
  el.querySelector('#mfa-logout').addEventListener('click', () => Boot.logout());
};

// Pendant l'utilisation : la base réclame le code (synchronisation en pause, actions gardées)
async function openMfaCodeModal() {
  const backend = Boot.backend;
  if (!backend || backend.kind !== 'supabase') return;
  let factorId = null;
  try {
    factorId = await Mfa.factorFromServer(backend);
  } catch (e) {
    return toast(authErrorMessage(e), { tone: 'bad', title: 'Double authentification' });
  }
  if (!factorId && SITE.mfaRequired) {
    // obligatoire mais plus aucun code sur le compte (retiré après un téléphone perdu) : on le réactive
    return openMfaEnroll({ onDone: () => { Sync.state.needsMfa = false; Sync.emit(); Sync.kick(); } });
  }
  if (!factorId) {
    // plus de code sur le compte (désactivé ailleurs) : la synchro peut reprendre
    Sync.state.needsMfa = false;
    Sync.kick();
    return;
  }
  Modal.open({
    title: 'Code de sécurité',
    subtitle: 'Double authentification',
    size: 'sm',
    render: () => ({
      body: html`<div class="space-y-4">
        <p class="text-sm text-slate-300">La double authentification est activée sur ce compte : tape le code à 6 chiffres de ton appli d'authentification pour reprendre la synchronisation. Tes actions en attente sont gardées.</p>
        ${field('Code à 6 chiffres', codeInput())}
      </div>`,
      footer: html`<div class="flex justify-end gap-2">${btn('Plus tard', { variant: 'ghost', action: 'cancel' })}${btn('Valider', { variant: 'primary', icon: 'ShieldCheck', action: 'submit' })}</div>`,
    }),
    actions: {
      cancel: (el, e, m) => m.close(),
      submit: async (el, e, m) => {
        const code = readCode(m.el);
        if (!/^\d{6}$/.test(code)) return setFieldError(m.el, 'code', 'Le code fait 6 chiffres.');
        const err = await Mfa.verify(backend, factorId, code);
        if (err) return setFieldError(m.el, 'code', authErrorMessage(err));
        m.close();
        Sync.state.needsMfa = false;
        Sync.emit();
        toast('Code accepté : la synchronisation reprend.', { tone: 'ok' });
        Sync.kick();
      },
    },
  });
}
Actions['mfa-code'] = () => openMfaCodeModal();

/* ---------- Paramètres : activer / désactiver ---------- */
function mfaSection() {
  const i = Mfa.info;
  const on = !!i.factor;
  const subtitle = on ? 'Activée : code demandé à chaque nouvelle connexion' : 'Recommandée : sans ton téléphone, personne ne peut entrer, même avec le mot de passe';
  const body = !i.loaded
    ? html`<p class="text-[13px] text-slate-400">Vérification…</p>`
    : i.error
      ? html`<p class="text-[13px] text-amber-200">${i.error}</p>`
      : on
        ? html`<p class="flex items-center gap-2 text-sm text-neon">${icon('CircleCheck', 'w-4 h-4 shrink-0')}Activée depuis le ${fmtDate(i.factor.created_at, 'long')}.</p>
           <p class="text-[12px] text-slate-500">Téléphone perdu ou changé : le code peut être retiré depuis le tableau de bord Supabase (Authentication → Users → ton compte), puis réactivé ici.</p>`
        : html`<p class="text-[13px] text-slate-300">À chaque nouvelle connexion, en plus du mot de passe, l'appli demandera un code à 6 chiffres affiché par une appli gratuite sur ton téléphone (Google Authenticator, Microsoft Authenticator, 2FAS…).</p>`;
  const footer = !i.loaded || i.error
    ? (i.error ? btn('Réessayer', { size: 'sm', variant: 'ghost', icon: 'RefreshCw', action: 'mfa-reload' }) : '')
    : on
      ? (SITE.mfaRequired ? '' : btn('Désactiver', { size: 'sm', variant: 'ghost', icon: 'ShieldOff', action: 'mfa-disable' }))
      : btn('Activer', { size: 'sm', variant: 'primary', icon: 'ShieldCheck', action: 'mfa-enable' });
  return settingsSection('s-mfa', 'ShieldCheck', 'Double authentification', subtitle, body, footer);
}

Actions['mfa-reload'] = () => {
  Mfa.reset();
  Mfa.load(Boot.backend);
  App.render();
};

// Le QR code de Supabase est un SVG brut placé derrière « data:… ,» : on l'encode pour qu'aucun
// caractère (#, %, guillemets) ne coupe l'image
function qrDataUrl(qr) {
  const s = String(qr || '');
  const i = s.indexOf(',');
  if (!s.startsWith('data:') || i < 0) return '';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(decodeURIComponentSafe(s.slice(i + 1)))}`;
}
function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

async function openMfaEnroll({ onDone = null, backend = Boot.backend } = {}) {
  if (!backend || backend.kind !== 'supabase') return;
  const auth = backend.sb.auth.mfa;
  // une activation abandonnée laisse un facteur « non vérifié » : on repart de zéro
  try {
    const { data } = await auth.listFactors();
    for (const f of (data && data.all) || []) {
      if (f.status !== 'verified') await auth.unenroll({ factorId: f.id });
    }
  } catch { /* hors-ligne : l'activation échouera ci-dessous avec un message clair */ }
  const { data, error } = await auth.enroll({ factorType: 'totp', friendlyName: SITE.name });
  if (error) return toast(authErrorMessage(error), { tone: 'bad', title: 'Double authentification' });
  const factorId = data.id;
  const qr = qrDataUrl(data.totp && data.totp.qr_code);
  const secret = String((data.totp && data.totp.secret) || '');
  let done = false;
  Modal.open({
    title: 'Activer la double authentification',
    subtitle: '3 étapes, 2 minutes',
    size: 'sm',
    onClose: () => {
      if (!done) auth.unenroll({ factorId }).catch(() => {});
    },
    render: () => ({
      body: html`<div class="space-y-4 text-[13px] text-slate-300">
        <p><b class="text-slate-100">1.</b> Installe une appli d'authentification gratuite sur ton téléphone : Google Authenticator, Microsoft Authenticator ou 2FAS.</p>
        <p><b class="text-slate-100">2.</b> Dans cette appli, ajoute un compte en scannant ce QR code :</p>
        ${qr ? html`<img src="${qr}" alt="QR code à scanner avec l'appli d'authentification" class="mx-auto h-48 w-48 rounded-xl bg-white p-2"/>` : ''}
        <details class="rounded-xl bg-white/[0.03] p-3"><summary class="cursor-pointer text-slate-400">Impossible de scanner (appli sur le même téléphone) ?</summary>
          <p class="mt-2">Choisis « Saisir une clé » dans l'appli et recopie :</p>
          <p class="mt-1 select-all break-all font-mono text-[14px] text-slate-100">${secret.replace(/(.{4})/g, '$1 ').trim()}</p></details>
        <p><b class="text-slate-100">3.</b> Tape le code à 6 chiffres qu'elle affiche :</p>
        ${field('Code à 6 chiffres', codeInput())}
      </div>`,
      footer: html`<div class="flex justify-end gap-2">${btn('Annuler', { variant: 'ghost', action: 'cancel' })}${btn('Activer', { variant: 'primary', icon: 'ShieldCheck', action: 'submit' })}</div>`,
    }),
    actions: {
      cancel: (el, e, m) => m.close(),
      submit: async (el, e, m) => {
        const code = readCode(m.el);
        if (!/^\d{6}$/.test(code)) return setFieldError(m.el, 'code', 'Le code fait 6 chiffres.');
        const err = await Mfa.verify(backend, factorId, code);
        if (err) return setFieldError(m.el, 'code', authErrorMessage(err));
        done = true;
        m.close();
        if (onDone) {
          toast('Double authentification activée : le code sera demandé à chaque nouvelle connexion.', { tone: 'ok', title: 'Compte protégé' });
          return onDone();
        }
        toast('Double authentification activée : le code sera demandé à chaque nouvelle connexion.', { tone: 'ok', title: 'Compte protégé' });
        Mfa.reset();
        Mfa.load(backend);
        App.render();
      },
    },
  });
}
Actions['mfa-enable'] = () => openMfaEnroll();

Actions['mfa-disable'] = async () => {
  const backend = Boot.backend;
  const f = Mfa.info.factor;
  if (!backend || !f || SITE.mfaRequired) return;
  const ok = await confirmBox({
    title: 'Désactiver la double authentification ?',
    message: 'Le mot de passe seul suffira de nouveau pour entrer dans l’appli.',
    confirm: 'Désactiver',
    tone: 'danger',
    icon: 'ShieldOff',
  });
  if (!ok) return;
  const { error } = await backend.sb.auth.mfa.unenroll({ factorId: f.id });
  if (error) return toast(authErrorMessage(error), { tone: 'bad', title: 'Non désactivée' });
  toast('Double authentification désactivée.', { tone: 'warn' });
  Mfa.reset();
  Mfa.load(backend);
  App.render();
};

// Paramètres : état de la double authentification lu à l'ouverture de la page (une fois par connexion)
VIEWS.parametres.mount = function mountParametres() {
  const backend = Sync.backend || Boot.backend;
  if (backend && backend.kind === 'supabase' && !Mfa.info.loaded && !Mfa.info.loading) Mfa.load(backend);
};
