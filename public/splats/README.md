Required Gaussian splat file (not included in this zip):

public/splats/gaussians.spz

The app loads `/splats/gaussians.spz` and supports both gzip-wrapped SPZ files and raw NGSP SPZ payloads. Raw NGSP files are gzip-wrapped in the browser before Spark receives them, which avoids the `Invalid gzip header` failure.

For local development, manually place the full file at:

public/splats/gaussians.spz

For production builds, the file must exist before running `npm run build` so Vite copies it to:

dist/splats/gaussians.spz

If you copy or replace the SPZ after building, rebuild the app so production receives the current file.
