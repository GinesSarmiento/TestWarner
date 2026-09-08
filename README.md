# Colas Warner

PWA para consultar durante la visita al Parque Warner el estado y el tiempo de cola de
las atracciones, con filtros, mapa por zonas, favoritos con aviso de cola baja y plan
del día. Los datos salen del API público de Pase Correcaminos:

```
https://pasecorrecaminos.es/api/api/guest/rides
```

No hay build ni dependencias que instalar: HTML + CSS + módulos ES, con Leaflet desde CDN.

## Uso en local

```bash
python3 -m http.server 8000   # y abrir http://localhost:8000
node dev/test-normalize.mjs   # valida el normalizador contra una respuesta real
```

## Publicar en GitHub Pages

1. En GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
2. Rama `claude/warner-attractions-tracker-7ao9sx`, carpeta `/ (root)`.
3. La app queda en `https://<usuario>.github.io/TestWarner/`.

Pages sirve por HTTPS, que es lo que exigen la geolocalización, las notificaciones y el
service worker. Desde el móvil, «Añadir a pantalla de inicio» la instala como app.

## Qué muestra

- **Lista**: estado, minutos de cola coloreados, zona, sensación, altura mínima y
  distancia a pie. Ficha completa con descripción, restricciones, capacidad por hora,
  desde cuándo está cerrada y frescura del dato.
- **Filtros**: nombre, estado, intensidad (sensación), zona, espera máxima, sólo
  favoritas, ocultar montadas, ocultar variantes `[HSN]`. Orden por cola, «mejor ahora»
  (cola + distancia + favoritas), distancia, nombre o zona.
- **Mapa**: un marcador por zona con las abiertas y la cola mínima; al tocarlo se listan
  sus atracciones. Punto azul con tu posición y enlace de navegación a pie.
- **Plan**: progreso de montadas, sugerencia de siguiente atracción, favoritas y avisos
  locales cuando una favorita baja del umbral.

Los filtros, favoritos, montadas y la última respuesta se guardan en `localStorage`, así
que la app abre con datos aunque no haya cobertura.

## Detalles del API que conviene conocer

Todo esto se resuelve en `js/api.js` (`normalizeRide`), el único archivo que toca el
formato original:

- **Las coordenadas vienen cruzadas**: `location.longitude` contiene la latitud y
  `location.latitude` la longitud.
- **Ubica por zonas, no por atracción**: sólo hay 5 coordenadas distintas para las 35
  atracciones ubicadas (las demás vienen sin ubicación). Por eso el mapa es de zonas.
- **La intensidad y la zona no son campos**: van dentro del HTML de `description`
  (`SENSACIÓN`, `ALTURA MIN`, y la zona detrás de un icono `location_on`), y sólo la
  mitad de las atracciones los traen.
- **`waitTimeMins` sólo es fiable si `state === "open"`**: las cerradas conservan un
  valor residual de 5 min, así que la app lo oculta.
- Estados posibles: `open`, `full`, `full_and_closed`, `not_operational`,
  `closed_indefinitely`.
- El HTML de la descripción nunca se inyecta en el DOM: se extrae texto plano.

`dev/sample-rides.json` es una respuesta real guardada para poder probar sin red.

## Si la app no carga datos

El navegador hace la llamada directa al API. Si la consola muestra un error de CORS, el
servidor no permite peticiones desde otro dominio y haría falta un proxy propio (por
ejemplo un Cloudflare Worker que reenvíe la petición añadiendo las cabeceras CORS).
