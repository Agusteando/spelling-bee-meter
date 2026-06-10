# Spelling Bee 3D Meter

Vue + Three.js frontend for the Spelling Bee draw meter.

## Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

The scene uses cache-versioned assets and a network-first service worker to prevent stale visual iterations.

Latest pass 20260610-043000:
- Shortened the camera trajectory so it only travels through the early useful portion of the previous depth motion, then returns.
- Slowed the camera movement further and reduced side/vertical drift.
- Replaced the intro with the uploaded video and removed its audio track.
- Preserved the first Gaussian splat, floral underlay, bee sprites, butterfly sprites, and reduced wisps.
