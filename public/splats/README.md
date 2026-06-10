Required Gaussian splat file (not included in this zip):

public/splats/gaussians.spz

The app loads `/splats/gaussians.spz`. The file is intentionally excluded from the zip; manually place the full SPZ there.

SPZ compatibility:
- gzip-wrapped legacy SPZ files are passed directly to Spark.
- raw legacy NGSP files are gzip-wrapped in the browser before Spark receives them.
- raw SPZ v4 NGSP files are converted in the browser to Spark-compatible legacy SPZ before rendering.

For local development, manually place the full file at:

public/splats/gaussians.spz

For production builds, the file must exist before running `npm run build` so Vite copies it to:

dist/splats/gaussians.spz

If you copy or replace the SPZ after building, rebuild the app so production receives the current file.
