/** Ubicación del visitante y distancias a las atracciones. */

export const PARK_CENTER = { lat: 40.2300, lng: -3.5934 };

const WALK_METERS_PER_MIN = 80;

let position = null;
let watchId = null;
const listeners = new Set();

export function onPosition(fn) {
  listeners.add(fn);
  if (position) fn(position);
  return () => listeners.delete(fn);
}

export function getPosition() {
  return position;
}

/**
 * Pide la ubicación. Debe llamarse desde un gesto del usuario: los navegadores
 * móviles ignoran (o penalizan) la petición automática al cargar.
 */
export function startWatching() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Este navegador no ofrece ubicación'));
      return;
    }
    if (watchId !== null) {
      resolve(position);
      return;
    }
    let settled = false;
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        position = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          at: pos.timestamp,
        };
        listeners.forEach((fn) => fn(position));
        if (!settled) {
          settled = true;
          resolve(position);
        }
      },
      (err) => {
        if (!settled) {
          settled = true;
          watchId = null;
          reject(err);
        }
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
    );
  });
}

export function stopWatching() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

/** Distancia en metros entre dos puntos (haversine). */
export function distanceMeters(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return null;
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function walkMinutes(meters) {
  if (!Number.isFinite(meters)) return null;
  return Math.max(1, Math.round(meters / WALK_METERS_PER_MIN));
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return null;
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

/** Enlace de navegación a pie hacia la atracción. */
export function directionsUrl(ride) {
  return `https://www.google.com/maps/dir/?api=1&destination=${ride.lat},${ride.lng}&travelmode=walking`;
}
