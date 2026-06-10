# Spelling Bee 3D Meter

Vue + Three.js frontend for the Spelling Bee draw meter.

## Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

The scene uses cache-versioned assets and a network-first service worker to prevent stale visual iterations.

Latest pass 20260610-050000:
- Converted the hole-cover layer into an island-style shell: a textured underlay plane with surrounding downward walls to hide more visible splat gaps.
- Kept the first Gaussian splat, bees, butterflies, and smaller wisps.
- Trimmed the intro video to about 3 seconds and ensured it has no audio.
- Bumped cache/build stamps for fresh asset delivery.
