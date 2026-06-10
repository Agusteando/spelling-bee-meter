# Spelling Bee 3D Meter

Vue + Three.js frontend for the Spelling Bee draw meter.

## Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

The scene uses cache-versioned assets and a network-first service worker to prevent stale visual iterations.

Latest pass 20260610-053000:
- Replaced the Gaussian splat with the newly provided `gaussians (5).ply`.
- Kept the current sky image, camera trajectory, underlay, bees, butterflies, and wisps.
- Bumped cache/build stamps so the swapped splat loads immediately.
