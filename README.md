# Spelling Bee 3D Meter

Vue + Three.js frontend for the Spelling Bee draw meter.

## Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

The scene uses cache-versioned assets and a network-first service worker to prevent stale visual iterations.

Latest pass 20260610-024500:
- Restored the previous working Gaussian splat PLY.
- Removed the ground underlay/layer entirely.
- Restored the original fixed camera angle and slow depth-travel path that kept the splat visible.
- Kept bee and butterfly sprite overlays with idle motion.
- Updated cache/build stamps for fresh asset delivery.
