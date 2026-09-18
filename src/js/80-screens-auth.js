/* =============================================================================
   Écrans d'accueil : configuration Supabase, connexion, compte
   ============================================================================= */

function decodeJwtPayload(token) {
  try {
    const part = String(token).split('.')[1];
    return JSON.parse(b64urlDecode(part));
  } catch {
    return null;
  }
}

// Refuse les clés secrètes : elles donnent tous les droits et ne doivent jamais aller dans une page web
function keyProblem(key) {
  const k = String(key || '').trim();
  if (!k) return 'Colle la clé publique du projet.';
  if (/^sb_secret_/i.test(k)) return 'Ceci est la clé SECRÈTE : ne la mets jamais dans une page web. Utilise la clé « publishable » (ou « anon »).';
  if (/^eyJ/.test(k)) {
    const p = decodeJwtPayload(k);
    if (p && p.role === 'service_role') return 'Ceci est la clé « service_role » (secrète) : ne la mets jamais dans une page web. Utilise la clé « anon ».';
    return null;
  }
  if (/^sb_publishable_/i.test(k)) return null;
  return "Cette clé n'a pas le format attendu (elle commence par « sb_publishable_ » ou « eyJ »).";
}

async function testSupabase(url, key) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const headers = { apikey: key };
    if (/^eyJ/.test(key)) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(`${url}/auth/v1/settings`, { headers, signal: ctrl.signal });
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Clé refusée par Supabase : vérifie que tu as copié la clé publique de CE projet.' };
    if (!res.ok) return { ok: false, message: `Supabase répond mais avec une erreur (HTTP ${res.status}). Le projet est peut-être en pause : ouvre-le dans le tableau de bord Supabase.` };
    const body = await res.json().catch(() => ({}));
    return { ok: true, signupDisabled: body.disable_signup === true };
  } catch (e) {
    return { ok: false, network: true, message: e && e.name === 'AbortError' ? 'Supabase ne répond pas (délai dépassé).' : "Adresse injoignable : vérifie l'URL du projet et ta connexion internet." };
  } finally {
    clearTimeout(timer);
  }
}

// Même règle que le projet Supabase (Authentication → Sign In / Providers → Email) :
// 12 caractères minimum avec minuscule, majuscule, chiffre et symbole (liste de symboles de Supabase)
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 72; // limite de Supabase (bcrypt)
const PASSWORD_RULE = `au moins ${PASSWORD_MIN} caractères avec une minuscule, une majuscule, un chiffre et un symbole (! ? @ # $ % & * …)`;
function passwordProblem(pw) {
  const p = String(pw || '');
  if (p.length < PASSWORD_MIN) return `Trop court : ${PASSWORD_RULE}.`;
  // Supabase compte en octets : une lettre accentuée en vaut deux
  if (new TextEncoder().encode(p).length > PASSWORD_MAX) return `Trop long : ${PASSWORD_MAX} caractères maximum (une lettre accentuée compte double).`;
  const missing = [];
  if (!/[a-z]/.test(p)) missing.push('une minuscule');
  if (!/[A-Z]/.test(p)) missing.push('une majuscule');
  if (!/[0-9]/.test(p)) missing.push('un chiffre');
  if (!/[!@#$%^&*()_+\-=[\]{};'\\:"|<>?,./`~]/.test(p)) missing.push('un symbole (! ? @ # $ % & * …)');
  return missing.length ? `Il manque ${missing.join(', ')}.` : null;
}

function authErrorMessage(error) {
  const msg = String((error && error.message) || '');
  const code = String((error && (error.code || error.error_code)) || '');
  if (/invalid login credentials/i.test(msg) || code === 'invalid_credentials') return 'Email ou mot de passe incorrect.';
  if (/email not confirmed/i.test(msg) || code === 'email_not_confirmed') return 'Adresse pas encore confirmée : clique sur le lien reçu par email, puis reconnecte-toi.';
  if (/banned/i.test(msg) || code === 'user_banned') return 'Ce compte est bloqué.';
  if (/invalid totp|mfa_verification_failed/i.test(`${msg} ${code}`)) return 'Code incorrect : tape le code affiché EN CE MOMENT dans ton appli (il change toutes les 30 secondes).';
  if (code === 'mfa_challenge_expired' || /challenge.*expired/i.test(msg)) return 'Le code a expiré : réessaie avec le nouveau code.';
  if (code === 'insufficient_aal' || /aal2 (is )?required|insufficient.*aal/i.test(msg)) return 'Par sécurité, reconnecte-toi avec ton code avant de faire ça.';
  if (/mfa.*(not enabled|disabled)|enroll.*not enabled/i.test(`${msg} ${code}`)) return "La double authentification n'est pas activée sur le projet Supabase (Authentication → Multi-Factor → TOTP).";
  if (code === 'too_many_enrolled_mfa_factors' || /too many enrolled/i.test(msg)) return 'Trop de codes en attente sur ce compte : retire-les dans Supabase (Authentication → Users), puis réessaie.';
  if (/friendly name/i.test(msg) || code === 'mfa_factor_name_conflict') return 'Une activation est déjà en cours : ferme cette fenêtre et recommence.';
  if (/signups? not allowed|signup(s)? (are )?disabled/i.test(msg) || code === 'signup_disabled') return "Les inscriptions sont fermées sur ce projet (c'est voulu, pour la sécurité). Le compte se crée dans Supabase : Authentication → Users → Add user.";
  if (/email address.*not authorized/i.test(msg) || code === 'email_address_not_authorized') return "Supabase ne peut pas envoyer d'email à cette adresse (l'envoi gratuit de Supabase est réservé aux membres du projet). Le mot de passe peut être changé depuis le tableau de bord Supabase.";
  if (/should be different|same password/i.test(msg) || code === 'same_password') return "Le nouveau mot de passe doit être différent de l'ancien.";
  if (/reauthenticat/i.test(msg) || code === 'reauthentication_needed') return 'Par sécurité, déconnecte-toi puis reconnecte-toi avant de changer le mot de passe.';
  if (/longer than 72/i.test(msg)) return `Mot de passe trop long : ${PASSWORD_MAX} caractères maximum.`;
  if (/password should be|weak password|password.*(contain|characters)/i.test(msg) || code === 'weak_password') return `Mot de passe trop faible : ${PASSWORD_RULE}.`;
  if (/rate limit|too many/i.test(msg) || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') return 'Trop de tentatives : patiente quelques minutes avant de réessayer.';
  if (/abort/i.test(msg)) return 'Supabase ne répond pas (délai dépassé). Vérifie la connexion internet puis réessaie.';
  if (/fetch|network|load failed/i.test(msg)) return 'Pas de connexion avec Supabase. Vérifie internet.';
  return msg || 'Erreur inconnue.';
}

const Screens = {
  el() {
    let el = document.getElementById('screen');
    if (!el) {
      el = document.createElement('div');
      el.id = 'screen';
      el.className = 'fixed inset-0 z-40 overflow-y-auto bg-ink-950';
      document.body.appendChild(el);
    }
    return el;
  },

  hide() {
    const el = document.getElementById('screen');
    if (el) el.remove();
    const splash = document.getElementById('splash');
    if (splash) splash.remove();
    const app = document.getElementById('app');
    if (app) {
      app.inert = false;
      app.removeAttribute('aria-hidden');
    }
  },

  frame(content) {
    const el = this.el();
    el.innerHTML = String(html`<div class="auth-bg"></div>
      <div class="relative mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-5 py-10 pt-[max(2.5rem,env(safe-area-inset-top))]">
        <div class="mb-8 flex justify-center">${logoLockup({ size: 52 })}</div>
        ${content}
        <p class="mt-8 text-center text-[11px] text-slate-500">Paulo3D · v${APP_VERSION}</p>
      </div>`);
    const splash = document.getElementById('splash');
    if (splash) splash.remove();
    // l'application derrière l'écran de connexion n'est ni lisible ni atteignable au clavier
    const app = document.getElementById('app');
    if (app) {
      app.inert = true;
      app.setAttribute('aria-hidden', 'true');
    }
    for (const m of [...Modal.stack]) m.close();
    return el;
  },

  fatal(message) {
    const el = this.frame(html`<div class="card p-5 text-center"><div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-rose-500/10 text-rose-300">${icon('CloudOff', 'w-6 h-6')}</div><p class="text-sm text-slate-300">${message}</p><button class="btn btn-primary mt-4 h-11 rounded-xl px-4" data-reload>Recharger</button></div>`);
    // pas d'attribut onclick : la sécurité de la page (CSP) interdit le code écrit dans le HTML
    el.querySelector('[data-reload]').addEventListener('click', () => location.reload());
  },

  // Page ouverte dans le cadre d'un autre site : rien d'utilisable, seulement un lien vers la vraie adresse
  framed() {
    this.frame(html`<div class="card p-5 text-center"><div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-amber-400/10 text-amber-300">${icon('ShieldAlert', 'w-6 h-6')}</div><p class="text-sm text-slate-300">Par sécurité, Paulo3D ne s'ouvre pas à l'intérieur d'un autre site.</p><a class="btn btn-primary mt-4 h-11 rounded-xl px-4" href="${`${location.origin}${location.pathname}`}" target="_blank" rel="noopener noreferrer">Ouvrir Paulo3D</a></div>`);
  },

  setup({ fromSettings = false } = {}) {
    const cfg = lsGet(LS.supa, null) || {};
    const el = this.frame(html`
      <div class="card p-5 sm:p-6">
        <h1 class="font-display text-2xl font-bold text-slate-50">${fromSettings ? 'Connexion Supabase' : 'Bienvenue'}</h1>
        <p class="mt-1 text-sm text-slate-400">Relie l'application à ta base Supabase : tes données seront enregistrées en ligne et synchronisées entre PC et téléphone.</p>
        <form class="mt-5 space-y-4" id="setup-form" novalidate>
          ${field('URL du projet', inputText('url', cfg.url || '', { placeholder: 'https://xxxxxxxx.supabase.co', type: 'url', maxlength: 300, attrs: { autocapitalize: 'off', spellcheck: 'false', inputmode: 'url' } }))}
          ${field('Clé publique (publishable ou anon)', html`<textarea class="input h-24 py-2 font-mono text-[12px]" name="key" placeholder="sb_publishable_… ou eyJhbGciOi…" autocapitalize="off" spellcheck="false">${cfg.key || ''}</textarea>`)}
          <div id="setup-msg"></div>
          <button type="submit" class="btn btn-primary h-12 w-full rounded-xl text-[15px]">${icon('PlugZap', 'w-5 h-5')}<span>Tester et continuer</span></button>
        </form>
        <details class="mt-5 rounded-2xl border border-white/[0.06] bg-ink-850 p-4 text-[13px] text-slate-300">
          <summary class="cursor-pointer list-none font-semibold text-slate-200">Où trouver ces informations ?</summary>
          <ol class="mt-3 list-decimal space-y-1.5 pl-5">
            <li>Sur <b>supabase.com</b>, ouvre ton projet (ou crée-en un gratuitement).</li>
            <li>Menu <b>SQL Editor</b> : colle le fichier <b>schema.sql</b> fourni et clique <b>Run</b> (une seule fois).</li>
            <li>Bouton <b>Connect</b> en haut (ou <b>Project Settings → API Keys</b>) : copie l'<b>URL du projet</b> et la clé <b>publishable</b> (ou <b>anon</b>).</li>
            <li>Ne copie jamais la clé <b>secret</b> / <b>service_role</b>.</li>
          </ol>
        </details>
      </div>
      <div class="mt-5 text-center">
        ${fromSettings
          ? html`<button class="text-sm font-medium text-slate-400 hover:text-slate-200" id="setup-back">Retour</button>`
          : html`<div class="mb-3 flex items-center gap-3 text-[12px] text-slate-500"><span class="h-px flex-1 bg-white/10"></span>ou<span class="h-px flex-1 bg-white/10"></span></div>
             <button class="btn btn-secondary h-11 w-full rounded-xl" id="setup-demo">${icon('FlaskConical', 'w-[18px] h-[18px]')}<span>Essayer en mode démo</span></button>
             <p class="mt-2 text-[12px] text-slate-500">Données d'exemple, stockées uniquement sur cet appareil.</p>`}
      </div>`);

    const form = el.querySelector('#setup-form');
    const msg = el.querySelector('#setup-msg');
    const show = (text, tone = 'bad') => {
      const t = TONES[tone];
      msg.innerHTML = text ? String(html`<div class="rounded-xl border ${t.border} ${t.bg} p-3 text-[13px] ${t.text}">${text}</div>`) : '';
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = normalizeSupaUrl(form.url.value);
      const key = form.key.value.trim().replace(/\s+/g, '');
      if (!url) return show("URL invalide : elle ressemble à https://xxxxxxxx.supabase.co (https obligatoire).");
      // la sécurité de la page (CSP) n'autorise que les adresses Supabase standard
      if (!/\.supabase\.(co|in)$/i.test(new URL(url).hostname) && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(url).hostname)) {
        return show("Seules les adresses Supabase standard sont acceptées (https://xxxxxxxx.supabase.co). Un domaine personnalisé n'est pas pris en charge.");
      }
      const problem = keyProblem(key);
      if (problem) return show(problem);
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      show('Test de la connexion…', 'info');
      const r = await testSupabase(url, key);
      button.disabled = false;
      if (!r.ok) return show(r.message);
      const prev = lsGet(LS.supa, null);
      lsSet(LS.supa, { url, key });
      lsSet(LS.mode, 'supabase');
      if (fromSettings && prev && prev.url === url && prev.key === key) {
        Screens.hide();
        return;
      }
      show('Connexion réussie.', 'ok');
      await Boot.restart();
    });
    const demo = el.querySelector('#setup-demo');
    if (demo) {
      demo.addEventListener('click', async () => {
        lsSet(LS.mode, 'demo');
        await Boot.restart();
      });
    }
    const back = el.querySelector('#setup-back');
    if (back) back.addEventListener('click', () => Screens.hide());
  },

  // Connexion seulement : aucune inscription depuis l'appli (accès privé, les inscriptions sont
  // aussi fermées côté Supabase). Le compte se crée dans le tableau de bord Supabase.
  login({ relogin = false, notice = '' } = {}) {
    const backend = Boot.backend;
    if (!backend || backend.kind !== 'supabase') return this.setup();
    const cfg = lsGet(LS.supa, {});
    const lastEmail = lsGet('p3d_last_email', '');
    const el = this.frame(html`
      <div class="card p-5 sm:p-6">
        <h1 class="font-display text-2xl font-bold text-slate-50">${relogin ? 'Reconnexion' : 'Connexion'}</h1>
        <p class="mt-1 text-sm text-slate-400">${relogin ? 'Ta session a expiré. Les actions en attente sont gardées et partiront après la connexion.' : 'Connecte-toi pour accéder aux données de l’atelier.'}</p>
        <form class="mt-5 space-y-4" id="login-form" novalidate>
          ${field('Email', inputText('email', lastEmail, { type: 'email', placeholder: 'atelier@exemple.fr', maxlength: 200, attrs: { autocomplete: 'username', autocapitalize: 'off', inputmode: 'email' } }))}
          ${field('Mot de passe', html`<div class="relative"><input class="input pr-12" type="password" name="password" placeholder="••••••••" autocomplete="current-password" maxlength="200"/>
            <button type="button" class="absolute inset-y-0 right-2 my-auto grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:text-slate-200" id="pw-toggle" aria-label="Afficher le mot de passe" aria-pressed="false">${icon('Eye', 'w-4 h-4')}</button></div>`)}
          <div id="login-msg">${notice ? raw(String(html`<div class="rounded-xl border border-cyan-400/30 bg-cyan-400/10 p-3 text-[13px] text-cyan-200">${notice}</div>`)) : ''}</div>
          <button type="submit" class="btn btn-primary h-12 w-full rounded-xl text-[15px]">${icon('LogIn', 'w-5 h-5')}<span>Se connecter</span></button>
        </form>
        <div class="mt-4 flex flex-wrap items-center justify-between gap-2 text-[13px]">
          <span class="inline-flex items-center gap-1.5 text-slate-500">${icon('ShieldCheck', 'w-4 h-4 shrink-0')}Accès privé</span>
          <button class="text-slate-400 hover:text-slate-200" id="forgot">Mot de passe oublié ?</button>
        </div>
      </div>
      <div class="mt-5 flex flex-col items-center gap-2 text-[12px] text-slate-500">
        <span class="truncate">Base : ${cfg.url || '—'}</span>
        <button class="font-medium text-slate-400 hover:text-slate-200" id="change-base">Changer de base Supabase</button>
      </div>`);

    const form = el.querySelector('#login-form');
    const msg = el.querySelector('#login-msg');
    const show = (text, tone = 'bad') => {
      const t = TONES[tone];
      msg.innerHTML = text ? String(html`<div class="rounded-xl border ${t.border} ${t.bg} p-3 text-[13px] ${t.text}">${text}</div>`) : '';
    };
    el.querySelector('#pw-toggle').addEventListener('click', (e) => {
      const i = form.password;
      i.type = i.type === 'password' ? 'text' : 'password';
      e.currentTarget.setAttribute('aria-pressed', String(i.type === 'text'));
    });
    el.querySelector('#change-base').addEventListener('click', () => this.setup({ fromSettings: false }));
    const forgot = el.querySelector('#forgot');
    if (forgot) {
      forgot.addEventListener('click', async () => {
        const email = form.email.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return show("Indique d'abord ton email ci-dessus.");
        forgot.disabled = true;
        const { error } = await backend.sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}` });
        forgot.disabled = false;
        if (error) return show(authErrorMessage(error));
        show('Si ce compte existe, un email avec un lien de réinitialisation vient de partir. Ouvre-le sur cet appareil.', 'info');
      });
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = form.email.value.trim().toLowerCase();
      const password = form.password.value;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return show('Email invalide.');
      if (!password) return show('Indique le mot de passe.');
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      show('Connexion…', 'info');
      try {
        const { data, error } = await backend.sb.auth.signInWithPassword({ email, password });
        if (error) return show(authErrorMessage(error));
        lsSet('p3d_last_email', email);
        if (relogin && Store.userId && data.user.id !== Store.userId) {
          toast('Connecté avec un autre compte : les actions en attente de l’ancien compte restent gardées pour lui.', { tone: 'warn' });
        }
        const factorId = await Mfa.factorToVerify(backend);
        if (factorId) return Screens.mfa({ backend, user: data.user, factorId });
        await Boot.enter(backend, data.user);
      } catch (err) {
        show(authErrorMessage(err));
      } finally {
        button.disabled = false;
      }
    });
    if (window.matchMedia('(pointer: fine)').matches) (lastEmail ? form.password : form.email).focus();
  },
};

function openNewPasswordModal({ title = 'Nouveau mot de passe' } = {}) {
  const backend = Boot.backend;
  if (!backend || backend.kind !== 'supabase') return;
  Modal.open({
    title,
    size: 'sm',
    render: () => ({
      body: html`<div class="space-y-4">
        ${field('Nouveau mot de passe', html`<input class="input" type="password" name="p1" autocomplete="new-password" maxlength="${PASSWORD_MAX}" placeholder="${PASSWORD_MIN} caractères minimum" autofocus/>`, { hint: `Au moins ${PASSWORD_MIN} caractères, avec minuscule, majuscule, chiffre et symbole.` })}
        ${field('Confirmer', html`<input class="input" type="password" name="p2" autocomplete="new-password" maxlength="${PASSWORD_MAX}"/>`)}
      </div>`,
      footer: html`<div class="flex justify-end gap-2">${btn('Annuler', { variant: 'ghost', action: 'cancel' })}${btn('Enregistrer', { variant: 'primary', icon: 'Check', action: 'submit' })}</div>`,
    }),
    actions: {
      cancel: (el, e, m) => m.close(),
      submit: async (el, e, m) => {
        const f = readForm(m.el);
        const problem = passwordProblem(f.p1);
        if (problem) return setFieldError(m.el, 'p1', problem);
        if (f.p1 !== f.p2) return setFieldError(m.el, 'p2', 'Les mots de passe ne correspondent pas.');
        el.disabled = true;
        const { error } = await backend.sb.auth.updateUser({ password: f.p1 });
        el.disabled = false;
        if (error) return toast(authErrorMessage(error), { tone: 'bad', title: 'Mot de passe non modifié' });
        toast('Mot de passe modifié', { tone: 'ok' });
        m.close();
      },
    },
  });
}
