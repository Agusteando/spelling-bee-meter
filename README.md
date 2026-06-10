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

## Latest pass 20260611-033500

- Reworked the camera into a faster cinematic path with a neutral front start, early ant-view dip, stronger side parallax, deeper push, partial top reveal, and graceful return.
- Kept the app referencing `/splats/gaussians.spz` without bundling the SPZ binary.
- Preserved the SPZ v4 runtime compatibility and visible +Z-forward remapping.
- Updated cache stamps.
