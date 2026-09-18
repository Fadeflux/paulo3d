/* =============================================================================
   PDF fait maison, sans bibliothèque : texte (Helvetica), traits, rectangles,
   cercles et QR codes, sur des pages A4.
   Pourquoi : sur iPhone, dans l'appli installée sur l'écran d'accueil,
   window.print() ne fait RIEN. Un vrai fichier PDF passe par la feuille de
   partage (Imprimer, Enregistrer dans Fichiers, WhatsApp…) et marche hors-ligne.
   Coordonnées : en points (1/72 de pouce), depuis le HAUT à gauche de la page.
   ============================================================================= */

const MM = 72 / 25.4;
const A4_W = 595.28;
const A4_H = 841.89;

// Largeurs des polices standard Helvetica et Helvetica-Bold (millièmes du corps), caractères 32 à 126
const HELV_W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556,
  333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELV_B = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611,
  389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
// Caractères 128 à 255 qui ne sont pas des lettres accentuées : [normal, gras]
const HELV_HIGH = {
  0x80: [556, 556], 0x82: [222, 278], 0x83: [556, 556], 0x84: [333, 500], 0x85: [1000, 1000], 0x86: [556, 556], 0x87: [556, 556], 0x88: [333, 333],
  0x89: [1000, 1000], 0x8b: [333, 333], 0x8c: [1000, 1000], 0x91: [222, 278], 0x92: [222, 278], 0x93: [333, 500], 0x94: [333, 500], 0x95: [350, 350],
  0x96: [556, 556], 0x97: [1000, 1000], 0x98: [333, 333], 0x99: [1000, 1000], 0x9b: [333, 333], 0x9c: [944, 944], 0xa0: [278, 278], 0xa1: [333, 333],
  0xa6: [260, 280], 0xa7: [556, 556], 0xa8: [333, 333], 0xa9: [737, 737], 0xaa: [370, 370], 0xab: [556, 556], 0xac: [584, 584], 0xad: [333, 333],
  0xae: [737, 737], 0xaf: [333, 333], 0xb0: [400, 400], 0xb1: [584, 584], 0xb2: [333, 333], 0xb3: [333, 333], 0xb4: [333, 333], 0xb5: [556, 611],
  0xb6: [537, 556], 0xb7: [278, 278], 0xb8: [333, 333], 0xb9: [333, 333], 0xba: [365, 365], 0xbb: [556, 556], 0xbc: [834, 834], 0xbd: [834, 834],
  0xbe: [834, 834], 0xbf: [611, 611], 0xc6: [1000, 1000], 0xd0: [722, 722], 0xd7: [584, 584], 0xd8: [778, 778], 0xde: [667, 667], 0xdf: [611, 611],
  0xe6: [889, 889], 0xf0: [556, 611], 0xf7: [584, 584], 0xf8: [611, 611], 0xfe: [556, 611],
};
// Caractères hors Latin-1 présents dans l'encodage WinAnsi des polices standard, et équivalents
const WIN_ANSI = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
  // espaces fines (séparateur des milliers en français : « 1 234,00 € ») et signe moins typographique
  0x202f: 0xa0, 0x2009: 0xa0, 0x2007: 0xa0, 0x2212: 0x2d,
};

// Texte → codes WinAnsi ; ce que les polices standard ne savent pas écrire (émojis…) devient « ? »
function pdfChars(str) {
  const out = [];
  for (const ch of String(str ?? '').normalize('NFC')) {
    const cp = ch.codePointAt(0);
    let b;
    if (cp >= 32 && cp < 127) b = cp;
    else if (cp >= 0xa0 && cp <= 0xff) b = cp;
    else if (WIN_ANSI[cp] !== undefined) b = WIN_ANSI[cp];
    else if (cp === 9 || cp === 10 || cp === 13) b = 32;
    else if (/[\p{M}\p{Cf}]/u.test(ch)) continue; // accent isolé, sélecteur de variante d'émoji, jointure
    else b = 63;
    out.push({ b, ch });
  }
  return out;
}

function pdfCharWidth(c, bold) {
  const { b } = c;
  if (b < 127) return (bold ? HELV_B : HELV_W)[b - 32] || 556;
  if (HELV_HIGH[b]) return HELV_HIGH[b][bold ? 1 : 0];
  const base = c.ch.normalize('NFD').charCodeAt(0); // lettre accentuée : largeur de la lettre de base
  return base >= 32 && base < 127 ? (bold ? HELV_B : HELV_W)[base - 32] : 556;
}

const pdfWidth = (str, size = 10, bold = false) => (pdfChars(str).reduce((w, c) => w + pdfCharWidth(c, bold), 0) * size) / 1000;

// Coupe le texte avec « … » pour qu'il tienne dans la largeur
function pdfFit(str, maxWidth, size = 10, bold = false) {
  const s = String(str ?? '');
  if (!(maxWidth > 0) || pdfWidth(s, size, bold) <= maxWidth) return s;
  const chars = [...s];
  const cut = (n) => `${chars.slice(0, n).join('').trimEnd()}…`;
  // plus long début qui tient avec « … » (recherche par moitiés)
  let lo = 0;
  let hi = chars.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (pdfWidth(cut(mid), size, bold) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  if (lo > 0) return cut(lo);
  return pdfWidth('…', size, bold) <= maxWidth ? '…' : '';
}

// Découpe en lignes (au plus maxLines, la dernière finit par « … » si le texte déborde)
function pdfWrap(str, maxWidth, size = 10, bold = false, maxLines = 99) {
  const lines = [];
  let cur = '';
  // typographie française : « guillemets » et : ; ! ? restent collés à leur mot (espace insécable)
  // (espaces ordinaires seulement : \s avalerait aussi les insécables des montants « 1 234,56 € »)
  const text = String(str ?? '').replace(/[ \t\r\n\f\v]+/g, ' ').replace(/^ | $/g, '').replace(/« /g, '«\u00a0').replace(/ ([»:;!?])/g, '\u00a0$1');
  for (const word of text.split(' ')) {
    const cand = cur ? `${cur} ${word}` : word;
    if (pdfWidth(cand, size, bold) <= maxWidth) {
      cur = cand;
      continue;
    }
    if (cur) lines.push(cur);
    // mot plus long que la ligne : coupé net (au moins un caractère par ligne, donc la boucle finit)
    let chars = [...word];
    while (chars.length > 1 && pdfWidth(chars.join(''), size, bold) > maxWidth) {
      let n = chars.length - 1;
      while (n > 1 && pdfWidth(chars.slice(0, n).join(''), size, bold) > maxWidth) n--;
      lines.push(chars.slice(0, n).join(''));
      chars = chars.slice(n);
    }
    cur = chars.join('');
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines.length ? lines : [''];
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = pdfFit(`${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`, maxWidth, size, bold);
  return kept;
}

// Chaîne PDF en ASCII pur : parenthèses et barre oblique échappées, le reste en octal
const pdfString = (chars) => chars.map(({ b }) => (b === 0x28 || b === 0x29 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b < 32 || b > 126 ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b))).join('');

// Métadonnées (titre) : UTF-16 en hexadécimal, lisible par tous les lecteurs
const pdfHexText = (str) => `<FEFF${[...String(str ?? '')].map((ch) => {
  const cp = ch.codePointAt(0);
  const units = cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp];
  return units.map((u) => u.toString(16).toUpperCase().padStart(4, '0')).join('');
}).join('')}>`;

const pdfNum = (v) => {
  const r = Math.round(toNum(v) * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};
function pdfRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => String(Math.round((c / 255) * 1000) / 1000)).join(' ');
}

function pdfDocument(title = '') {
  const pages = [];
  let ops = null;
  const H = A4_H;
  const K = 0.5523; // arcs de cercle en courbes de Bézier
  const style = ({ fill = null, stroke = null, width = 0.5, dash = null }) => [
    fill ? `${pdfRgb(fill)} rg` : '',
    stroke ? `${pdfRgb(stroke)} RG ${pdfNum(width)} w` : '',
    stroke && dash ? `[${dash.map(pdfNum).join(' ')}] 0 d` : '',
  ].filter(Boolean).join(' ');
  const paint = ({ fill, stroke }) => (fill && stroke ? 'B' : fill ? 'f' : 'S');

  const doc = {
    W: A4_W,
    H: A4_H,
    get pageCount() {
      return pages.length;
    },
    page() {
      ops = [];
      pages.push(ops);
      return doc;
    },
    // revient sur une page déjà faite (numéros de page écrits à la fin)
    usePage(i) {
      ops = pages[i];
      return doc;
    },
    // y = ligne de base du texte ; renvoie la largeur écrite
    text(str, x, y, { size = 10, bold = false, color = '#111827', align = 'left', maxWidth = 0 } = {}) {
      const s = maxWidth ? pdfFit(str, maxWidth, size, bold) : String(str ?? '');
      const chars = pdfChars(s);
      if (!chars.length) return 0;
      const w = (chars.reduce((acc, c) => acc + pdfCharWidth(c, bold), 0) * size) / 1000;
      const tx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
      ops.push(`BT /${bold ? 'F2' : 'F1'} ${pdfNum(size)} Tf ${pdfRgb(color)} rg ${pdfNum(tx)} ${pdfNum(H - y)} Td (${pdfString(chars)}) Tj ET`);
      return w;
    },
    line(x1, y1, x2, y2, { color = '#e5e7eb', width = 0.5, dash = null } = {}) {
      ops.push(`q ${style({ stroke: color, width, dash })} ${pdfNum(x1)} ${pdfNum(H - y1)} m ${pdfNum(x2)} ${pdfNum(H - y2)} l S Q`);
      return doc;
    },
    rect(x, y, w, h, o = {}) {
      const r = Math.min(toNum(o.radius), w / 2, h / 2);
      const x0 = x;
      const y0 = H - y - h;
      const x1 = x + w;
      const y1 = H - y;
      let path;
      if (r > 0) {
        const k = r * K;
        const p = (...v) => v.map(pdfNum).join(' ');
        path = [`${p(x0 + r, y0)} m`, `${p(x1 - r, y0)} l`, `${p(x1 - r + k, y0, x1, y0 + r - k, x1, y0 + r)} c`, `${p(x1, y1 - r)} l`,
          `${p(x1, y1 - r + k, x1 - r + k, y1, x1 - r, y1)} c`, `${p(x0 + r, y1)} l`, `${p(x0 + r - k, y1, x0, y1 - r + k, x0, y1 - r)} c`,
          `${p(x0, y0 + r)} l`, `${p(x0, y0 + r - k, x0 + r - k, y0, x0 + r, y0)} c`, 'h'].join(' ');
      } else {
        path = `${pdfNum(x0)} ${pdfNum(y0)} ${pdfNum(w)} ${pdfNum(h)} re`;
      }
      ops.push(`q ${style(o)} ${path} ${paint(o)} Q`);
      return doc;
    },
    circle(cx, cy, r, o = {}) {
      const y = H - cy;
      const k = r * K;
      const p = (...v) => v.map(pdfNum).join(' ');
      ops.push(`q ${style(o)} ${p(cx + r, y)} m ${p(cx + r, y + k, cx + k, y + r, cx, y + r)} c ${p(cx - k, y + r, cx - r, y + k, cx - r, y)} c ${p(cx - r, y - k, cx - k, y - r, cx, y - r)} c ${p(cx + k, y - r, cx + r, y - k, cx + r, y)} c h ${paint(o)} Q`);
      return doc;
    },
    // QR code (bibliothèque qrcode-generator) : carrés noirs, regroupés par tronçons de ligne
    qr(code, x, y, size) {
      const n = code.getModuleCount();
      const cell = size / n;
      const parts = [];
      for (let r = 0; r < n; r++) {
        let c = 0;
        while (c < n) {
          if (!code.isDark(r, c)) {
            c++;
            continue;
          }
          let e = c;
          while (e < n && code.isDark(r, e)) e++;
          // léger chevauchement vertical : pas de fines lignes blanches entre deux rangées à l'écran
          parts.push(`${pdfNum(x + c * cell)} ${pdfNum(H - y - (r + 1) * cell)} ${pdfNum((e - c) * cell)} ${pdfNum(cell + 0.05)} re`);
          c = e;
        }
      }
      if (parts.length) ops.push(`q 0 0 0 rg\n${parts.join('\n')}\nf Q`);
      return doc;
    },
    // Fichier final (ASCII pur : la longueur en caractères est la longueur en octets)
    output() {
      if (!pages.length) doc.page();
      const objs = [];
      const add = (body) => objs.push(body);
      const catalog = add(null);
      const tree = add(null);
      const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      const d = new Date();
      const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
      const info = add(`<< /Title ${pdfHexText(title)} /Producer (Paulo3D) /CreationDate (D:${stamp}) >>`);
      const kids = pages.map((p) => {
        const stream = p.join('\n');
        const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
        return add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${pdfNum(A4_W)} ${pdfNum(A4_H)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`);
      });
      objs[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
      objs[tree - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
      let out = '%PDF-1.4\n';
      const offsets = objs.map((body, i) => {
        const at = out.length;
        out += `${i + 1} 0 obj\n${body}\nendobj\n`;
        return at;
      });
      const xref = out.length;
      out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
      out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      return out;
    },
  };
  return doc;
}
