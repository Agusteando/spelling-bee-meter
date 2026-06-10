# Spelling Bee 3D Meter

Vue + Three.js frontend for the Spelling Bee draw meter.

## Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

The scene uses cache-versioned assets and a network-first service worker to prevent stale visual iterations.

Latest pass 20260610-041500:
- Restored the first provided Gaussian splat PLY as the active scene asset.
- Preserved the current scene setup: floral underlay below the splat, bee and butterfly sprites, reduced wisps, and existing camera path.
- Bumped cache/build stamps so the restored splat is fetched immediately.
