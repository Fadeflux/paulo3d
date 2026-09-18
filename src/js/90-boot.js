/* =============================================================================
   Démarrage
   ============================================================================= */

const Boot = {
  backend: null,
  authSub: null,
  loggingOut: false,
  updateRequested: false,
  updateOffered: false,
  notifierBound: false,

  async start() {
    // Jamais utilisable à l'intérieur d'un autre site (piège à clics) : GitHub Pages ne permet pas
    // d'interdire les cadres par en-tête, l'appli refuse donc elle-même de démarrer dans un cadre.
    if (this.framed()) return Screens.framed();
    // Lien de configuration collé dans un onglet où l'appli est déjà ouverte : un simple changement après
    // « # » ne recharge pas la page, on recharge donc pour le traiter comme à l'ouverture (confirmation).
    window.addEventListener('hashchange', () => {
      if (/[#&/]setup=/.test(location.hash)) location.reload();
    });
    this.captureInstallPrompt();
    this.registerServiceWorker();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    const link = this.readSetupLink();
    if (link) return this.confirmSetupLink(link);
    await this.route();
  },

  framed() {
    try {
      return window.top !== window.self;
    } catch {
      return true;
    }
  },

  async route() {
    const mode = lsGet(LS.mode, null);
    if (mode === 'demo') return this.startDemo();
    const cfg = lsGet(LS.supa, null);
    if (!cfg || !cfg.url || !cfg.key) return Screens.setup();
    return this.startSupabase(cfg);
  },

  async restart() {
    Sync.stop();
    if (this.authSub) {
      try {
        this.authSub.unsubscribe();
      } catch { /* déjà désabonné */ }
      this.authSub = null;
    }
    Store.close();
    this.backend = null;
    await this.route();
  },

  async startSupabase(cfg) {
    if (!globalThis.supabase || typeof supabase.createClient !== 'function') {
      return Screens.fatal("Le module Supabase n'a pas pu être chargé. Vérifie la connexion internet puis recharge : une fois ouverte avec internet, l'appli fonctionne aussi hors-ligne.");
    }
    let backend;
    try {
      backend = new SupabaseBackend(cfg.url, cfg.key);
    } catch (e) {
      console.error(e);
      return Screens.setup();
    }
    this.backend = backend;
    const { data: sub } = backend.sb.auth.onAuthStateChange((event, session) => this.onAuth(event, session));
    this.authSub = sub && sub.subscription;

    let user = null;
    try {
      const { data, error } = await backend.sb.auth.getSession();
      if (data && data.session) user = data.session.user;
      else if (error && classifyError(wrapError(error, error.status)) === 'network') user = this.storedUser(backend);
    } catch {
      user = this.storedUser(backend);
    }
    if (!user && navigator.onLine === false) user = this.storedUser(backend);
    if (!user) return Screens.login();
    // double authentification activée et session « mot de passe seul » (appli fermée sur l'écran du code)
    const factorId = await Mfa.factorToVerify(backend);
    if (factorId) return Screens.mfa({ backend, user, factorId });
    return this.enter(backend, user);
  },

  // Hors-ligne avec un jeton expiré : on garde l'accès à la copie locale, la reconnexion se fera au retour du réseau
  storedUser(backend) {
    try {
      const raw = localStorage.getItem(`p3d-auth-${backend.ref}`);
      if (!raw) return null;
      const s = JSON.parse(raw);
      const sess = s && (s.currentSession || s);
      return sess && sess.user && sess.user.id ? sess.user : null;
    } catch {
      return null;
    }
  },

  async enter(backend, user) {
    backend.userId = user.id;
    backend.email = user.email || '';
    Mfa.reset();
    await Store.open(`${backend.ref}:${user.id}`, user.id);
    Screens.hide();
    App.start();
    Sync.start(backend);
    this.bindNotifier();
  },

  async startDemo() {
    const backend = new DemoBackend();
    await backend.load();
    this.backend = backend;
    await Store.open('demo', backend.userId);
    Screens.hide();
    App.start();
    Sync.start(backend);
    this.bindNotifier();
    // Première ouverture : la démo est remplie d'exemples (c'est ce que promet l'écran d'accueil).
    // Une seule fois : après « Vider la démo », elle reste vide.
    if (!lsGet(LS.demoSeeded, false) && ['spools', 'templates', 'productions', 'sales'].every((t) => backend.S[t].size === 0)) {
      try {
        await Demo.seed();
        lsSet(LS.demoSeeded, true);
      } catch (e) {
        // la démo reste utilisable (vide ou partielle) ; « Remplir avec des exemples » reste possible dans Paramètres
        console.error('[paulo3d] exemples de démo non ajoutés', e);
        toast("Les exemples de la démo n'ont pas pu être ajoutés (mémoire de l'appareil pleine ?).", { tone: 'warn' });
      }
    }
  },

  bindNotifier() {
    if (this.notifierBound) return;
    this.notifierBound = true;
    Sync.subscribe((state) => {
      if (state.flushing) return;
      if (Sync.confirmedWhileAway > 0) {
        const n = Sync.confirmedWhileAway;
        Sync.confirmedWhileAway = 0;
        toast(`${n} action${n > 1 ? 's' : ''} en attente ${n > 1 ? 'sont maintenant enregistrées' : 'est maintenant enregistrée'} dans la base.`, { tone: 'ok', title: 'Synchronisé' });
      }
      if (Sync.skippedWhileAway > 0) {
        const n = Sync.skippedWhileAway;
        Sync.skippedWhileAway = 0;
        toast(`${n > 1 ? `${n} actions en attente n'ont` : "1 action en attente n'a"} rien enregistré : l'élément avait été supprimé sur un autre appareil.`, { tone: 'warn', title: 'Action ignorée' });
      }
      if (Sync.failedWhileAway > 0) {
        const n = Sync.failedWhileAway;
        Sync.failedWhileAway = 0;
        toast(`${n} action${n > 1 ? 's ont été refusées' : ' a été refusée'} par la base. Ouvre la synchronisation pour voir pourquoi.`, { tone: 'bad', title: 'Action refusée' });
      }
    });
  },

  onAuth(event, session) {
    const b = this.backend;
    if (!b || b.kind !== 'supabase') return;
    if (event === 'PASSWORD_RECOVERY') {
      setTimeout(() => openNewPasswordModal({ title: 'Choisis un nouveau mot de passe' }), 400);
      return;
    }
    if (event === 'SIGNED_OUT' && !this.loggingOut && b.userId) {
      Sync.state.needsLogin = true;
      Sync.emit();
      App.updateChrome();
      return;
    }
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session && b.userId && session.user.id === b.userId && Sync.state.needsLogin) {
      Sync.state.needsLogin = false;
      Sync.kick();
    }
    // code de double authentification validé (écran de connexion ou fenêtre « Code de sécurité »)
    if (event === 'MFA_CHALLENGE_VERIFIED' && b.userId && Sync.state.needsMfa) {
      Sync.state.needsMfa = false;
      Sync.kick();
    }
  },

  async logout() {
    const b = this.backend;
    this.loggingOut = true;
    Sync.stop();
    try {
      if (b && b.kind === 'supabase') await b.sb.auth.signOut({ scope: 'local' });
    } catch { /* hors-ligne : la session locale est effacée quand même */ }
    this.loggingOut = false;
    Store.close();
    Store.S = emptyState();
    Store.Q = [];
    Store.rebuild(true);
    if (b) b.userId = null;
    Mfa.reset();
    Screens.login();
  },

  async clearLocal() {
    const name = Store.dbName;
    Sync.stop();
    Store.close();
    if (name) await IDB.clearAll(name);
    location.reload();
  },

  readSetupLink() {
    const m = location.hash.match(/[#&/]setup=([A-Za-z0-9_-]+)/);
    if (!m) return null;
    history.replaceState(null, '', `${location.pathname}${location.search}#/`);
    try {
      const obj = JSON.parse(b64urlDecode(m[1]));
      const url = normalizeSupaUrl(obj.u);
      const key = String(obj.k || '').trim();
      if (!url || keyProblem(key)) return null;
      return { url, key };
    } catch {
      return null;
    }
  },

  // Un lien de configuration peut venir de n'importe qui : on montre la base visée avant de l'adopter
  confirmSetupLink(link) {
    const current = lsGet(LS.supa, null);
    if (current && current.url === link.url && current.key === link.key) return this.route();
    const el = Screens.frame(html`<div class="card p-5 sm:p-6">
      <h1 class="font-display text-xl font-bold text-slate-50">Configurer cet appareil ?</h1>
      <p class="mt-2 text-sm text-slate-400">Ce lien relie l'application à la base :</p>
      <p class="mt-2 break-all rounded-xl bg-white/[0.04] p-3 font-mono text-[13px] text-slate-100">${link.url}</p>
      ${current ? html`<p class="mt-3 text-[13px] text-amber-300">Attention : cet appareil est actuellement relié à ${current.url}.</p>` : ''}
      <p class="mt-3 text-[13px] text-slate-400">N'accepte que si ce lien vient de toi (paramètres de ton appli, sur ton autre appareil).</p>
      <div class="mt-5 flex gap-2"><button class="btn btn-ghost h-11 flex-1 rounded-xl" id="link-no">Refuser</button><button class="btn btn-primary h-11 flex-1 rounded-xl" id="link-yes">Utiliser cette base</button></div>
    </div>`);
    el.querySelector('#link-yes').addEventListener('click', async () => {
      lsSet(LS.supa, link);
      lsSet(LS.mode, 'supabase');
      await this.restart();
    });
    el.querySelector('#link-no').addEventListener('click', () => this.route());
  },

  captureInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      App.installPrompt = e;
      if (App.mounted && App.route.name === 'parametres') App.render();
    });
    window.addEventListener('appinstalled', () => {
      App.installPrompt = null;
      toast('Application installée', { tone: 'ok' });
    });
  },

  registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!this.updateRequested || this.reloading) return;
      this.reloading = true;
      location.reload();
    });
    const register = () => {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        const offer = (w) => {
          if (w && navigator.serviceWorker.controller) this.offerUpdate(w);
        };
        if (reg.waiting) offer(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (w) w.addEventListener('statechange', () => {
            if (w.state === 'installed') offer(w);
          });
        });
        setInterval(() => reg.update().catch(() => {}), 60 * 60000);
        this.checkOfflineCache();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') this.checkOfflineCache();
        });
      }).catch((e) => console.warn('[paulo3d] service worker non installé', e));
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register);
  },

  // Un autre site à la même adresse peut vider tous les caches du navigateur (son service worker
  // supprime ce qui n'est pas à lui) : sans réparation, Paulo3D ne s'ouvrirait plus sans réseau.
  // Dès qu'elle est ouverte avec du réseau, la copie hors-ligne est reconstituée.
  async checkOfflineCache() {
    try {
      if (navigator.onLine === false || !globalThis.caches) return;
      const reg = await navigator.serviceWorker.ready;
      if (!reg.active || reg.waiting) return;
      // ⚠️ Le cache peut EXISTER et être VIDE : le service worker le recrée (vide) à chaque
      // requête via caches.open(), et une réparation ratée (4G faible) laisse aussi un cache
      // vide. Tester son existence ne réparait donc presque jamais : on vérifie qu'il contient
      // la page de l'appli — exactement ce que le service worker sert hors-ligne.
      const shell = await caches.open(`p3d-shell-${APP_VERSION}`);
      if ((await shell.match('./index.html')) || (await shell.match('./'))) return;
      reg.active.postMessage({ type: 'RECACHE', version: APP_VERSION });
    } catch { /* vérification facultative */ }
  },

  offerUpdate(worker) {
    if (this.updateOffered) return;
    this.updateOffered = true;
    const bar = document.createElement('div');
    bar.className = 'fixed inset-x-0 top-0 z-[70] flex justify-center px-3 pt-[max(0.75rem,env(safe-area-inset-top))]';
    bar.innerHTML = String(html`<div class="flex items-center gap-3 rounded-2xl border border-neon/30 bg-ink-850/95 py-2 pl-4 pr-2 shadow-2xl shadow-black/50 backdrop-blur">
      ${icon('Sparkles', 'w-4 h-4 text-neon')}<span class="text-sm text-slate-200">Nouvelle version disponible</span>
      <button class="btn btn-primary h-8 rounded-lg px-3 text-[13px]" data-update>Mettre à jour</button>
      <button class="grid h-8 w-8 place-items-center text-slate-500 hover:text-slate-200" data-dismiss aria-label="Plus tard">${icon('X', 'w-4 h-4')}</button>
    </div>`);
    bar.querySelector('[data-update]').addEventListener('click', () => {
      this.updateRequested = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
      setTimeout(() => location.reload(), 4000);
    });
    bar.querySelector('[data-dismiss]').addEventListener('click', () => bar.remove());
    document.body.appendChild(bar);
  },
};

if (typeof document !== 'undefined') {
  const go0 = () => Boot.start().catch((e) => {
    console.error('[paulo3d] démarrage impossible', e);
    Screens.fatal(`Démarrage impossible : ${e && e.message ? e.message : e}`);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go0);
  else go0();
}
