# Spelling Bee 3D Meter

Vue + Three.js frontend for the Spelling Bee draw meter.

## Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

The scene uses cache-versioned assets and a network-first service worker to prevent stale visual iterations.

Latest pass 20260610-051500:
- Replaced the sky with the newly provided sky texture image.
- Updated the camera motion to a one-way 10-second move that advances slightly, rises, and ends aimed mostly at the sky, with only a small portion of the Gaussian splat still visible.
- Kept the first Gaussian splat, underlay, bees, butterflies, and smaller wisps.
- Bumped cache/build stamps so the new sky and motion path load immediately.
