Active Gaussian splat file:

public/splats/gaussians.spz

The app now loads the compressed SPZ version directly from `/splats/gaussians.spz`.

For production builds, keep the file in `public/splats/gaussians.spz` before running `npm run build` so Vite copies it to:

dist/splats/gaussians.spz

If you replace this file after building, rebuild the app so production receives the new SPZ.
