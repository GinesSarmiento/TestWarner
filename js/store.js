/** Estado persistente en localStorage: favoritos, montadas, filtros y caché. */

const KEY = 'warner-tracker-v1';

const DEFAULTS = {
  favourites: [],
  ridden: [],
  alertThreshold: 20,
  alertsEnabled: false,
  filters: {
    text: '',
    intensities: [],
    states: ['open', 'full'],
    lands: [],
    maxWait: null,
    onlyFavourites: false,
    hideRidden: false,
    hideHSN: false,
    sort: 'wait',
  },
};

function read() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...stored, filters: { ...DEFAULTS.filters, ...(stored.filters || {}) } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

let state = read();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* modo privado o cuota llena: la app sigue funcionando en memoria */
  }
}

export const store = {
  get filters() {
    return state.filters;
  },
  get alertThreshold() {
    return state.alertThreshold;
  },
  get alertsEnabled() {
    return state.alertsEnabled;
  },
  setFilters(patch) {
    state.filters = { ...state.filters, ...patch };
    persist();
    return state.filters;
  },
  resetFilters() {
    state.filters = structuredClone(DEFAULTS.filters);
    persist();
    return state.filters;
  },
  setAlerts(enabled, threshold) {
    state.alertsEnabled = enabled;
    if (Number.isFinite(threshold)) state.alertThreshold = threshold;
    persist();
  },
  isFavourite: (id) => state.favourites.includes(id),
  toggleFavourite(id) {
    state.favourites = state.favourites.includes(id)
      ? state.favourites.filter((x) => x !== id)
      : [...state.favourites, id];
    persist();
    return state.favourites.includes(id);
  },
  get favourites() {
    return state.favourites;
  },
  isRidden: (id) => state.ridden.includes(id),
  toggleRidden(id) {
    state.ridden = state.ridden.includes(id)
      ? state.ridden.filter((x) => x !== id)
      : [...state.ridden, id];
    persist();
    return state.ridden.includes(id);
  },
  get ridden() {
    return state.ridden;
  },
  clearRidden() {
    state.ridden = [];
    persist();
  },
};

/** Última respuesta guardada, para arrancar con datos aunque no haya cobertura. */
const CACHE_KEY = 'warner-tracker-cache-v1';

export function saveCache(raw, fetchedAt) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ raw, fetchedAt }));
  } catch {
    /* la caché es un extra: si no cabe, seguimos */
  }
}

export function loadCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return cached && Array.isArray(cached.raw) ? cached : null;
  } catch {
    return null;
  }
}
