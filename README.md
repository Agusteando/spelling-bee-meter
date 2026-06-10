# Spelling Bee 3D Meter

Vue + Three.js frontend for the Spelling Bee draw meter.

## Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

The scene uses cache-versioned assets and a network-first service worker to prevent stale visual iterations.

Latest pass 20260610-033000:
- Replaced the active Gaussian splat with the newer provided PLY file.
- Preserved the current scene setup: floral underlay below the splat, bee and butterfly sprites, and smaller wisps.
- Bumped cache/build stamps so the newer splat is fetched immediately.
