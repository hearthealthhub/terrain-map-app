import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';

const app = document.querySelector('#app');

app.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <h1>Flight Brief Terrain Map</h1>
      <p class="subtitle">Paste one waypoint per line, then export a clean image for slides.</p>

      <label class="field">
        <span>Waypoints</span>
        <textarea id="waypoints" spellcheck="false" placeholder="KASE\n39.1911, -106.8175\nLeadville, CO\nKTEX"></textarea>
      </label>

      <div class="grid two">
        <label class="field">
          <span>Image width</span>
          <input id="exportWidth" type="number" min="400" step="10" value="1600" />
        </label>
        <label class="field">
          <span>Image height</span>
          <input id="exportHeight" type="number" min="300" step="10" value="900" />
        </label>
      </div>

      <label class="field checkbox-row">
        <input id="showLabels" type="checkbox" checked />
        <span>Show place labels</span>
      </label>

      <div class="actions">
        <button id="plotBtn">Plot route</button>
        <button id="fitBtn" class="secondary">Fit to slide</button>
        <button id="exportBtn" class="secondary">Export PNG</button>
      </div>

      <details class="details">
        <summary>Basemap setup</summary>
        <p>Default uses Esri World Imagery and reference labels. To swap to another provider, edit <code>src/main.js</code> and replace the raster source URLs or wire a token through <code>window.TERRAIN_MAP_CONFIG</code>.</p>
      </details>

      <div id="status" class="status">Ready.</div>
      <ol id="resolvedList" class="resolved-list"></ol>
    </aside>

    <main class="map-panel">
      <div id="map"></div>
    </main>
  </div>
`;

const defaultCenter = [-106.5, 39.1];
const coordinatePattern = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/;
const airportCodePattern = /^[A-Z0-9]{3,4}$/;
const statusEl = document.getElementById('status');
const resolvedListEl = document.getElementById('resolvedList');
const waypointsEl = document.getElementById('waypoints');
const showLabelsEl = document.getElementById('showLabels');
const exportWidthEl = document.getElementById('exportWidth');
const exportHeightEl = document.getElementById('exportHeight');
const runtimeConfig = window.TERRAIN_MAP_CONFIG ?? {};

const imageryTiles = runtimeConfig.imageryTiles ?? [
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
];
const labelTiles = runtimeConfig.labelTiles ?? [
  'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
];

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      imagery: {
        type: 'raster',
        tiles: imageryTiles,
        tileSize: 256,
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community'
      },
      labels: {
        type: 'raster',
        tiles: labelTiles,
        tileSize: 256,
        attribution: 'Labels © Esri'
      }
    },
    layers: [
      { id: 'imagery', type: 'raster', source: 'imagery' },
      { id: 'labels', type: 'raster', source: 'labels', layout: { visibility: 'visible' } }
    ]
  },
  center: defaultCenter,
  zoom: 7,
  maxPitch: 0,
  attributionControl: true,
  preserveDrawingBuffer: true
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');

map.on('load', () => {
  map.addSource('route', {
    type: 'geojson',
    data: emptyFeatureCollection()
  });

  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: {
      'line-color': '#ffd400',
      'line-width': 4,
      'line-opacity': 0.95
    }
  });

  map.addLayer({
    id: 'route-points',
    type: 'circle',
    source: 'route',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 7,
      'circle-color': '#ff3b30',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff'
    }
  });

  map.addLayer({
    id: 'route-labels',
    type: 'symbol',
    source: 'route',
    filter: ['==', ['geometry-type'], 'Point'],
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 12,
      'text-offset': [0, 1.7],
      'text-anchor': 'top',
      'text-font': ['Open Sans Semibold'],
      'text-allow-overlap': true,
      'text-max-width': 14
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(15, 23, 42, 0.82)',
      'text-halo-width': 6,
      'text-halo-blur': 0.6
    }
  });
});

document.getElementById('fitBtn').addEventListener('click', async () => {
  fitRouteToView();
  await waitForMapIdle();
  setStatus('Route fitted to slide view.');
});

document.getElementById('plotBtn').addEventListener('click', async () => {
  await plotRoute();
});

showLabelsEl.addEventListener('change', () => {
  if (!map.getLayer('labels')) return;
  map.setLayoutProperty('labels', 'visibility', showLabelsEl.checked ? 'visible' : 'none');
});

document.getElementById('exportBtn').addEventListener('click', async () => {
  await exportMap();
});

async function plotRoute() {
  const lines = waypointsEl.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    setStatus('Enter at least one waypoint.', true);
    return;
  }

  setStatus('Resolving waypoints...');
  resolvedListEl.innerHTML = '';

  const resolved = [];
  const failures = [];

  for (let index = 0; index < lines.length; index += 1) {
    const input = lines[index];
    try {
      const point = await resolveWaypoint(input);
      resolved.push({ ...point, order: index + 1 });
      appendResolved(point, index + 1);
    } catch (error) {
      failures.push(`${index + 1}. ${input} (${error.message})`);
    }
  }

  if (!resolved.length) {
    setStatus(`Could not resolve any waypoints. ${failures.join(' | ')}`, true);
    updateRouteOnMap([]);
    return;
  }

  updateRouteOnMap(resolved);
  setStatus(
    failures.length
      ? `Plotted ${resolved.length} waypoint(s). Unresolved: ${failures.join(' | ')}`
      : `Plotted ${resolved.length} waypoint(s).`
  , failures.length > 0);
}

async function resolveWaypoint(input) {
  const coordinateMatch = input.match(coordinatePattern);
  if (coordinateMatch) {
    const lat = Number(coordinateMatch[1]);
    const lon = Number(coordinateMatch[2]);
    validateCoordinates(lat, lon);
    return { label: input, lat, lon, source: 'coordinates' };
  }

  if (airportCodePattern.test(input)) {
    try {
      const airportResult = await geocode(`${input} airport`);
      if (airportResult) return airportResult;
    } catch {
      // fall through to generic geocode
    }
  }

  const generic = await geocode(input);
  if (!generic) {
    throw new Error('not found');
  }

  return generic;
}

async function geocode(query) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('q', query);

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`geocoder ${response.status}`);
  }

  const data = await response.json();
  if (!data.length) return null;

  const result = data[0];
  const lat = Number(result.lat);
  const lon = Number(result.lon);
  validateCoordinates(lat, lon);
  return {
    label: tidyLabel(query, result.display_name),
    lat,
    lon,
    source: 'geocoded'
  };
}

function tidyLabel(input, displayName) {
  const shortName = displayName.split(',').slice(0, 2).join(',').trim();
  return input.length <= 5 ? input.toUpperCase() : shortName || input;
}

function validateCoordinates(lat, lon) {
  if (Number.isNaN(lat) || Number.isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('invalid coordinates');
  }
}

function updateRouteOnMap(points) {
  const features = points.map((point) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [point.lon, point.lat]
    },
    properties: {
      label: `${point.label}\n${point.lat.toFixed(4)}\n${point.lon.toFixed(4)}`
    }
  }));

  if (points.length >= 2) {
    features.unshift({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: points.map((point) => [point.lon, point.lat])
      },
      properties: {}
    });
  }

  map.getSource('route')?.setData({
    type: 'FeatureCollection',
    features
  });

  fitRouteToView(points);
}

function fitRouteToView(points = getCurrentRoutePoints()) {
  if (!points.length) {
    map.flyTo({ center: defaultCenter, zoom: 7 });
    return;
  }

  if (points.length === 1) {
    map.flyTo({ center: [points[0].lon, points[0].lat], zoom: 10 });
    return;
  }

  const bounds = points.reduce(
    (acc, point) => acc.extend([point.lon, point.lat]),
    new maplibregl.LngLatBounds([points[0].lon, points[0].lat], [points[0].lon, points[0].lat])
  );

  map.fitBounds(bounds, { padding: { top: 120, bottom: 120, left: 120, right: 120 }, duration: 800 });
}

function getCurrentRoutePoints() {
  const data = map.getSource('route')?._data;
  if (!data?.features) return [];
  return data.features
    .filter((feature) => feature.geometry.type === 'Point')
    .map((feature) => ({
      lon: feature.geometry.coordinates[0],
      lat: feature.geometry.coordinates[1],
      label: feature.properties.label
    }));
}

function appendResolved(point, order) {
  const item = document.createElement('li');
  item.textContent = `${order}. ${point.label} → ${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`;
  resolvedListEl.appendChild(item);
}

async function exportMap() {
  const width = Number(exportWidthEl.value);
  const height = Number(exportHeightEl.value);
  if (!width || !height) {
    setStatus('Enter valid export dimensions.', true);
    return;
  }

  setStatus('Rendering export...');
  const previous = {
    width: map.getContainer().style.width,
    height: map.getContainer().style.height
  };

  const mapEl = map.getContainer();
  mapEl.style.width = `${width}px`;
  mapEl.style.height = `${height}px`;
  map.resize();

  await waitForMapIdle();

  const canvas = map.getCanvas();
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = `flight-brief-map-${width}x${height}.png`;
  link.click();

  mapEl.style.width = previous.width;
  mapEl.style.height = previous.height;
  map.resize();
  setStatus('PNG exported.');
}

function waitForMapIdle() {
  return new Promise((resolve) => {
    if (map.loaded() && !map.isMoving()) {
      requestAnimationFrame(resolve);
      return;
    }
    map.once('idle', () => resolve());
  });
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function emptyFeatureCollection() {
  return {
    type: 'FeatureCollection',
    features: []
  };
}
