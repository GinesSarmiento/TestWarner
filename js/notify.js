/** Avisos locales cuando un favorito baja del umbral de espera. */

import { store } from './store.js';

// Recuerda a quién ya avisamos para no repetir el aviso en cada refresco.
const notified = new Set();

export function supported() {
  return typeof Notification !== 'undefined';
}

export function permission() {
  return supported() ? Notification.permission : 'unsupported';
}

export async function requestPermission() {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

/**
 * Revisa los favoritos tras cada refresco. Devuelve las atracciones avisadas
 * para que la UI pueda destacarlas aunque el navegador no muestre la notificación.
 */
export function checkThresholds(rides) {
  if (!store.alertsEnabled) return [];
  const threshold = store.alertThreshold;
  const fired = [];

  for (const ride of rides) {
    if (!store.isFavourite(ride.id)) continue;
    const below = ride.waitIsReal && ride.waitMinutes <= threshold;
    if (below && !notified.has(ride.id)) {
      notified.add(ride.id);
      fired.push(ride);
      show(ride, threshold);
    } else if (!below) {
      // Vuelve a estar por encima (o cerró): rearmamos el aviso.
      notified.delete(ride.id);
    }
  }
  return fired;
}

function show(ride, threshold) {
  if (!supported() || Notification.permission !== 'granted') return;
  try {
    new Notification(`${ride.cleanName}: ${ride.waitMinutes} min`, {
      body: `Ha bajado de ${threshold} min. ${ride.land}`,
      icon: 'icons/icon-192.png',
      tag: `wait-${ride.id}`,
    });
  } catch {
    /* algunos navegadores sólo permiten notificaciones desde el service worker */
  }
}

export function resetAlerts() {
  notified.clear();
}
