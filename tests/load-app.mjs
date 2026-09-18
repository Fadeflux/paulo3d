// Charge le code RÉEL de l'application (.dev/app.js, produit par le build) dans un bac à sable Node.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadApp() {
  const file = path.join(ROOT, '.dev', 'app.js');
  if (!fs.existsSync(file)) throw new Error('Lance d’abord « node tools/build.mjs --dev »');
  const code = fs.readFileSync(file, 'utf8');
  const ctx = vm.createContext({ console, crypto: globalThis.crypto, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL, URLSearchParams, atob, btoa });
  vm.runInContext(code, ctx, { filename: 'app.js' });
  const names = [
    'TABLES', 'PK', 'OPS', 'OpError', 'DEFAULT_SETTINGS', 'Store', 'Sync', 'DemoBackend',
    'buildView', 'emptyState', 'cloneState', 'uuid', 'html', 'raw', 'esc', 'parseNum', 'roundDb', 'round', 'fmtEur', 'fmtG', 'fmtDuration',
    'safeHex', 'colorDistance', 'periodRange', 'inRange', 'settingsOf', 'spoolCpg', 'spoolStatus', 'computeSpoolRemaining', 'candidateSpools',
    'suggestSpool', 'lineCpg', 'templateCost', 'roundPrice', 'pricingOf', 'suggestPrice', 'marginInfo', 'templatePrice', 'planProduction',
    'simulateFifo', 'stockGroups', 'planSale', 'channelFee', 'computeStats', 'monthlySeries', 'topProducts', 'historyEvents', 'toCsv', 'csvCell',
    'exportCsvSales', 'exportJson', 'parseDurationToMin', 'parseBambuSliceInfo', 'parseGcodeText', 'parseSlicerText', 'importToTemplate',
    'normalizeMaterial', 'classifyError', 'friendlyError', 'normalizeSupaUrl', 'projectRefFromUrl', 'keyProblem', 'b64urlEncode', 'b64urlDecode',
    'valuesOf', 'firstRow', 'pick', 'SPOOL_FIELDS', 'TEMPLATE_FIELDS', 'MACHINE_FIELDS', 'SETTINGS_FIELDS', 'REMOTE', 'ICONS', 'APP_VERSION',
    'tsMicros', 'normalizeRow', 'attrList', 'AUTH_CODES', 'inputNum', 'plural', 'exportCsvJournal',
    'passwordProblem', 'authErrorMessage', 'PASSWORD_MIN', 'weighProblem', 'isPieceCount', 'backupStatus',
  ];
  vm.runInContext(`globalThis.__app = { ${names.join(', ')} };`, ctx);
  return ctx.__app;
}

// État vide + application d'une suite d'actions, comme le ferait la « base » de démo
export function applyOps(app, ops, userId = '00000000-0000-4000-8000-000000000001') {
  let S = app.emptyState();
  for (const [type, payload, when] of ops) {
    const def = app.OPS[type];
    if (def.done && def.done(S, payload)) continue;
    const V = app.cloneState(S);
    const err = def.validate ? def.validate(V, payload) : null;
    if (err) throw err;
    def.apply(V, payload, { userId, now: when || new Date().toISOString() });
    S = {};
    for (const t of app.TABLES) S[t] = V[t];
  }
  return S;
}
