Place the Gaussian splat manually here:

public/splats/gaussians.ply

The large .ply is intentionally not included in this lightweight zip.

For production builds, either place the file before running `npm run build`, or copy it after build to:

dist/splats/gaussians.ply

The app also accepts public/splats/reference.ply as a fallback during development/production if gaussians.ply is missing.
