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

The SPZ binary is intentionally not included in this zip. Manually place the full file at `public/splats/gaussians.spz` for development. The loader now supports both gzip-wrapped SPZ files and raw NGSP SPZ payloads, wrapping raw NGSP in the browser before Spark receives it. Keep the file there before running `npm run build`; Vite will copy it to `dist/splats/gaussians.spz` for production.

If you build before copying the SPZ, copy it and rebuild.

## Latest pass 20260611-023000

- Kept the app referencing `/splats/gaussians.spz`.
- Supports raw NGSP SPZ and gzip-wrapped SPZ without bundling the splat file.
- Removed the distributed SPZ binary from the lightweight package.
- Updated splat setup notes and cache stamp.
