# Flight Brief Terrain Map

Small local web app for quickly turning a list of waypoints into a satellite-style route image for daily flight briefs.

## What it does

- Accepts one waypoint per line
- Supports direct coordinates like `39.1911, -106.8175`
- Geocodes names and airport codes when possible
- Marks waypoints, connects them in entered order, and fits the view automatically
- Uses Esri World Imagery by default for a terrain / satellite look
- Exports a PNG at your chosen size for pasting into Google Slides

## Quick start

```bash
cd terrain-map-app
npm install
npm run dev
```

Then open the local URL Vite prints, usually `http://localhost:5173`.

## Fast workflow

1. Paste waypoints, one per line.
2. Click **Plot route**.
3. Adjust the map if you want.
4. Set export width and height. A good slide-friendly default is `1600 x 900`.
5. Click **Export PNG**.

## Notes

- Geocoding uses OpenStreetMap Nominatim, so the app needs internet access.
- Basemap imagery uses Esri World Imagery tiles.
- If you want a different imagery provider, edit `public/config.js` and set `window.TERRAIN_MAP_CONFIG` tile URLs there.
- Export works from the on-screen map canvas, so keep the browser tab active until the PNG downloads.

## Build for production

```bash
npm run build
npm run preview
```
