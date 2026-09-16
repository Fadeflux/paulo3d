// Base PostgreSQL 17 locale et jetable pour les tests (jamais la base réelle).
import EmbeddedPostgres from 'embedded-postgres';
import pgPkg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const { Client } = pgPkg;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SCHEMA_SQL = fs.readFileSync(process.env.P3D_SCHEMA || path.join(ROOT, 'supabase', 'schema.sql'), 'utf8');
export const STUBS_SQL = fs.readFileSync(path.join(ROOT, 'tests', 'supabase-stubs.sql'), 'utf8');

export async function startPostgres({ port = 54329, dir } = {}) {
  const databaseDir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'p3d-pg-'));
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: 'postgres',
    password: 'postgres-local',
    port,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  const connect = async () => {
    const c = new Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres-local', database: 'postgres', client_encoding: 'UTF8' });
    await c.connect();
    const enc = (await c.query('show server_encoding')).rows[0].server_encoding;
    if (enc !== 'UTF8') throw new Error(`Base de test en ${enc} au lieu de UTF8 : les tests ne mesureraient pas la réalité.`);
    return c;
  };
  return { pg, port, databaseDir, connect, stop: () => pg.stop() };
}

// Exécute fn dans une transaction « comme PostgREST » : rôle + jeton JWT simulé.
export async function asUser(client, uid, fn, { role = 'authenticated' } = {}) {
  await client.query('begin');
  try {
    if (uid) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role })]);
    }
    await client.query(`set local role ${role}`);
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}
