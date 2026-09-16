// Génère les icônes de l'application (PWA, iPhone, onglet) à partir du logo Paulo3D.
// Usage : node tools/icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'icons');
fs.mkdirSync(OUT, { recursive: true });

const P_PATH = 'M34 22H66C84 22 94 34 94 50C94 66 84 78 66 78H56V98H34ZM56 40V60H65C71 60 74 56 74 50C74 44 71 40 65 40Z';

function layers() {
  const out = [];
  for (let i = 0; i < 11; i++) {
    const y = 22 + i * 7;
    const fill = i < 3 ? '#223244' : i === 3 ? '#22D3EE' : '#22F2A0';
    out.push(`<rect x="30" y="${y}" width="70" height="${i === 10 ? 6 : 5}" fill="${fill}"/>`);
  }
  return out.join('');
}

// Le « P » tient dans la boîte 22..104 × 22..98 (centre ≈ 63, 60) : on le recentre et on l'agrandit
function mark(scale) {
  const cx = 63;
  const cy = 60;
  return `<g transform="translate(60 60) scale(${scale}) translate(${-cx} ${-cy})">
    <defs><clipPath id="p"><path clip-rule="evenodd" d="${P_PATH}"/></clipPath></defs>
    <g clip-path="url(#p)">${layers()}</g>
    <line x1="22" y1="45.5" x2="30" y2="45.5" stroke="#22D3EE" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="98" y1="45.5" x2="104" y2="45.5" stroke="#22D3EE" stroke-width="1.5" stroke-linecap="round"/>
  </g>`;
}

const glow = '<defs><radialGradient id="g" cx="50%" cy="38%" r="60%"><stop offset="0" stop-color="#22F2A0" stop-opacity=".16"/><stop offset="1" stop-color="#22F2A0" stop-opacity="0"/></radialGradient></defs>';

const tile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${glow}
  <rect x="1" y="1" width="118" height="118" rx="27" fill="#0F151C" stroke="#243244" stroke-width="1.5"/>
  <rect x="1" y="1" width="118" height="118" rx="27" fill="url(#g)"/>
  ${mark(1)}</svg>`;

const fullBleed = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${glow}
  <rect width="120" height="120" fill="#0A0E13"/><rect width="120" height="120" fill="url(#g)"/>
  ${mark(scale)}</svg>`;

async function png(svg, size, file) {
  await sharp(Buffer.from(svg), { density: Math.ceil((72 * size) / 120) * 2 }).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(OUT, file));
}

fs.writeFileSync(path.join(OUT, 'favicon.svg'), tile);
await png(tile, 32, 'favicon-32.png');
await png(tile, 192, 'icon-192.png');
await png(tile, 512, 'icon-512.png');
await png(fullBleed(0.78), 512, 'icon-maskable-512.png');
await png(fullBleed(0.9), 180, 'apple-touch-icon.png');
console.log('✔ icônes générées dans src/icons/');
