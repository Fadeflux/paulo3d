/* =============================================================================
   Synchronisation
   - Toute action passe par la file d'envoi, gardée sur l'appareil AVANT d'être
     annoncée. L'écran ne dit « enregistré » qu'après la réponse de la base.
   - Sans réseau : l'action attend et repart toute seule au retour du réseau.
   - Refusée par la base : l'action est mise de côté et affichée, jamais oubliée.
   ============================================================================= */

async function withLock(name, fn) {
  if (globalThis.navigator && navigator.locks && typeof navigator.locks.request === 'function') {
    return navigator.locks.request(name, fn);
  }
  return fn();
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  });
  await Promise.all(workers);
  return out;
}

const Sync = {
  backend: null,
  state: {
    online: globalThis.navigator ? navigator.onLine !== false : true,
    flushing: false,
    pulling: false,
    realtime: 'off',
    lastPullAt: null,
    lastConfirmAt: null,
    lastError: null,
    needsLogin: false,
    schemaVersion: null,
    firstPullDone: false,
  },
  waiters: new Map(),
  listeners: new Set(),
  retryTimer: null,
  retryDelay: 0,
  flushAgain: false,
  timers: [],
  confirmedWhileAway: 0,
  failedWhileAway: 0,

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },
  emit() {
    for (const fn of this.listeners) {
      try {
        fn(this.state);
      } catch (e) {
        console.error(e);
      }
    }
  },

  start(backend) {
    this.stop();
    this.backend = backend;
    this.state.needsLogin = false;
    this.state.firstPullDone = false;
    const onOnline = () => {
      this.state.online = true;
      this.emit();
      this.kick();
    };
    const onOffline = () => {
      this.state.online = false;
      this.emit();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        const stale = !this.state.lastPullAt || Date.now() - time(this.state.lastPullAt) > 30000;
        if (stale) this.kick();
      }
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    const every = setInterval(() => {
      if (document.visibilityState === 'visible') this.kick();
    }, 5 * 60000);
    this.timers.push(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(every);
    });
    if (channel) {
      const onMsg = async (ev) => {
        if (ev.data && ev.data.type === 'outbox' && ev.data.db === Store.dbName) {
          await Store.reloadQueue();
          Store.rebuild();
          this.emit();
        }
      };
      channel.addEventListener('message', onMsg);
      this.timers.push(() => channel.removeEventListener('message', onMsg));
    }
    backend.subscribe(
      (payload) => this.onRealtime(payload),
      (status) => this.onRealtimeStatus(status),
    );
    this.kick(true);
  },

  stop() {
    for (const off of this.timers) off();
    this.timers = [];
    clearTimeout(this.retryTimer);
    if (this.backend) this.backend.unsubscribe();
    this.backend = null;
    this.state.realtime = 'off';
  },

  async kick(reconcile = false) {
    await this.flush();
    await this.pull({ reconcile });
    if (Store.Q.some((o) => o.status === 'pending')) await this.flush();
  },

  // Enregistre une action. Résultat : confirmed | queued | failed | rejected
  async enqueue(type, payload, { wait = 7000 } = {}) {
    const def = OPS[type];
    if (!def) return { state: 'rejected', error: new OpError('LOCAL', `Action inconnue : ${type}`) };
    const err = def.validate ? def.validate(Store.V, payload) : null;
    if (err) return { state: 'rejected', error: err };
    const op = { id: uuid(), type, payload, created_at: new Date().toISOString(), status: 'pending', attempts: 0, error: null };
    Store.Q.push(op);
    const kept = await Store.persistQueue();
    if (!kept) {
      Store.Q = Store.Q.filter((o) => o.id !== op.id);
      return { state: 'rejected', error: new OpError('LOCAL', "L'appareil n'a pas pu garder cette action (mémoire pleine ?). Rien n'a été enregistré.") };
    }
    Store.rebuild();
    this.emit();
    const done = new Promise((resolve) => this.waiters.set(op.id, resolve));
    this.flush();
    const timeout = sleep(wait).then(() => ({ state: 'queued', slow: true }));
    const res = await Promise.race([done, timeout]);
    return { ...res, opId: op.id };
  },

  resolveWaiter(opId, result) {
    const w = this.waiters.get(opId);
    if (w) {
      this.waiters.delete(opId);
      w(result);
    } else if (result.state === 'confirmed') {
      this.confirmedWhileAway++;
    } else if (result.state === 'failed') {
      this.failedWhileAway++;
    }
  },

  resolvePendingAsQueued() {
    for (const op of Store.Q) if (op.status === 'pending') this.resolveWaiter(op.id, { state: 'queued' });
  },

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    this.retryDelay = Math.min(60000, this.retryDelay ? this.retryDelay * 2 : 3000);
    this.retryTimer = setTimeout(() => this.kick(), this.retryDelay);
  },

  async flush() {
    if (!this.backend || !this.backend.ready()) {
      this.resolvePendingAsQueued();
      return;
    }
    if (this.state.flushing) {
      this.flushAgain = true;
      return;
    }
    this.state.flushing = true;
    this.emit();
    try {
      await withLock(`p3d-flush:${Store.dbName}`, async () => {
        await Store.reloadQueue();
        for (;;) {
          const op = Store.Q.find((o) => o.status === 'pending');
          if (!op) break;
          op.status = 'sending';
          op.attempts = (op.attempts || 0) + 1;
          await Store.persistQueue();
          let bundle;
          try {
            bundle = await this.backend.send(op);
          } catch (e) {
            const kind = classifyError(e);
            if (kind === 'network') {
              op.status = 'pending';
              await Store.persistQueue();
              this.state.online = false;
              this.scheduleRetry();
              this.resolvePendingAsQueued();
              return;
            }
            if (kind === 'auth' && !op.authRetried) {
              op.status = 'pending';
              op.authRetried = true;
              await Store.persistQueue();
              const r = await this.backend.refreshAuth();
              if (r === 'ok') continue;
              if (r === 'invalid') this.state.needsLogin = true;
              else this.scheduleRetry();
              this.resolvePendingAsQueued();
              return;
            }
            if (kind === 'schema') {
              op.status = 'pending';
              await Store.persistQueue();
              this.state.lastError = friendlyError(e, op);
              this.resolvePendingAsQueued();
              return;
            }
            op.status = 'failed';
            op.error = { code: e.code || '', message: friendlyError(e, op), at: new Date().toISOString() };
            await Store.persistQueue();
            Store.rebuild();
            this.resolveWaiter(op.id, { state: 'failed', error: op.error });
            continue;
          }
          Store.mergeBundle(bundle);
          Store.Q = Store.Q.filter((o) => o.id !== op.id);
          await Store.persistQueue();
          Store.persistSnapshot();
          Store.rebuild();
          this.state.online = true;
          this.state.lastConfirmAt = new Date().toISOString();
          this.retryDelay = 0;
          this.resolveWaiter(op.id, { state: 'confirmed' });
          if (bundle && bundle.pullAfter) setTimeout(() => this.pull(), 50);
        }
      });
    } catch (e) {
      console.error('[paulo3d] envoi interrompu', e);
    } finally {
      this.state.flushing = false;
      this.emit();
      if (this.flushAgain) {
        this.flushAgain = false;
        this.flush();
      }
    }
  },

  async pull({ reconcile = false } = {}) {
    if (!this.backend || !this.backend.ready() || this.state.pulling) return;
    this.state.pulling = true;
    this.emit();
    const startedAt = Date.now();
    try {
      if (this.state.schemaVersion === null) {
        this.state.schemaVersion = await this.backend.checkSchema();
      }
      const since = Store.meta.lastPull || {};
      const results = await mapLimit(TABLES, 4, async (t) => [t, await this.backend.pullTable(t, since[t])]);
      for (const [t, rows] of results) {
        Store.upsertRows(t, rows);
        let max = since[t] || null;
        for (const r of rows) if (r.updated_at && (!max || time(r.updated_at) > time(max))) max = r.updated_at;
        if (max) Store.meta.lastPull = { ...Store.meta.lastPull, [t]: max };
      }
      const needReconcile = reconcile || !Store.meta.lastReconcile || Date.now() - Store.meta.lastReconcile > 10 * 60000;
      if (needReconcile) {
        const idLists = await mapLimit(TABLES, 4, async (t) => [t, await this.backend.pullIds(t)]);
        for (const [t, ids] of idLists) Store.reconcile(t, ids, startedAt);
        Store.meta.lastReconcile = Date.now();
      }
      Store.dirty.add('settings');
      await Store.persistSnapshotNow();
      Store.rebuild();
      this.state.online = true;
      this.state.lastPullAt = new Date().toISOString();
      this.state.lastError = null;
      this.state.firstPullDone = true;
      if (!firstRow(Store.S.settings) && !Store.Q.some((o) => o.type === 'settings.save')) {
        this.enqueue('settings.save', { ...DEFAULT_SETTINGS }, { wait: 0 });
      }
    } catch (e) {
      const kind = classifyError(e);
      if (kind === 'network') {
        this.state.online = false;
        this.scheduleRetry();
      } else if (kind === 'auth') {
        const r = await this.backend.refreshAuth();
        if (r === 'invalid') this.state.needsLogin = true;
        else this.scheduleRetry();
      } else {
        this.state.lastError = friendlyError(e);
        console.error('[paulo3d] lecture de la base impossible', e);
      }
    } finally {
      this.state.pulling = false;
      this.emit();
    }
  },

  onRealtime(payload) {
    const t = payload.table;
    if (!TABLES.includes(t)) return;
    if (payload.eventType === 'DELETE') {
      const id = payload.old && payload.old[PK(t)];
      if (id) Store.deleteIds(t, [id]);
    } else if (payload.new) {
      Store.upsertRows(t, [payload.new]);
      if (payload.new.updated_at) {
        const cur = Store.meta.lastPull[t];
        if (!cur || time(payload.new.updated_at) > time(cur)) Store.meta.lastPull = { ...Store.meta.lastPull, [t]: payload.new.updated_at };
      }
    }
    this.realtimeRebuild();
  },

  realtimeRebuild: debounce(() => {
    Store.rebuild();
    Store.persistSnapshot();
  }, 120),

  onRealtimeStatus(status) {
    const prev = this.state.realtime;
    this.state.realtime = status === 'SUBSCRIBED' ? 'on' : status === 'CLOSED' ? 'off' : 'error';
    this.emit();
    if (status === 'SUBSCRIBED' && prev !== 'on' && this.state.firstPullDone) this.pull();
  },

  async retryOp(opId) {
    const op = Store.Q.find((o) => o.id === opId);
    if (!op) return;
    op.status = 'pending';
    op.error = null;
    op.authRetried = false;
    await Store.persistQueue();
    Store.rebuild();
    this.emit();
    this.flush();
  },

  async discardOp(opId) {
    Store.Q = Store.Q.filter((o) => o.id !== opId);
    await Store.persistQueue();
    Store.rebuild();
    this.emit();
  },

  summary() {
    const failed = Store.Q.filter((o) => o.status === 'failed').length;
    const pending = Store.Q.length - failed;
    const s = this.state;
    if (this.backend && this.backend.kind === 'demo') {
      if (this.backend.offline()) return { tone: 'off', label: pending ? `Démo hors-ligne · ${pending}` : 'Démo hors-ligne', pending, failed };
      return { tone: 'demo', label: failed ? `Démo · ${failed} refusée${failed > 1 ? 's' : ''}` : 'Mode démo', pending, failed };
    }
    if (s.needsLogin) return { tone: 'bad', label: 'Reconnexion requise', pending, failed };
    if (failed) return { tone: 'bad', label: `${failed} action${failed > 1 ? 's' : ''} refusée${failed > 1 ? 's' : ''}`, pending, failed };
    if (!s.online) return { tone: 'off', label: pending ? `Hors-ligne · ${pending} en attente` : 'Hors-ligne', pending, failed };
    if (pending || s.flushing) return { tone: 'warn', label: pending ? `Envoi · ${pending} en attente` : 'Envoi…', pending, failed };
    if (s.lastError) return { tone: 'bad', label: 'Base injoignable', pending, failed };
    if (!s.firstPullDone && s.pulling) return { tone: 'warn', label: 'Chargement…', pending, failed };
    return { tone: 'ok', label: 'Synchronisé', pending, failed };
  },
};
