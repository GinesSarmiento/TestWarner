/**
 * Valida el normalizador contra una respuesta real del API guardada en
 * dev/sample-rides.json.  Ejecutar con:  node dev/test-normalize.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeRide, INTENSITIES } from '../js/api.js';

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(here, 'sample-rides.json'), 'utf8'));
const rides = raw.map(normalizeRide);

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}: ${actual}${ok ? '' : ` (esperado ${expected})`}`);
}

check('atracciones', rides.length, 49);
check('abiertas', rides.filter((r) => r.state === 'open').length, 19);
check('con coordenadas', rides.filter((r) => r.hasLocation).length, 35);
check('con intensidad', rides.filter((r) => r.intensity).length, 24);
check('con zona', rides.filter((r) => r.hasLand).length, 24);
check('con altura mínima', rides.filter((r) => r.minHeightCm).length, 18);
check('variantes [HSN]', rides.filter((r) => r.isHSN).length, 8);
check('sin cola real cuando no operan',
  rides.filter((r) => !r.isOperating && r.waitMinutes !== null).length, 0);

// Las coordenadas deben caer sobre el parque (San Martín de la Vega).
const located = rides.filter((r) => r.hasLocation);
const inPark = located.every((r) => r.lat > 40.1 && r.lat < 40.3 && r.lng > -3.7 && r.lng < -3.5);
check('coordenadas dentro del parque', inPark, true);

// Zonas e intensidades reconocidas.
const badIntensity = rides.filter((r) => r.intensity && !INTENSITIES.includes(r.intensity));
check('intensidades reconocidas', badIntensity.length, 0);
check('typo de zona corregido', rides.some((r) => r.land === 'Movie World Studiose'), false);

const enigma = rides.find((r) => r.name.includes('ENIGMA'));
check('ficha de ejemplo: zona', enigma.land, 'DC Super Heroes World (Gotham City)');
check('ficha de ejemplo: intensidad', enigma.intensity, 'MAX');
check('ficha de ejemplo: altura', enigma.minHeightCm, 132);
check('ficha de ejemplo: cola', enigma.waitMinutes, 20);
check('ficha de ejemplo: imagen', typeof enigma.bannerUrl === 'string', true);
check('ficha de ejemplo: sin HTML en el texto',
  enigma.paragraphs.every((p) => !p.includes('<')), true);

console.log(`\nZonas: ${[...new Set(rides.map((r) => r.land))].join(' · ')}`);
console.log(failures ? `\n${failures} comprobaciones fallidas` : '\nTodo correcto');
process.exit(failures ? 1 : 0);
