# Spelling Bee 3D Meter

Vue + Three.js frontend for the Spelling Bee draw meter.

## Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

The scene uses cache-versioned assets and a network-first service worker to prevent stale visual iterations.

Latest pass 20260610-012500:
- Rotated the PLY Gaussian Splat upright at the root.
- Moved the starting camera inside/closer to the splat volume.
- Slowed the fixed-angle forward/back travel and increased depth while avoiding outside views.
- Updated cache stamp.
