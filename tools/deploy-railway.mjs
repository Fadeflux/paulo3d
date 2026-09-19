// Met un site en ligne sur Railway (adresse sans le nom du compte GitHub, en-têtes de sécurité).
// Le code reste sur GitHub (Fadeflux) ; Railway ne sert que le site construit.
// Usage : node tools/deploy-railway.mjs paulo3d|anais3d
//   1. construit le site (node tools/build.mjs --site X)
//   2. prépare .dev/deploy-X/ : Dockerfile + Caddyfile + site/
//   3. railway up (le dossier est relié au projet Railway du site par « railway link »)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SITES } from './sites.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
const SITE = SITES[id];
if (!SITE) {
  console.error(`Usage : node tools/deploy-railway.mjs ${Object.keys(SITES).join('|')}`);
  process.exit(1);
}
execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build.mjs'), '--site', id], { stdio: 'inherit' });
const stage = path.join(ROOT, '.dev', `deploy-${id}`);
fs.rmSync(path.join(stage, 'site'), { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.cpSync(path.resolve(ROOT, SITE.out), path.join(stage, 'site'), { recursive: true });
for (const f of ['Dockerfile', 'Caddyfile']) fs.copyFileSync(path.join(ROOT, 'tools', 'deploy', f), path.join(stage, f));
if (process.argv.includes('--prepare-only')) {
  console.log(`préparé : ${stage}`);
  process.exit(0);
}
execFileSync('railway', ['up', '--detach', '--service', id], { cwd: stage, stdio: 'inherit', shell: true });
