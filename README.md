# Spelling Bee 3D Meter

Vue + Three.js frontend for the Spelling Bee draw meter.

## Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

The scene uses cache-versioned assets and a network-first service worker to prevent stale visual iterations.

Latest pass 20260610-015900:
- Kept the Gaussian splat as the default scene at origin with the existing slow fixed-angle depth travel.
- Added a textured ground patch beneath the splat to fill visual holes using the provided image.
- Placed a small set of animated bee and butterfly sprites across the splat space with gentle idle motion.
- Updated cache/build stamps for fresh asset delivery.
