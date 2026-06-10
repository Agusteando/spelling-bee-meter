# Spelling Bee 3D Meter

Vue + Three.js frontend for the Spelling Bee draw meter.

## Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

The scene uses cache-versioned assets and a network-first service worker to prevent stale visual iterations.

Latest pass 20260610-060000:
- Kept the current Gaussian splat and restored the default splat-facing camera trajectory instead of the sky-finish path.
- Replaced the intro with the uploaded Kling video trimmed to about 3 seconds and removed its audio track.
- Preserved sky texture, underlay, bees, butterflies, and reduced wisps.
- Bumped cache/build stamps for fresh delivery.
