// Imitation LOCALE de Supabase pour tester l'appli de bout en bout, sans jamais toucher une vraie base.
//   - PostgreSQL 17 jetable (embedded-postgres) + schema.sql
//   - PostgREST (binaire officiel, .dev/tools/postgrest.exe) derrière /rest/v1
//   - Authentification minimale (email + mot de passe, jetons JWT) derrière /auth/v1
//   - Pas de temps réel : l'appli doit s'en passer (relecture périodique)
//   - /__dev/offline?on=1 simule une coupure réseau des requêtes de données
//   - Double authentification (TOTP) comme Supabase ; /__dev/totp?factor=<id> donne le code du moment
// Usage : node tools/dev-supabase.mjs   (URL http://127.0.0.1:54321, clé anon affichée au démarrage)
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startPostgres, SCHEMA_SQL, STUBS_SQL } from '../tests/pg-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 54321;
const REST_PORT = 54322;
const PG_PORT = 54394;
const SECRET = 'paulo3d-dev-secret-local-uniquement-0123456789';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
function sign(payload) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verify(token) {
  const [h, b, s] = String(token || '').split('.');
  if (!h || !b || !s) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url');
  if (expect !== s) return null;
  const p = JSON.parse(Buffer.from(b, 'base64url').toString());
  return p.exp && p.exp * 1000 < Date.now() ? null : p;
}
export const ANON_KEY = sign({ iss: 'paulo3d-dev', role: 'anon', iat: 1758000000, exp: 2000000000 });

const db = await startPostgres({ port: PG_PORT });
const pg = await db.connect();
await pg.query(STUBS_SQL);
await pg.query(SCHEMA_SQL);
await pg.query('create table if not exists auth.dev_passwords (user_id uuid primary key, hash text not null)');

const cfgPath = path.join(ROOT, '.dev', 'postgrest.conf');
fs.writeFileSync(cfgPath, [
  `db-uri = "postgres://authenticator:authenticator-local@127.0.0.1:${PG_PORT}/postgres"`,
  'db-schemas = "public"',
  'db-anon-role = "anon"',
  `jwt-secret = "${SECRET}"`,
  'server-host = "127.0.0.1"',
  `server-port = ${REST_PORT}`,
  'db-pool = 5',
  'log-level = "warn"',
].join('\n'));
// PostgREST a besoin de libpq.dll : on réutilise celle fournie avec le PostgreSQL local
const pgBin = path.join(ROOT, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin');
const rest = spawn(path.join(ROOT, '.dev', 'tools', 'postgrest.exe'), [cfgPath], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, PATH: `${pgBin}${path.delimiter}${process.env.PATH || process.env.Path || ''}` },
});
rest.on('exit', (code) => console.error(`PostgREST s'est arrêté (code ${code})`));

const sessions = new Map(); // jeton de rafraîchissement → { user, aal, amr }
const challenges = new Map();
let offline = false;
let expireNext = false;
let revokedBefore = 0;

// Double authentification (TOTP, RFC 6238 : SHA-1, 30 s, 6 chiffres), comme Supabase et Google Authenticator
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
function unbase32(s) {
  let bits = '';
  for (const ch of String(s).replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(ch).toString(2).padStart(5, '0');
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(secret, step = Math.floor(Date.now() / 30000)) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0');
}
const totpOk = (secret, code) => [-1, 0, 1].some((d) => totp(secret, Math.floor(Date.now() / 30000) + d) === String(code));

async function userObject(user) {
  const factors = (await pg.query('select id, friendly_name, factor_type, status, created_at, updated_at from auth.mfa_factors where user_id = $1 order by created_at', [user.id])).rows;
  return {
    id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: 'email' }, user_metadata: {}, identities: [], factors, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}

async function makeSession(user, aal = 'aal1', methods = ['password']) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = expireNext ? 5 : 3600;
  expireNext = false;
  const amr = methods.map((method) => ({ method, timestamp: now }));
  const access = sign({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', aal, amr, iat: now, exp: now + ttl, session_id: crypto.randomUUID() });
  const refresh = crypto.randomBytes(24).toString('hex');
  sessions.set(refresh, { user: { id: user.id, email: user.email }, aal, methods });
  return { access_token: access, token_type: 'bearer', expires_in: ttl, expires_at: now + ttl, refresh_token: refresh, user: await userObject(user) };
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, prefer, accept, accept-profile, content-profile, range, range-unit, x-client-info, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'content-range, range, x-total-count',
};

const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks)));
});
const json = (res, status, obj) => {
  res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const hash = (pw) => crypto.createHash('sha256').update(`p3d:${pw}`).digest('hex');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }
  try {
    if (url.pathname === '/__dev/offline') {
      offline = url.searchParams.get('on') === '1';
      return json(res, 200, { offline });
    }
    if (url.pathname === '/__dev/expire-next') {
      expireNext = true;
      return json(res, 200, { expireNext });
    }
    if (url.pathname === '/__dev/totp') {
      const f = (await pg.query('select secret from auth.mfa_factors where id = $1', [url.searchParams.get('factor')])).rows[0];
      return f ? json(res, 200, { code: totp(f.secret) }) : json(res, 404, { message: 'facteur inconnu' });
    }
    if (url.pathname === '/__dev/revoke') {
      // révoque toutes les sessions : jetons de rafraîchissement invalides, jetons d'accès refusés
      sessions.clear();
      revokedBefore = Math.floor(Date.now() / 1000);
      return json(res, 200, { revoked: true });
    }
    if (url.pathname.startsWith('/auth/v1/')) {
      if (req.headers.apikey !== ANON_KEY) return json(res, 401, { message: 'Invalid API key' });
      const route = url.pathname.slice('/auth/v1/'.length);
      const body = req.method === 'POST' ? JSON.parse((await readBody(req)).toString() || '{}') : {};
      if (route === 'settings') return json(res, 200, { disable_signup: false, external: { email: true }, mailer_autoconfirm: true });
      if (route === 'signup') {
        const email = String(body.email || '').toLowerCase();
        const exists = (await pg.query('select id from auth.users where email = $1', [email])).rows[0];
        if (exists) return json(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
        const id = crypto.randomUUID();
        await pg.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
        await pg.query('insert into auth.dev_passwords (user_id, hash) values ($1, $2)', [id, hash(body.password)]);
        return json(res, 200, await makeSession({ id, email }));
      }
      if (route === 'token') {
        const grant = url.searchParams.get('grant_type');
        if (grant === 'password') {
          const email = String(body.email || '').toLowerCase();
          const row = (await pg.query('select u.id, u.email, p.hash from auth.users u join auth.dev_passwords p on p.user_id = u.id where u.email = $1', [email])).rows[0];
          if (!row || row.hash !== hash(body.password)) return json(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
          return json(res, 200, await makeSession(row));
        }
        if (grant === 'refresh_token') {
          const s = sessions.get(body.refresh_token);
          if (!s) return json(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
          sessions.delete(body.refresh_token);
          // le niveau de la session (mot de passe seul, ou mot de passe + code) est conservé
          return json(res, 200, await makeSession(s.user, s.aal, s.methods));
        }
      }
      if (route === 'user') {
        const p = verify(String(req.headers.authorization || '').replace(/^Bearer /i, ''));
        if (!p || p.role !== 'authenticated') return json(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
        if (req.method === 'PUT') return json(res, 200, await userObject({ id: p.sub, email: p.email }));
        return json(res, 200, await userObject({ id: p.sub, email: p.email }));
      }
      if (route === 'factors' || route.startsWith('factors/')) {
        const p = verify(String(req.headers.authorization || '').replace(/^Bearer /i, ''));
        if (!p || p.role !== 'authenticated') return json(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
        const parts = route.split('/');
        if (parts.length === 1 && req.method === 'POST') {
          const taken = (await pg.query('select 1 from auth.mfa_factors where user_id = $1 and friendly_name = $2', [p.sub, body.friendly_name || ''])).rows.length;
          if (taken) return json(res, 422, { code: 422, error_code: 'mfa_factor_name_conflict', msg: `A factor with the friendly name "${body.friendly_name}" for this user already exists` });
          const id = crypto.randomUUID();
          const secret = base32(crypto.randomBytes(20));
          await pg.query("insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret) values ($1, $2, $3, 'totp', 'unverified', $4)", [id, p.sub, body.friendly_name || null, secret]);
          // SVG brut comme Supabase (avec des # : l'appli doit l'encoder correctement)
          const qr = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#ffffff"/><rect x="2" y="2" width="6" height="6" fill="#000000"/></svg>';
          return json(res, 200, { id, type: 'totp', friendly_name: body.friendly_name, totp: { qr_code: qr, secret, uri: `otpauth://totp/Paulo3D:${encodeURIComponent(p.email)}?secret=${secret}&issuer=Paulo3D` } });
        }
        const f = (await pg.query('select * from auth.mfa_factors where id = $1 and user_id = $2', [parts[1], p.sub])).rows[0];
        if (!f) return json(res, 404, { code: 404, error_code: 'mfa_factor_not_found', msg: 'Factor not found' });
        if (parts[2] === 'challenge' && req.method === 'POST') {
          const id = crypto.randomUUID();
          challenges.set(id, f.id);
          return json(res, 200, { id, type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 });
        }
        if (parts[2] === 'verify' && req.method === 'POST') {
          if (challenges.get(body.challenge_id) !== f.id) return json(res, 422, { code: 422, error_code: 'mfa_challenge_expired', msg: 'MFA challenge has expired' });
          if (!totpOk(f.secret, body.code)) return json(res, 422, { code: 422, error_code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered' });
          challenges.delete(body.challenge_id);
          await pg.query("update auth.mfa_factors set status = 'verified', updated_at = now() where id = $1", [f.id]);
          return json(res, 200, await makeSession({ id: p.sub, email: p.email }, 'aal2', ['password', 'totp']));
        }
        if (parts.length === 2 && req.method === 'DELETE') {
          if (f.status === 'verified' && p.aal !== 'aal2') return json(res, 422, { code: 422, error_code: 'insufficient_aal', msg: 'AAL2 required to unenroll verified factor' });
          await pg.query('delete from auth.mfa_factors where id = $1', [f.id]);
          return json(res, 200, { id: f.id });
        }
      }
      if (route === 'logout') {
        res.writeHead(204, cors);
        return res.end();
      }
      if (route === 'recover') return json(res, 200, {});
      return json(res, 404, { msg: `route auth inconnue : ${route}` });
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      if (offline) {
        req.socket.destroy();
        return undefined;
      }
      const bearer = verify(String(req.headers.authorization || '').replace(/^Bearer /i, ''));
      if (bearer && bearer.role === 'authenticated' && bearer.iat <= revokedBefore) {
        return json(res, 401, { code: 'PGRST303', details: null, hint: null, message: 'JWT expired' });
      }
      const body = await readBody(req);
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (['host', 'connection', 'content-length', 'origin', 'referer', 'apikey'].includes(k)) continue;
        headers[k] = v;
      }
      const proxied = http.request({ host: '127.0.0.1', port: REST_PORT, method: req.method, path: url.pathname.slice('/rest/v1'.length) + url.search, headers: { ...headers, 'content-length': body.length } }, (up) => {
        const out = { ...cors };
        for (const [k, v] of Object.entries(up.headers)) if (!['connection', 'transfer-encoding'].includes(k)) out[k] = v;
        res.writeHead(up.statusCode, out);
        up.pipe(res);
      });
      proxied.on('error', (e) => json(res, 502, { message: `PostgREST indisponible : ${e.message}` }));
      proxied.end(body);
      return undefined;
    }
    return json(res, 404, { message: 'introuvable' });
  } catch (e) {
    return json(res, 500, { message: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Supabase local prêt : http://127.0.0.1:${PORT}`);
  console.log(`Clé anon : ${ANON_KEY}`);
  fs.writeFileSync(path.join(ROOT, '.dev', 'supabase-local.json'), JSON.stringify({ url: `http://127.0.0.1:${PORT}`, key: ANON_KEY }, null, 2));
});

const stop = async () => {
  rest.kill();
  server.close();
  await pg.end().catch(() => {});
  await db.stop().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
