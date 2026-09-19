// Lance tous les tests : build de test, calculs, synchronisation, service worker, parité appli/base, script SQL.
// Usage : npm test
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (args) => execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });

run(['tools/build.mjs', '--dev']);
// les deux sites publiés, construits comme en production (langue, noms) pour tests/sites.test.mjs
run(['tools/build.mjs', '--dev', '--site', 'paulo3d']);
run(['tools/build.mjs', '--dev', '--site', 'anais3d']);
// pages de redirection des anciennes adresses Railway (tests/ancienne-adresse.test.mjs)
for (const id of ['paulo3d', 'anais3d', 'nail-studio']) run(['tools/railway-redirect.mjs', id, '--prepare-only']);
run(['--test', '--test-reporter=spec', '--test-timeout=120000', 'tests/domain.test.mjs', 'tests/pdf.test.mjs', 'tests/sites.test.mjs', 'tests/sync.test.mjs', 'tests/synchro-maintenant.test.mjs', 'tests/delai-reseau.test.mjs', 'tests/formulaire-partiel.test.mjs', 'tests/export-date.test.mjs', 'tests/ancienne-adresse.test.mjs', 'tests/revue-1909.test.mjs', 'tests/sw.test.mjs', 'tests/recache.test.mjs', 'tests/csp.test.mjs', 'tests/parity.test.mjs', 'tests/sql.test.mjs']);
