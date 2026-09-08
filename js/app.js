/** Orquestación de la app: datos, filtros y render de las tres vistas. */

import { fetchRides, normalizeRide, INTENSITIES, STATE_FILTERS } from './api.js';
import { store, saveCache, loadCache } from './store.js';
import * as geo from './geo.js';
import * as mapView from './map.js';
import * as notify from './notify.js';

const REFRESH_MS = 60000;

const SORTS = [
  { key: 'wait', label: 'Cola' },
  { key: 'best', label: 'Mejor ahora' },
  { key: 'distance', label: 'Distancia' },
  { key: 'name', label: 'Nombre' },
  { key: 'land', label: 'Zona' },
];

const el = (id) => document.getElementById(id);

const app = {
  rides: [],
  fetchedAt: null,
  fromCache: false,
  error: null,
  view: 'list',
  lands: [],
  timer: null,
  loading: false,
  sheet: null,
};

/* ---------------------------------------------------------------- utilidades */

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function fold(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function relativeTime(ts) {
  if (!ts) return null;
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'ahora mismo';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function waitTone(ride) {
  if (!ride.waitIsReal) return 'none';
  if (ride.waitMinutes <= 20) return 'low';
  if (ride.waitMinutes <= 45) return 'mid';
  return 'high';
}

/** Distancia a pie desde la posición actual, o null si no la tenemos. */
function distanceTo(ride) {
  const position = geo.getPosition();
  if (!position || !ride.hasLocation) return null;
  return geo.distanceMeters(position, { lat: ride.lat, lng: ride.lng });
}

function toast(message) {
  const node = el('toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, 4000);
}

/* -------------------------------------------------------------------- datos */

async function load({ silent = false } = {}) {
  if (app.loading) return;
  app.loading = true;
  if (!silent) el('refresh').classList.add('is-spinning');
  try {
    const { rides, fetchedAt, raw } = await fetchRides();
    app.rides = rides;
    app.fetchedAt = fetchedAt;
    app.fromCache = false;
    app.error = null;
    saveCache(raw, fetchedAt);
    const fired = notify.checkThresholds(rides);
    if (fired.length) toast(`${fired.map((r) => r.cleanName).join(', ')}: cola baja`);
  } catch (err) {
    app.error = err;
    if (!app.rides.length) restoreFromCache();
    if (!silent) toast(describeError(err));
  } finally {
    app.loading = false;
    el('refresh').classList.remove('is-spinning');
    render();
  }
}

function describeError(err) {
  if (err && err.name === 'AbortError') return 'El servidor tardó demasiado en responder.';
  // Un fallo de CORS llega como TypeError sin más detalle.
  if (err instanceof TypeError) return 'No se pudo contactar con el servidor (¿sin conexión o bloqueo CORS?).';
  return err && err.message ? err.message : 'Error desconocido al cargar los datos.';
}

function restoreFromCache() {
  const cached = loadCache();
  if (!cached) return;
  app.rides = cached.raw.map(normalizeRide);
  app.fetchedAt = cached.fetchedAt;
  app.fromCache = true;
}

/* ------------------------------------------------------------------ filtros */

function visibleRides() {
  const f = store.filters;
  const needle = fold(f.text);
  const stateKeys = new Set(f.states);
  const allowedStates = new Set(
    STATE_FILTERS.filter((s) => stateKeys.has(s.key)).flatMap((s) => s.states),
  );

  const filtered = app.rides.filter((ride) => {
    if (needle && !fold(`${ride.name} ${ride.land}`).includes(needle)) return false;
    if (f.states.length && !allowedStates.has(ride.state)) return false;
    if (f.intensities.length) {
      const key = ride.intensity || 'sin-dato';
      if (!f.intensities.includes(key)) return false;
    }
    if (f.lands.length && !f.lands.includes(ride.land)) return false;
    if (f.maxWait != null && (!ride.waitIsReal || ride.waitMinutes > f.maxWait)) return false;
    if (f.onlyFavourites && !store.isFavourite(ride.id)) return false;
    if (f.hideRidden && store.isRidden(ride.id)) return false;
    if (f.hideHSN && ride.isHSN) return false;
    return true;
  });

  return sortRides(filtered, f.sort);
}

function sortRides(rides, sort) {
  const withDistance = rides.map((ride) => ({ ride, distance: distanceTo(ride) }));
  const byName = (a, b) => a.ride.cleanName.localeCompare(b.ride.cleanName, 'es');
  const last = Number.POSITIVE_INFINITY;

  const comparators = {
    wait: (a, b) => (a.ride.waitIsReal ? a.ride.waitMinutes : last) - (b.ride.waitIsReal ? b.ride.waitMinutes : last) || byName(a, b),
    distance: (a, b) => (a.distance ?? last) - (b.distance ?? last) || byName(a, b),
    name: byName,
    land: (a, b) => a.ride.land.localeCompare(b.ride.land, 'es') || byName(a, b),
    best: (a, b) => score(a) - score(b) || byName(a, b),
  };

  function score({ ride, distance }) {
    if (!ride.waitIsReal) return last;
    let value = ride.waitMinutes + (geo.walkMinutes(distance) ?? 0) * 1.5;
    // Con el aforo completo no se puede entrar aunque la cola sea corta.
    if (ride.state !== 'open') value += 45;
    if (store.isFavourite(ride.id)) value -= 15;
    if (store.isRidden(ride.id)) value += 60;
    return value;
  }

  return withDistance.sort(comparators[sort] || comparators.wait).map((x) => x.ride);
}

/* ------------------------------------------------------------------- render */

function render() {
  renderSummary();
  renderFilterChips();
  const rides = visibleRides();
  renderList(rides);
  if (app.view === 'map' && mapView.isReady()) {
    mapView.renderRides(rides);
    renderMapNote(rides);
  }
  renderPlan();
}

function renderSummary() {
  const total = app.rides.length;
  if (!total) {
    el('summary').textContent = app.error ? describeError(app.error) : 'Cargando atracciones…';
    return;
  }
  const open = app.rides.filter((r) => r.state === 'open');
  const waits = open.filter((r) => r.waitIsReal).map((r) => r.waitMinutes);
  const avg = waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null;
  const parts = [`${open.length} abiertas de ${total}`];
  if (avg != null) parts.push(`media ${avg} min`);
  const stamp = relativeTime(app.fetchedAt);
  if (stamp) parts.push(app.fromCache ? `datos guardados (${stamp})` : `actualizado ${stamp}`);
  el('summary').textContent = parts.join(' · ');
  el('summary').classList.toggle('is-stale', app.fromCache || Boolean(app.error));
}

function chip(label, active, dataset) {
  const attrs = Object.entries(dataset).map(([k, v]) => `data-${k}="${escapeHtml(v)}"`).join(' ');
  return `<button class="chip${active ? ' is-active' : ''}" type="button" ${attrs}>${escapeHtml(label)}</button>`;
}

function renderFilterChips() {
  const f = store.filters;

  el('filter-states').innerHTML = STATE_FILTERS
    .map((s) => chip(s.label, f.states.includes(s.key), { filter: 'states', value: s.key }))
    .join('');

  const intensityOptions = [...INTENSITIES].reverse().concat('sin-dato');
  el('filter-intensities').innerHTML = intensityOptions
    .map((i) => chip(i === 'sin-dato' ? 'Sin dato' : i, f.intensities.includes(i), { filter: 'intensities', value: i }))
    .join('');

  if (!app.lands.length && app.rides.length) {
    app.lands = [...new Set(app.rides.map((r) => r.land))].sort((a, b) => a.localeCompare(b, 'es'));
  }
  el('filter-lands').innerHTML = app.lands
    .map((land) => chip(land.replace('DC Super Heroes World ', 'DC '), f.lands.includes(land), { filter: 'lands', value: land }))
    .join('');

  el('filter-sort').innerHTML = SORTS
    .map((s) => chip(s.label, f.sort === s.key, { sort: s.key }))
    .join('');

  document.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.classList.toggle('is-active', Boolean(f[btn.dataset.toggle]));
  });

  el('max-wait').value = f.maxWait ?? 0;
  el('max-wait-value').textContent = f.maxWait ? `${f.maxWait} min` : 'sin límite';
  el('search').value = f.text;
}

function rideCard(ride) {
  const distance = distanceTo(ride);
  const meta = [ride.land];
  if (ride.intensity) meta.push(`Sensación ${ride.intensity}`);
  if (ride.minHeightCm) meta.push(`${ride.minHeightCm} cm`);
  if (distance != null) meta.push(`zona a ${geo.formatDistance(distance)} · ${geo.walkMinutes(distance)} min a pie`);

  const wait = ride.waitIsReal
    ? `<b>${ride.waitMinutes}</b><span>min</span>`
    : `<b>—</b><span>${ride.state === 'full' || ride.state === 'full_and_closed' ? 'lleno' : 'cerrada'}</span>`;

  return `
    <article class="card${store.isRidden(ride.id) ? ' is-ridden' : ''}" data-id="${escapeHtml(ride.id)}">
      <button class="card__main" type="button" data-action="detail">
        <span class="card__title">
          ${escapeHtml(ride.cleanName)}
          ${ride.isHSN ? '<em class="tag">HSN</em>' : ''}
        </span>
        <span class="card__meta">${escapeHtml(meta.join(' · '))}</span>
        <span class="badge badge--${ride.tone}">${escapeHtml(ride.statusLabel)}</span>
      </button>
      <div class="card__side">
        <span class="wait wait--${waitTone(ride)}">${wait}</span>
        <div class="card__actions">
          <button class="icon-btn${store.isFavourite(ride.id) ? ' is-on' : ''}" type="button" data-action="fav" aria-label="Favorita">★</button>
          <button class="icon-btn${store.isRidden(ride.id) ? ' is-on' : ''}" type="button" data-action="ridden" aria-label="Ya montada">✓</button>
        </div>
      </div>
    </article>`;
}

function renderList(rides) {
  const container = el('list');
  if (!rides.length) {
    container.innerHTML = `<p class="empty">${app.rides.length
      ? 'Ninguna atracción cumple los filtros.'
      : 'Sin datos todavía.'}</p>`;
    return;
  }
  container.innerHTML = rides.map(rideCard).join('');
}

function renderMapNote(rides) {
  const hidden = rides.filter((r) => !r.hasLocation).length;
  const zones = mapView.groupByZone(rides).length;
  // El API ubica por zonas, no por atracción: conviene decirlo.
  const parts = [`${zones} zonas · toca una para ver sus atracciones.`];
  if (hidden) parts.push(`${hidden} sin ubicación, sólo en la lista.`);
  el('map-note').textContent = parts.join(' ');
}

function renderPlan() {
  const ridden = app.rides.filter((r) => store.isRidden(r.id));
  const pending = app.rides.filter((r) => !store.isRidden(r.id) && r.state === 'open');
  const queueTime = pending.reduce((sum, r) => sum + (r.waitMinutes || 0), 0);
  el('plan-progress').textContent = app.rides.length
    ? `${ridden.length}/${app.rides.length} montadas · ${pending.length} abiertas pendientes · ${Math.round(queueTime / 60)} h de cola acumulada si las haces todas`
    : '—';

  const suggestions = sortRides(pending, 'best').slice(0, 5);
  el('suggestions').innerHTML = suggestions.length
    ? suggestions.map(rideCard).join('')
    : '<p class="empty">Nada abierto ahora mismo.</p>';

  const favourites = app.rides.filter((r) => store.isFavourite(r.id));
  el('favourites').innerHTML = favourites.length
    ? sortRides(favourites, 'wait').map(rideCard).join('')
    : '<p class="empty">Marca atracciones con ★ para seguirlas aquí.</p>';

  el('ridden').innerHTML = ridden.length
    ? ridden.map(rideCard).join('')
    : '<p class="empty">Aún no has marcado ninguna como montada.</p>';
}

/* -------------------------------------------------------------------- ficha */

function detailRow(label, value) {
  return `<div class="detail__row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function openDetail(id) {
  const ride = app.rides.find((r) => r.id === id);
  if (!ride) return;
  const distance = distanceTo(ride);
  const rows = [];
  rows.push(detailRow('Estado', ride.statusLabel));
  if (ride.waitIsReal) rows.push(detailRow('Espera', `${ride.waitMinutes} min`));
  if (ride.intensity) rows.push(detailRow('Sensación', ride.intensity));
  if (ride.minHeightCm) rows.push(detailRow('Altura mínima', `${ride.minHeightCm} cm`));
  if (ride.throughput) rows.push(detailRow('Capacidad', `${ride.throughput} personas/hora`));
  if (distance != null) rows.push(detailRow('Distancia a la zona', `${geo.formatDistance(distance)} (${geo.walkMinutes(distance)} min a pie)`));
  if (ride.closedAt) rows.push(detailRow('Cerrada desde', new Date(ride.closedAt).toLocaleString('es-ES')));
  if (ride.updatedAt) rows.push(detailRow('Cola actualizada', relativeTime(ride.updatedAt)));
  if (ride.upgradeAvailable) rows.push(detailRow('Pase Correcaminos', 'Disponible'));
  ride.details.forEach((d) => rows.push(detailRow(d.label, d.value)));

  app.sheet = { type: 'ride', key: ride.id };
  el('detail').innerHTML = `
    <div class="sheet__inner">
      <div class="sheet__head">
        <h2>${escapeHtml(ride.cleanName)}</h2>
        <button class="icon-btn" type="button" data-action="close" aria-label="Cerrar">✕</button>
      </div>
      <p class="sheet__sub">${escapeHtml(ride.land)}</p>
      ${ride.bannerUrl ? `<img class="sheet__img" src="${escapeHtml(ride.bannerUrl)}" alt="" loading="lazy">` : ''}
      <div class="detail">${rows.join('')}</div>
      ${ride.paragraphs.map((p) => `<p class="sheet__text">${escapeHtml(p)}</p>`).join('')}
      ${ride.restrictions.length
        ? `<h3>Restricciones</h3><ul class="sheet__list">${ride.restrictions.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
        : ''}
      <div class="sheet__actions" data-id="${escapeHtml(ride.id)}">
        <button class="btn${store.isFavourite(ride.id) ? ' is-on' : ''}" type="button" data-action="fav">★ Favorita</button>
        <button class="btn${store.isRidden(ride.id) ? ' is-on' : ''}" type="button" data-action="ridden">✓ Montada</button>
        ${ride.hasLocation ? `<a class="btn" href="${escapeHtml(geo.directionsUrl(ride))}" target="_blank" rel="noopener">➜ Cómo llegar</a>` : ''}
      </div>
    </div>`;
  const banner = el('detail').querySelector('.sheet__img');
  // Si la imagen del parque no carga, mejor quitarla que dejar el hueco.
  if (banner) banner.addEventListener('error', () => banner.remove());
  el('detail').showModal();
}

/** Ficha de una zona: el mapa sólo puede señalar zonas, no atracciones sueltas. */
function openZone(key) {
  const zone = mapView.groupByZone(visibleRides()).find((z) => z.key === key);
  if (!zone) return;
  const position = geo.getPosition();
  const distance = position ? geo.distanceMeters(position, { lat: zone.lat, lng: zone.lng }) : null;
  const rides = sortRides(zone.rides, store.filters.sort);

  app.sheet = { type: 'zone', key: zone.key };
  el('detail').innerHTML = `
    <div class="sheet__inner">
      <div class="sheet__head">
        <h2>${escapeHtml(zone.name)}</h2>
        <button class="icon-btn" type="button" data-action="close" aria-label="Cerrar">✕</button>
      </div>
      <p class="sheet__sub">${escapeHtml(
        [`${zone.rides.length} atracciones`,
          zone.openCount ? `${zone.openCount} abiertas desde ${zone.minWait} min` : 'nada abierto ahora',
          distance != null ? `a ${geo.formatDistance(distance)} (${geo.walkMinutes(distance)} min a pie)` : null,
        ].filter(Boolean).join(' · '))}</p>
      <div class="list list--compact">${rides.map(rideCard).join('')}</div>
      <div class="sheet__actions">
        <a class="btn" href="${escapeHtml(geo.directionsUrl(zone))}" target="_blank" rel="noopener">➜ Cómo llegar a la zona</a>
      </div>
    </div>`;
  el('detail').showModal();
}

/** Repinta la ficha abierta (de atracción o de zona) tras cambiar algo. */
function refreshSheet() {
  if (!app.sheet) return;
  if (app.sheet.type === 'zone') openZone(app.sheet.key);
  else openDetail(app.sheet.key);
}

/* ------------------------------------------------------------------ eventos */

function toggleInArray(list, value) {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

function handleCardAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'close') {
    el('detail').close();
    app.sheet = null;
    return;
  }
  const holder = button.closest('[data-id]');
  if (!holder) return;
  const id = holder.dataset.id;
  if (action === 'detail') openDetail(id);
  if (action === 'fav') { store.toggleFavourite(id); notify.resetAlerts(); render(); }
  if (action === 'ridden') { store.toggleRidden(id); render(); }
  // La ficha abierta debe reflejar el nuevo estado de sus botones.
  if (action !== 'detail' && el('detail').open) refreshSheet();
}

function switchView(view) {
  app.view = view;
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.view === view));
  el('view-list').hidden = view !== 'list';
  el('view-map').hidden = view !== 'map';
  el('view-plan').hidden = view !== 'plan';
  if (view === 'map') {
    mapView.initMap(el('map'), openZone);
    mapView.refreshSize();
    const rides = visibleRides();
    mapView.renderRides(rides);
    renderMapNote(rides);
    const position = geo.getPosition();
    if (position) mapView.renderUser(position);
  }
}

async function enableLocation() {
  try {
    const position = await geo.startWatching();
    mapView.renderUser(position);
    mapView.centerOn(position);
    toast('Ubicación activada.');
    render();
  } catch (err) {
    toast(err && err.code === 1
      ? 'Permiso de ubicación denegado.'
      : 'No se pudo obtener la ubicación.');
  }
}

function bindEvents() {
  el('refresh').addEventListener('click', () => load());
  el('list').addEventListener('click', handleCardAction);
  el('view-plan').addEventListener('click', handleCardAction);
  el('detail').addEventListener('click', (e) => {
    if (e.target === el('detail')) el('detail').close();
    handleCardAction(e);
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  el('toggle-filters').addEventListener('click', () => {
    const panel = el('filters');
    panel.hidden = !panel.hidden;
    el('toggle-filters').setAttribute('aria-expanded', String(!panel.hidden));
  });

  el('search').addEventListener('input', (e) => {
    store.setFilters({ text: e.target.value });
    renderList(visibleRides());
  });

  el('filters').addEventListener('click', (e) => {
    const button = e.target.closest('.chip');
    if (!button) return;
    if (button.dataset.filter) {
      const key = button.dataset.filter;
      store.setFilters({ [key]: toggleInArray(store.filters[key], button.dataset.value) });
    } else if (button.dataset.sort) {
      store.setFilters({ sort: button.dataset.sort });
    } else if (button.dataset.toggle) {
      store.setFilters({ [button.dataset.toggle]: !store.filters[button.dataset.toggle] });
    } else {
      return;
    }
    render();
  });

  el('max-wait').addEventListener('input', (e) => {
    const value = Number(e.target.value);
    store.setFilters({ maxWait: value ? value : null });
    render();
  });

  el('reset-filters').addEventListener('click', () => { store.resetFilters(); render(); });
  el('locate').addEventListener('click', enableLocation);
  el('enable-location').addEventListener('click', enableLocation);
  el('center-park').addEventListener('click', () => mapView.centerOnPark());
  el('clear-ridden').addEventListener('click', () => { store.clearRidden(); render(); });

  el('alerts-enabled').addEventListener('change', async (e) => {
    if (e.target.checked) {
      const state = await notify.requestPermission();
      if (state !== 'granted') {
        e.target.checked = false;
        toast('El navegador no ha concedido permiso para notificar.');
      }
    }
    store.setAlerts(e.target.checked, Number(el('threshold').value));
    notify.resetAlerts();
    renderAlertsNote();
  });

  el('threshold').addEventListener('input', (e) => {
    el('threshold-value').textContent = e.target.value;
    store.setAlerts(store.alertsEnabled, Number(e.target.value));
    notify.resetAlerts();
  });

  geo.onPosition((position) => {
    mapView.renderUser(position);
    if (store.filters.sort === 'distance' || store.filters.sort === 'best') render();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInterval(app.timer);
      app.timer = null;
    } else if (!app.timer) {
      load({ silent: true });
      app.timer = setInterval(() => load({ silent: true }), REFRESH_MS);
    }
  });
}

function renderAlertsNote() {
  const note = notify.supported()
    ? (notify.permission() === 'denied'
      ? 'Has bloqueado las notificaciones para este sitio.'
      : 'Se comprueba en cada actualización, con la app abierta.')
    : 'Este navegador no admite notificaciones.';
  el('alerts-note').textContent = note;
}

function init() {
  bindEvents();
  el('alerts-enabled').checked = store.alertsEnabled;
  el('threshold').value = store.alertThreshold;
  el('threshold-value').textContent = store.alertThreshold;
  renderAlertsNote();

  restoreFromCache();
  render();
  load();
  app.timer = setInterval(() => load({ silent: true }), REFRESH_MS);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
}

init();
