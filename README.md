# Spelling Bee 3D Meter

Vue + Three.js frontend for the Spelling Bee draw meter.

## Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

The scene uses cache-versioned assets and a network-first service worker to prevent stale visual iterations.

Latest pass 20260610-031500:
- Kept the previous working Gaussian splat scene and original camera angle/path.
- Added the provided floral ground texture as a broad underlay plane below the splat surface so it only fills reconstruction holes from underneath.
- Preserved bee and butterfly sprite overlays across the splat space.
- Reduced will-o-wisp sizing so the glow effects read smaller and less intrusive.
- Updated cache/build stamps for fresh asset delivery.
