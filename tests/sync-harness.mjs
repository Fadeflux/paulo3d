// Bac à sable pour tester la synchronisation RÉELLE (.dev/app.js) sans navigateur ni base :
// stockage, verrous et fenêtre imités, faux client Supabase piloté par le test.
import { loadApp } from './load-app.mjs';

export const U = '00000000-0000-4000-8000-000000000001';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Arrêts à faire après chaque test, même en échec (sinon une minuterie de synchronisation garde le test ouvert)
export const cleanups = [];
export function cleanup() {
  while (cleanups.length) {
    try {
      cleanups.pop()();
    } catch { /* déjà arrêté */ }
  }
}

export function boot() {
  const app = loadApp();
  cleanups.push(() => app.Sync.stop());
  const F = app.uuid.constructor; // constructeur Function du bac à sable
  const G = new F('return this')();
  const get = (name) => new F(`return ${name}`)();
  const ls = new Map();
  G.localStorage = {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => ls.set(k, String(v)),
    removeItem: (k) => ls.delete(k),
  };
  const lockTails = new Map();
  G.navigator = {
    onLine: true,
    locks: {
      async request(name, fn) {
        const prev = lockTails.get(name) || Promise.resolve();
        let release;
        const mine = new Promise((r) => { release = r; });
        lockTails.set(name, prev.then(() => mine));
        await prev;
        try {
          return await fn();
        } finally {
          release();
        }
      },
    },
  };
  G.window = { addEventListener() {}, removeEventListener() {} };
  G.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  G.setInterval = setInterval;
  G.clearInterval = clearInterval;
  G.location = { reload() {} };
  const toasts = [];
  G.toast = (message, opts) => toasts.push({ message, ...(opts || {}) });
  return { app, G, get, ls, toasts, Store: app.Store, Sync: app.Sync };
}

// Copie locale vide, en mémoire (même code que le vrai stockage pour la file et l'affichage)
export function resetStore(Store, app) {
  Store.userId = U;
  Store.dbName = 'paulo3d:test';
  Store.db = null;
  Store.volatile = true;
  Store.S = app.emptyState();
  Store.Q = [];
  Store.meta = { lastPull: {}, lastReconcile: Date.now() };
  Store.tombstones = new Map();
  Store.receivedAt = new Map();
  Store.dirty = new Set();
  Store.rebuild(true);
}

export const httpErr = (status, code, message) => Object.assign(new Error(message), { status, code });

// Faux client supabase-js chaînable : handler(requête) -> { data, error, status }
export function fakeSb(handler, log = []) {
  const builder = (q) => {
    const b = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (res, rej) => Promise.resolve().then(() => { log.push(q); return handler(q); }).then(res, rej);
        return (...args) => {
          q.ops.push([prop, ...args]);
          return b;
        };
      },
    });
    return b;
  };
  return {
    from: (table) => builder({ table, ops: [] }),
    rpc: (fn, args) => builder({ table: `rpc:${fn}`, ops: [['rpc', args]] }),
    auth: {},
  };
}

export function fakeBackend(script, extra = {}) {
  const calls = [];
  return {
    kind: 'supabase', userId: U, calls,
    ready: () => true, subscribe() {}, unsubscribe() {},
    checkSchema: async () => 1, pullTable: async () => [], pullIds: async () => new Set(),
    refreshAuth: async () => 'ok',
    async send(op) {
      calls.push(op.type);
      return script(calls.length, op);
    },
    ...extra,
  };
}
