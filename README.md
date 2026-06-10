# Spelling Bee 3D Meter

Vue + Three.js frontend for the Spelling Bee draw meter.

## Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

The scene uses cache-versioned assets and a network-first service worker to prevent stale visual iterations.

Latest pass 20260610-020500:
- Kept the Gaussian splat as the default scene at origin with the existing slow fixed-angle depth travel.
- Added a textured ground patch beneath the splat to fill visual holes using the provided image.
- Placed a small set of animated bee and butterfly sprites across the splat space with gentle idle motion.
- Updated cache/build stamps for fresh asset delivery.

Latest pass 20260610-021500:
- Lowered the terrain patch so it acts as an underlay beneath the Gaussian splat rather than sitting on the visible surface.
- Kept bee and butterfly overlays unchanged.
- Updated cache/build stamps.

Latest pass 20260610-022500:
- Keeps the Gaussian splat and underlay intact.
- Changes the camera path so it remains above the surface instead of plunging into the splat.
- Uses a fixed upward-facing view of about 45 degrees with very slow forward/back travel.
- Updates cache/build stamps.
