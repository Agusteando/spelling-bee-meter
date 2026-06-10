# Spelling Bee 3D Meter

Vue + Three.js frontend for the Spelling Bee draw meter.

## Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

The scene uses cache-versioned assets and a network-first service worker to prevent stale visual iterations.

Latest pass 20260610-040000:
- Replaced the active Gaussian splat with the newly provided `gaussians (4).ply` file.
- Preserved the current scene setup: floral underlay below the splat, bee and butterfly sprites, and reduced wisps.
- Bumped cache/build stamps so the new splat is fetched immediately.
