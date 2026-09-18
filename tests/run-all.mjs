// Lance tous les tests : build de test, calculs, synchronisation, service worker, parité appli/base, script SQL.
// Usage : npm test
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (args) => execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });

run(['tools/build.mjs', '--dev']);
run(['--test', '--test-reporter=spec', '--test-timeout=120000', 'tests/domain.test.mjs', 'tests/sync.test.mjs', 'tests/sw.test.mjs', 'tests/csp.test.mjs', 'tests/parity.test.mjs', 'tests/sql.test.mjs']);
