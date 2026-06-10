# Spelling Bee 3D Meter

Vue + Three.js frontend for the Spelling Bee draw meter.

## Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

## Gaussian splat asset

The scene loads the compressed Gaussian splat from:

`public/splats/gaussians.spz`

Keep that file in place before running `npm run build`; Vite will copy it to `dist/splats/gaussians.spz` for production.

## Latest pass 20260611-022000

- Replaced the PLY splat reference with the supplied compressed SPZ asset.
- Added SPZ magic-byte validation before Spark initializes the splat.
- Kept the existing camera, reveal, sprites, and scene behavior unchanged.
