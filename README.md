# Spelling Bee 3D Meter

Vue + Three.js frontend for the Spelling Bee draw meter.

## Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

The scene uses cache-versioned assets and a network-first service worker to prevent stale visual iterations.

Updated scene notes:
- Use uploaded panorama PNG instead of the previous vector panorama.
- Fix inside-cylinder mirroring.
- Keep bees upright and within the visible scenic volume.
- Add butterfly sprites back into the scene.
