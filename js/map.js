/**
 * Mapa Leaflet con las zonas del parque y tu posición.
 *
 * El API no da una coordenada por atracción: todas las de una misma zona
 * comparten punto (5 puntos para 35 atracciones ubicadas). Por eso el mapa
 * agrupa por coordenada y cada marcador abre la lista de su zona.
 */

import { PARK_CENTER } from './geo.js';

let map = null;
let markerLayer = null;
let userMarker = null;
let accuracyCircle = null;
let fitted = false;
let onSelectZone = () => {};

export function isReady() {
  return map !== null;
}

export function zoneKey(ride) {
  return `${ride.lat.toFixed(5)},${ride.lng.toFixed(5)}`;
}

/** Agrupa las atracciones ubicadas por coordenada (una por zona). */
export function groupByZone(rides) {
  const zones = new Map();
  for (const ride of rides) {
    if (!ride.hasLocation) continue;
    const key = zoneKey(ride);
    if (!zones.has(key)) zones.set(key, { key, lat: ride.lat, lng: ride.lng, rides: [] });
    zones.get(key).rides.push(ride);
  }
  for (const zone of zones.values()) {
    const open = zone.rides.filter((r) => r.waitIsReal);
    zone.openCount = open.length;
    zone.minWait = open.length ? Math.min(...open.map((r) => r.waitMinutes)) : null;
    // El nombre de la zona lo pone la atracción que sí lo trae en su descripción.
    const named = zone.rides.find((r) => r.hasLand);
    zone.name = named ? named.land : 'Zona del parque';
  }
  return [...zones.values()];
}

export function initMap(container, selectHandler) {
  if (map) return map;
  if (typeof L === 'undefined') {
    // Leaflet viene de un CDN: sin él avisamos en lugar de romper la vista.
    container.innerHTML = '<p class="empty">No se pudo cargar el mapa (sin conexión con el CDN). La lista sigue funcionando.</p>';
    return null;
  }
  onSelectZone = selectHandler || onSelectZone;
  map = L.map(container, { zoomControl: false, attributionControl: true })
    .setView([PARK_CENTER.lat, PARK_CENTER.lng], 16);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  return map;
}

/** Leaflet mide el contenedor al crearlo: si estaba oculto hay que refrescarlo. */
export function refreshSize() {
  if (map) map.invalidateSize();
}

function zoneHtml(zone) {
  const short = zone.name.replace('DC Super Heroes World ', '').replace(/[()]/g, '');
  const detail = zone.openCount
    ? `${zone.openCount} abiertas · desde ${zone.minWait} min`
    : 'nada abierto';
  return `<span class="zone-pin${zone.openCount ? '' : ' zone-pin--off'}"><b>${short}</b><i>${detail}</i></span>`;
}

export function renderRides(rides) {
  if (!map) return [];
  markerLayer.clearLayers();
  const zones = groupByZone(rides);

  for (const zone of zones) {
    L.marker([zone.lat, zone.lng], {
      icon: L.divIcon({
        className: 'zone-wrapper',
        html: zoneHtml(zone),
        iconSize: [132, 46],
        iconAnchor: [66, 23],
      }),
      title: zone.name,
    })
      .on('click', () => onSelectZone(zone.key))
      .addTo(markerLayer);
  }

  // El parque ocupa muy poco terreno: encuadramos en vez de fiarnos del zoom fijo.
  if (!fitted && zones.length) {
    map.fitBounds(L.latLngBounds(zones.map((z) => [z.lat, z.lng])), { padding: [50, 50], maxZoom: 18 });
    fitted = true;
  }
  return zones;
}

export function renderUser(position) {
  if (!map || !position) return;
  const latlng = [position.lat, position.lng];
  if (!userMarker) {
    userMarker = L.circleMarker(latlng, {
      radius: 8, color: '#ffffff', weight: 3, fillColor: '#2b7fff', fillOpacity: 1,
    }).addTo(map);
    accuracyCircle = L.circle(latlng, {
      radius: position.accuracy || 20, color: '#2b7fff', weight: 1, fillOpacity: 0.1,
    }).addTo(map);
  } else {
    userMarker.setLatLng(latlng);
    accuracyCircle.setLatLng(latlng).setRadius(position.accuracy || 20);
  }
}

export function centerOn(position, zoom = 17) {
  if (!map || !position) return;
  map.setView([position.lat, position.lng], zoom);
}

export function centerOnPark() {
  if (!map) return;
  const layers = markerLayer ? markerLayer.getLayers() : [];
  if (layers.length) {
    map.fitBounds(L.latLngBounds(layers.map((l) => l.getLatLng())), { padding: [50, 50], maxZoom: 18 });
  } else {
    map.setView([PARK_CENTER.lat, PARK_CENTER.lng], 16);
  }
}
