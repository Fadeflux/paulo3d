/* =============================================================================
   Import rapide depuis le slicer
   - Fichier Bambu Studio .gcode.3mf / .3mf : Metadata/slice_info.config
     (format vérifié dans le code source de Bambu Studio : <plate> avec
      metadata « prediction » en secondes, « weight » en grammes, et
      <filament id type color used_m used_g/> — purge et tour incluses)
   - Fichier .gcode (Bambu, Orca, PrusaSlicer) : commentaires d'en-tête / de fin
   - Texte collé (récapitulatif, en français ou en anglais)
   ============================================================================= */

const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.2/dist/jszip.min.js';

function decodeXml(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
}

function parseAttrs(s) {
  const out = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = decodeXml(m[2]);
  return out;
}

function normalizeMaterial(type) {
  const t = String(type || '').trim();
  if (!t) return 'PLA';
  const hit = MATERIALS.find((m) => materialKey(m) === materialKey(t));
  if (hit) return hit;
  const up = t.toUpperCase();
  if (up.startsWith('PLA') && up.includes('CF')) return 'PLA-CF';
  if (up.startsWith('PETG') && up.includes('CF')) return 'PETG-CF';
  if (up.includes('SILK')) return 'PLA Silk';
  if (up.startsWith('PLA')) return 'PLA';
  if (up.startsWith('PETG') || up === 'PET') return 'PETG';
  if (up.startsWith('ABS')) return 'ABS';
  if (up.startsWith('ASA')) return 'ASA';
  if (up.startsWith('TPU') || up.startsWith('TPE')) return 'TPU';
  if (up.startsWith('PA') || up.startsWith('PAHT') || up.includes('NYLON')) return 'PA';
  if (up.startsWith('PC')) return 'PC';
  if (up.startsWith('PVA')) return 'PVA';
  return t.slice(0, 40);
}

// « 1d 2h 3m 4s », « 2h35 », « 2 h 35 min », « 155 min », « 1:35:00 », « 2,5 h » → minutes
function parseDurationToMin(text) {
  const s = String(text || '').toLowerCase().replace(/(\d),(\d)/g, '$1.$2');
  const colon = s.match(/(\d{1,3}):(\d{2})(?::(\d{2}))?/);
  if (colon) return +colon[1] * 60 + +colon[2] + (colon[3] ? +colon[3] / 60 : 0);
  const hm = s.match(/(\d+)\s*h\s*(\d{1,2})(?!\s*(?:s\b|sec|[.\d]))/);
  let total = 0;
  let found = false;
  let rest = s;
  if (hm && !/\d+\s*h\s*\d{1,2}\s*m/.test(s)) {
    total += +hm[1] * 60 + +hm[2];
    found = true;
    rest = s.replace(hm[0], ' ');
  }
  const re = /(\d+(?:\.\d+)?)\s*(jours?|j\b|days?|d\b|heures?|hours?|hrs?|h\b|minutes?|mins?|mn|m\b|secondes?|seconds?|secs?|s\b)/g;
  let m;
  while ((m = re.exec(rest))) {
    const v = +m[1];
    const u = m[2];
    found = true;
    if (/^(j|d)/.test(u)) total += v * 1440;
    else if (/^h/.test(u)) total += v * 60;
    else if (/^(m|mn)/.test(u)) total += v;
    else total += v / 60;
  }
  return found ? total : NaN;
}

function parseBambuSliceInfo(xml) {
  const plates = [];
  const plateRe = /<plate>([\s\S]*?)<\/plate>/g;
  let pm;
  while ((pm = plateRe.exec(String(xml || '')))) {
    const body = pm[1];
    const meta = {};
    const metaRe = /<metadata\s+([^>]*?)\/?>/g;
    let mm;
    while ((mm = metaRe.exec(body))) {
      const a = parseAttrs(mm[1]);
      if (a.key !== undefined) meta[a.key] = a.value;
    }
    const objects = [];
    const objRe = /<object\s+([^>]*?)\/?>/g;
    let om;
    while ((om = objRe.exec(body))) {
      const a = parseAttrs(om[1]);
      objects.push({ name: a.name || '', skipped: a.skipped === 'true' });
    }
    const filaments = [];
    const filRe = /<filament\s+([^>]*?)\/?>/g;
    let fm;
    while ((fm = filRe.exec(body))) {
      const a = parseAttrs(fm[1]);
      const usedG = parseFloat(a.used_g);
      if (!Number.isFinite(usedG) || usedG <= 0) continue;
      filaments.push({ id: +a.id || filaments.length + 1, type: normalizeMaterial(a.type), rawType: a.type || '', color: safeHex(a.color, '#FFFFFF'), grams: usedG, meters: parseFloat(a.used_m) || 0 });
    }
    const sec = parseFloat(meta.prediction);
    plates.push({
      index: parseInt(meta.index, 10) || plates.length + 1,
      timeMin: Number.isFinite(sec) ? sec / 60 : NaN,
      weightG: parseFloat(meta.weight),
      objects: objects.filter((o) => !o.skipped),
      filaments,
    });
  }
  return plates;
}

function splitNumbers(s) {
  return String(s || '').split(/[,;]/).map((x) => parseFloat(x.trim())).filter((x) => Number.isFinite(x));
}

function parseGcodeText(text) {
  const t = String(text || '');
  const out = { source: 'gcode', name: '', timeMin: NaN, filaments: [], purgeG: 0, pieces: NaN, warnings: [] };
  let m;
  if ((m = t.match(/;\s*total estimated time:\s*([^\n;]+)/i))) out.timeMin = parseDurationToMin(m[1]);
  else if ((m = t.match(/;\s*estimated printing time \(normal mode\)\s*=\s*([^\n]+)/i))) out.timeMin = parseDurationToMin(m[1]);
  else if ((m = t.match(/;\s*model printing time:\s*([^\n;]+)/i))) out.timeMin = parseDurationToMin(m[1]);
  else if ((m = t.match(/;PRINT\.TIME:(\d+)/))) out.timeMin = +m[1] / 60;

  let weights = [];
  if ((m = t.match(/;\s*total filament weight \[g\]\s*:\s*([^\n]+)/i))) weights = splitNumbers(m[1]);
  else if ((m = t.match(/;\s*filament used \[g\]\s*=\s*([^\n]+)/i))) weights = splitNumbers(m[1]);
  const colors = (t.match(/;\s*filament_colou?r\s*=\s*([^\n]+)/i) || [])[1];
  const types = (t.match(/;\s*filament_type\s*=\s*([^\n]+)/i) || [])[1];
  const colorList = colors ? colors.split(/[;,]/).map((c) => c.trim().replace(/"/g, '')) : [];
  const typeList = types ? types.split(/[;,]/).map((c) => c.trim().replace(/"/g, '')) : [];
  const exact = colorList.length === weights.length;
  weights.forEach((g, i) => {
    if (g <= 0) return;
    out.filaments.push({ id: i + 1, type: normalizeMaterial(exact ? typeList[i] : typeList[0]), color: safeHex(exact ? colorList[i] : '', '#FFFFFF'), grams: g });
  });
  if (weights.length > 1 && !exact) out.warnings.push('Couleurs à vérifier : le fichier ne dit pas quelle couleur correspond à quel poids.');
  if ((m = t.match(/;\s*total filament used for wipe tower \[g\]\s*=\s*([\d.]+)/i))) {
    const wipe = parseFloat(m[1]);
    if (wipe > 0) out.purgeG = wipe;
  }
  if (!out.filaments.length && (m = t.match(/;\s*total filament used \[g\]\s*=\s*([\d.]+)/i))) {
    out.filaments.push({ id: 1, type: normalizeMaterial(typeList[0]), color: safeHex(colorList[0], '#FFFFFF'), grams: parseFloat(m[1]) });
  }
  if (!out.filaments.length && /;Filament used:\s*[\d.]+m/i.test(t)) out.warnings.push('Ce G-code donne le filament en mètres, pas en grammes : indique le poids à la main.');
  return out;
}

function parseSlicerText(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (/<plate>[\s\S]*<filament/i.test(t)) return fromPlates(parseBambuSliceInfo(t), 'text');
  if (/;\s*(HEADER_BLOCK_START|total filament weight|estimated printing time|filament used \[g\]|model printing time)/i.test(t)) return parseGcodeText(t);

  const out = { source: 'text', name: '', timeMin: NaN, filaments: [], purgeG: 0, pieces: NaN, warnings: [] };
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const gramsIn = (l) => {
    const m = l.replace(/(\d),(\d)/g, '$1.$2').match(/(\d+(?:\.\d+)?)\s*(kg|g)\b/i);
    return m ? +m[1] * (m[2].toLowerCase() === 'kg' ? 1000 : 1) : NaN;
  };
  let totalG = NaN;
  for (const l of lines) {
    const kv = l.match(/^([^:=]{2,40})\s*[:=]\s*(.+)$/);
    const key = kv ? normalizeText(kv[1]) : '';
    const val = kv ? kv[2] : l;
    if (kv && /^(nom|name|modele|model|objet|object|produit|piece|titre|title|fichier|file)\b/.test(key) && !out.name) {
      out.name = val.replace(/\.(gcode\.3mf|3mf|gcode|stl)$/i, '').trim();
      continue;
    }
    if (/\b(purge|flush|flushed|tour|tower|prime|wipe|rincage)\b/.test(normalizeText(l))) {
      const g = gramsIn(val);
      if (Number.isFinite(g)) out.purgeG += g;
      continue;
    }
    if (/(temps|time|duree|duration|impression|print|estim)/.test(normalizeText(key || l)) && !/(poids|weight|filament|g\b)/.test(normalizeText(key))) {
      const d = parseDurationToMin(val);
      if (Number.isFinite(d) && d > 0 && !Number.isFinite(out.timeMin)) {
        out.timeMin = d;
        continue;
      }
    }
    if (/(pieces?|objets?|quantite|copies|instances|exemplaires)/.test(normalizeText(key || l))) {
      const n = parseInt(val.replace(/\D+/g, ' ').trim().split(' ')[0], 10);
      if (n > 0) {
        out.pieces = n;
        continue;
      }
    }
    const g = gramsIn(l);
    if (Number.isFinite(g)) {
      const hex = (l.match(/#[0-9a-f]{6}\b/i) || [])[0];
      const type = (l.match(/\b(PLA[\w-]*|PETG[\w-]*|ABS|ASA|TPU|PA\w*|PC|PVA)\b/i) || [])[0];
      if (/\btotal\b/i.test(l)) totalG = g;
      else out.filaments.push({ id: out.filaments.length + 1, type: normalizeMaterial(type), color: safeHex(hex, '#FFFFFF'), grams: g });
      continue;
    }
    if (!out.name && /[a-zà-ÿ]{3}/i.test(l) && !/\d+\s*(g|h|min)\b/i.test(l)) out.name = l.slice(0, 120);
  }
  if (!Number.isFinite(out.timeMin)) {
    const d = parseDurationToMin(t);
    if (Number.isFinite(d) && d > 0) out.timeMin = d;
  }
  if (!out.filaments.length && Number.isFinite(totalG)) out.filaments.push({ id: 1, type: 'PLA', color: '#FFFFFF', grams: totalG });
  return out;
}

function fromPlates(plates, source) {
  const usable = plates.filter((p) => p.filaments.length || Number.isFinite(p.timeMin));
  if (!usable.length) return null;
  const p = usable[0];
  return {
    source,
    name: '',
    timeMin: p.timeMin,
    filaments: p.filaments,
    purgeG: 0,
    purgeIncluded: true,
    pieces: p.objects.length || NaN,
    objectNames: p.objects.map((o) => o.name),
    plates: usable,
    plateIndex: p.index,
    warnings: [],
  };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((s) => s.src === src)) return resolve();
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('Impossible de charger le module de lecture des fichiers (réseau ?).'));
    document.head.appendChild(el);
  });
}

async function readHeadTail(file, bytes = 262144) {
  if (file.size <= bytes * 2) return file.text();
  const head = await file.slice(0, bytes).text();
  const tail = await file.slice(file.size - bytes).text();
  return `${head}\n${tail}`;
}

async function blobToThumb(blob, size = 256) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, size / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const webp = c.toDataURL('image/webp', 0.82);
    return webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/jpeg', 0.82);
  } catch {
    return null;
  }
}

async function parseSlicerFile(file) {
  const baseName = file.name.replace(/\.(gcode\.3mf|3mf|gcode|gco|g)$/i, '').replace(/[_]+/g, ' ').trim();
  if (/\.3mf$/i.test(file.name)) {
    if (!globalThis.JSZip) await loadScript(JSZIP_URL);
    let zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch {
      throw new Error("Ce fichier .3mf est illisible (fichier abîmé ou incomplet).");
    }
    let result = null;
    const info = zip.file(/^Metadata\/slice_info\.config$/i)[0];
    if (info) result = fromPlates(parseBambuSliceInfo(await info.async('string')), '3mf');
    if (!result || !result.filaments.length) {
      const gcodeFile = zip.file(/^Metadata\/plate_\d+\.gcode$/i)[0];
      if (gcodeFile) {
        const g = parseGcodeText(await gcodeFile.async('string'));
        if (g.filaments.length) result = { ...g, source: '3mf' };
      }
    }
    if (!result || !result.filaments.length) {
      throw new Error('Ce .3mf ne contient pas de résultat de découpe. Dans Bambu Studio : « Découper la plaque », puis « Exporter le fichier de plaque découpée » (.gcode.3mf).');
    }
    const model = zip.file(/^3D\/3dmodel\.model$/i)[0];
    if (model) {
      const head = (await model.async('string')).slice(0, 20000);
      const title = head.match(/<metadata\s+name="Title"\s*>([^<]*)<\/metadata>/i);
      if (title && title[1].trim()) result.name = decodeXml(title[1].trim());
    }
    if (!result.name) {
      const names = [...new Set((result.objectNames || []).map((n) => n.replace(/\.(stl|3mf|step|obj)$/i, '').trim()).filter(Boolean))];
      result.name = names.length === 1 ? names[0] : baseName;
    }
    result.thumbnails = {};
    for (const p of result.plates || [{ index: 1 }]) {
      const png = zip.file(`Metadata/plate_${p.index}.png`) || zip.file(`Metadata/plate_${p.index}_small.png`);
      if (png) result.thumbnails[p.index] = await blobToThumb(await png.async('blob'));
    }
    return result;
  }
  if (/\.(gcode|gco|g)$/i.test(file.name)) {
    const res = parseGcodeText(await readHeadTail(file));
    res.name = res.name || baseName;
    if (!res.filaments.length && !Number.isFinite(res.timeMin)) throw new Error('Aucune information de découpe trouvée dans ce G-code.');
    return res;
  }
  throw new Error('Format non reconnu : utilise un fichier .gcode.3mf, .3mf ou .gcode.');
}

// Transforme un résultat d'import en valeurs de template PAR PIÈCE
function importToTemplate(V, res, { pieces = 1, plateIndex } = {}) {
  let src = res;
  if (res.plates && plateIndex && plateIndex !== res.plateIndex) {
    const p = res.plates.find((x) => x.index === plateIndex);
    if (p) src = { ...res, timeMin: p.timeMin, filaments: p.filaments, plateIndex: p.index };
  }
  const n = Math.max(1, Math.round(toNum(pieces, 1)));
  const materials = (src.filaments || []).map((f) => {
    const line = { material: f.type || 'PLA', color_name: '', color_hex: safeHex(f.color, '#FFFFFF'), grams: roundDb(f.grams / n, 2), spool_id: null };
    const best = candidateSpools(V, line, { needGrams: 0 }).find((c) => c.dist < 60);
    if (best) {
      line.spool_id = best.spool.id;
      line.color_name = best.spool.color_name;
    }
    return line;
  });
  return {
    name: (src.name || '').slice(0, 120),
    materials,
    purge_g: roundDb(toNum(src.purgeG) / n, 2),
    print_time_min: Number.isFinite(src.timeMin) ? roundDb(src.timeMin / n, 2) : null,
    pieces_per_print: n,
    photo: res.thumbnails ? res.thumbnails[src.plateIndex || 1] || null : null,
  };
}
