# Spelling Bee 3D Meter

Vue + Three.js frontend for the Spelling Bee draw meter.

## Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

The scene uses cache-versioned assets and a network-first service worker to prevent stale visual iterations.

Latest pass 20260610-071500:
- Restored a closed Gaussian-view camera trajectory so the scene returns to the opening view on every loop.
- Moved the bees closer to the flower-level surface and reduced their scale.
- Added more tiny butterfly sprites near the splat surface.
- Enlarged the skybox sphere and replaced the flat underlay with a smaller sealed underlay that bends upward inside the Gaussian footprint.
- Bumped cache/build stamps for fresh delivery.
