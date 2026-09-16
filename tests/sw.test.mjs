// Service worker RÉEL (.dev/site/sw.js) dans un faux environnement de navigateur :
// une mise à jour pendant une panne du CDN ne doit pas faire perdre les bibliothèques déjà en cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://paulo-3d.example';
const SW = fs.readFileSync(path.join(ROOT, '.dev', 'site', 'sw.js'), 'utf8');
const CDN = [...SW.matchAll(/"url":"(https:\/\/cdn\.jsdelivr\.net[^"]+)"/g)].map((m) => m[1]);

function makeRuntime({ cdnUp }) {
  const store = new Map();
  const abs = (u) => new URL(typeof u === 'string' ? u : u.url, `${ORIGIN}/`).href;
  const cacheObj = (name) => {
    const m = store.get(name);
    return {
      async match(req) {
        const r = m.get(abs(req));
        return r ? r.clone() : undefined;
      },
      async put(req, res) { m.set(abs(req), res); },
      async addAll(reqs) {
        for (const r of reqs) m.set(abs(r), new Response('shell', { status: 200 }));
      },
    };
  };
  const caches = {
    async open(name) {
      if (!store.has(name)) store.set(name, new Map());
      return cacheObj(name);
    },
    async keys() { return [...store.keys()]; },
    async delete(name) { return store.delete(name); },
    async match(req) {
      for (const m of store.values()) if (m.has(abs(req))) return m.get(abs(req)).clone();
      return undefined;
    },
  };
  const fetchMock = async (req) => {
    const url = abs(req);
    if (url.startsWith(ORIGIN)) return new Response('shell', { status: 200 });
    if (!cdnUp) throw new TypeError('Failed to fetch');
    return new Response('lib', { status: 200 });
  };
  const listeners = {};
  const self = { location: new URL(`${ORIGIN}/sw.js`), addEventListener: (t, f) => { listeners[t] = f; }, clients: { claim: async () => {} }, skipWaiting: () => {} };
  class Req {
    constructor(u, o = {}) {
      this.url = abs(u);
      Object.assign(this, o);
    }
  }
  vm.runInContext(SW, vm.createContext({ self, caches, fetch: fetchMock, Request: Req, Response, URL, console }));
  const fire = async (type, extra = {}) => {
    let wait = Promise.resolve();
    let responded;
    listeners[type]({ ...extra, waitUntil: (x) => { wait = x; }, respondWith: (x) => { responded = x; } });
    await wait;
    return responded ? await responded : undefined;
  };
  return { store, fire };
}

const oldInstall = (rt) => {
  rt.store.set('p3d-shell-ancienne', new Map([[`${ORIGIN}/index.html`, new Response('old')]]));
  rt.store.set('p3d-cdn-v1', new Map(CDN.map((u) => [u, new Response('old-lib')])));
};

test('mise à jour pendant une panne du CDN : les bibliothèques restent disponibles hors-ligne', async () => {
  assert.ok(CDN.length >= 4, 'adresses des bibliothèques lues dans sw.js');
  const rt = makeRuntime({ cdnUp: false });
  oldInstall(rt);
  await rt.fire('install');
  await rt.fire('activate');
  for (const url of CDN) {
    const res = await rt.fire('fetch', { request: { method: 'GET', url, mode: 'cors' } });
    assert.equal(res.status, 200, `${url} servie depuis le cache`);
  }
  assert.equal(rt.store.has('p3d-shell-ancienne'), false, 'ancienne page retirée');
});

test('mise à jour avec le CDN disponible : nouveau cache complet, ancien supprimé', async () => {
  const rt = makeRuntime({ cdnUp: true });
  oldInstall(rt);
  await rt.fire('install');
  await rt.fire('activate');
  assert.equal(rt.store.has('p3d-cdn-v1'), false);
  const current = [...rt.store.keys()].find((k) => k.startsWith('p3d-cdn-'));
  for (const url of CDN) assert.ok(rt.store.get(current).has(url));
});
