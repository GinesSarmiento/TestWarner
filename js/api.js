/**
 * Acceso al API de Pase Correcaminos y normalización de atracciones.
 *
 * Este es el único archivo que conoce las rarezas del endpoint. Si el API cambia,
 * se toca aquí y el resto de la app sigue funcionando con el modelo interno.
 */

export const API_URL = 'https://pasecorrecaminos.es/api/api/guest/rides';
const HOST = 'https://pasecorrecaminos.es';

/** Estados que devuelve el API, traducidos a algo mostrable. */
const STATES = {
  open: { label: 'Abierta', tone: 'open', operating: true },
  full: { label: 'Aforo completo', tone: 'full', operating: true },
  full_and_closed: { label: 'Aforo completo', tone: 'full', operating: false },
  not_operational: { label: 'Cerrada temporalmente', tone: 'down', operating: false },
  closed_indefinitely: { label: 'Cerrada', tone: 'closed', operating: false },
};

/** Orden de menor a mayor intensidad, para poder filtrar y ordenar. */
export const INTENSITIES = ['Suave', 'Baja', 'Media', 'Alta', 'MAX'];

/** El API escribe mal el nombre de alguna zona. */
const LAND_FIXES = {
  'Movie World Studiose': 'Movie World Studios',
};

export const STATE_FILTERS = [
  { key: 'open', label: 'Abierta', states: ['open'] },
  { key: 'full', label: 'Aforo completo', states: ['full', 'full_and_closed'] },
  { key: 'down', label: 'Cerrada temporalmente', states: ['not_operational'] },
  { key: 'closed', label: 'Cerrada', states: ['closed_indefinitely'] },
];

/**
 * Descarga las atracciones. Llamada directa: si el navegador la bloquea por CORS
 * el error se propaga para que la UI lo cuente en lugar de quedarse en blanco.
 */
export async function fetchRides({ timeout = 15000, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const res = await fetch(API_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
    const raw = await res.json();
    if (!Array.isArray(raw)) throw new Error('Respuesta inesperada del servidor');
    return { rides: raw.map(normalizeRide), fetchedAt: Date.now(), raw };
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ntilde: 'ñ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', uuml: 'ü',
};

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function collapse(text) {
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

/** Quita CSS, iconos y etiquetas: nunca inyectamos el HTML del API en el DOM. */
function toPlainText(html) {
  return collapse(String(html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' '));
}

/**
 * La zona del parque va dentro de la descripción, detrás de un icono
 * `location_on`. Sólo la traen las atracciones "principales".
 */
function extractLand(html) {
  const match = /location_on\s*<\/i>\s*([^<]+)/i.exec(html || '');
  if (!match) return null;
  const land = collapse(match[1]);
  return LAND_FIXES[land] || land || null;
}

/** Pares `<h>ETIQUETA</h><p>valor</p>`: ALTURA MIN y SENSACIÓN. */
function extractFacts(html) {
  const facts = {};
  const re = /<h>\s*([^<]+?)\s*<\/h>\s*<p>\s*([^<]*?)\s*<\/p>/gi;
  let m;
  while ((m = re.exec(html || ''))) facts[collapse(m[1]).toUpperCase()] = collapse(m[2]);
  return facts;
}

/** Pares `<span>ETIQUETA</span><p>valor</p>`: detalles de reservas, acompañantes, etc. */
function extractDetails(html) {
  const out = [];
  const re = /<span[^>]*>\s*([^<]{3,60}?)\s*<\/span>\s*<p[^>]*>\s*([^<]{1,60}?)\s*<\/p>/gi;
  let m;
  while ((m = re.exec(html || ''))) {
    const label = collapse(m[1]);
    const value = collapse(m[2]);
    // Sólo etiquetas con pinta de etiqueta (en mayúsculas), no frases sueltas.
    if (value && label === label.toUpperCase() && !/[.:]$/.test(label)) {
      out.push({ label, value });
    }
  }
  return out;
}

function matchIntensity(value) {
  if (!value) return null;
  const norm = value.trim().toLowerCase();
  return INTENSITIES.find((level) => level.toLowerCase() === norm) || null;
}

function pickImage(imageDetails, type) {
  const found = (imageDetails || []).find((img) => img && img.type === type && img.url);
  return found ? found.url : null;
}

/** Las restricciones visibles: texto libre del parque, se muestra tal cual. */
function extractRestrictions(info) {
  if (!info || typeof info !== 'object') return [];
  return Object.entries(info)
    .filter(([key, value]) => key.startsWith('visible.restrictions.') && String(value || '').trim())
    .map(([, value]) => collapse(String(value)));
}

/** Coordenadas: el API las entrega cruzadas (`longitude` trae la latitud). */
function extractLocation(location) {
  const lat = location ? location.longitude : null;
  const lng = location ? location.latitude : null;
  const valid = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
  return { lat: valid ? lat : null, lng: valid ? lng : null, hasLocation: valid };
}

/** Párrafos legibles, sin los valores que ya mostramos como datos sueltos. */
function extractParagraphs(html, taken) {
  // Fuera el CSS y el icono `location_on`: la zona ya se muestra aparte.
  const clean = String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<i[^>]*>[\s\S]*?<\/i>/gi, '');
  const seen = new Set(taken.map((t) => t.toLowerCase()));
  const out = [];
  for (const chunk of clean.split(/<\/?(?:p|br|div|h)[^>]*>/i)) {
    const text = toPlainText(chunk);
    if (text.length < 12) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function normalizeRide(raw) {
  const html = raw.description || '';
  const facts = extractFacts(html);
  const details = extractDetails(html);
  const land = extractLand(html);
  const state = STATES[raw.state] || { label: raw.state || 'Desconocido', tone: 'closed', operating: false };
  const intensity = matchIntensity(facts['SENSACIÓN'] || facts['SENSACION']);
  const heightMatch = /(\d+)\s*cm/i.exec(facts['ALTURA MIN'] || '');
  const name = String(raw.name || 'Sin nombre').trim();
  const isHSN = /^\[HSN\]/i.test(name);

  // El tiempo de espera sólo es real cuando la atracción está operando: las
  // cerradas conservan el último valor residual (5 min) y engañaría verlo.
  const waitIsReal = state.operating && Number.isFinite(raw.waitTimeMins);
  const { lat, lng, hasLocation } = extractLocation(raw.location);

  const taken = [land, facts['ALTURA MIN'], facts['SENSACIÓN']].filter(Boolean)
    .concat(details.flatMap((d) => [d.label, d.value]));

  return {
    id: raw.id,
    shortId: raw.shortId,
    name,
    cleanName: name.replace(/^\[HSN\]\s*/i, '').trim(),
    isHSN,
    land: land || 'Sin zona indicada',
    hasLand: Boolean(land),
    state: raw.state,
    statusLabel: state.label,
    tone: state.tone,
    isOperating: state.operating,
    waitMinutes: waitIsReal ? Math.round(raw.waitTimeMins) : null,
    waitIsReal,
    minWaitMins: Number.isFinite(raw.minWait) ? Math.round(raw.minWait / 60) : null,
    throughput: Number.isFinite(raw.throughput) ? Math.round(raw.throughput) : null,
    lat,
    lng,
    hasLocation,
    intensity,
    intensityRank: intensity ? INTENSITIES.indexOf(intensity) + 1 : 0,
    minHeightCm: heightMatch ? Number(heightMatch[1]) : null,
    restrictions: extractRestrictions(raw.info),
    details,
    paragraphs: extractParagraphs(html, taken),
    thumbUrl: pickImage(raw.imageDetails, 'thumbnail'),
    bannerUrl: pickImage(raw.imageDetails, 'qsmart_banner'),
    updatedAt: raw.queueLengthLastModified ? Date.parse(raw.queueLengthLastModified) : null,
    closedAt: raw.closedAt ? Date.parse(raw.closedAt) : null,
    upgradeAvailable: Boolean(raw.upgradeAvailable),
    maxReservationSize: raw.maxReservationSize ?? null,
    imageBase: HOST,
  };
}
