# Spelling Bee 3D Meter

Vue + Three.js frontend for the Spelling Bee draw meter.

## Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

## Gaussian splat asset

This lightweight package intentionally does not redistribute the large Gaussian `.ply` file. Place the active splat manually at:

`public/splats/gaussians.ply`

## Latest pass 20260610-235500

- Removed the intro video and its service-worker preload entry.
- Removed the skybox assets and switched the scene to a warm solid background color sampled to match the provided reference image.
- Added a runtime Gaussian reveal: the splat starts compact and transparent, then expands/fades into its final placement.
- Removed the camera linger/pause feeling by using a continuous cinematic front/side/top-safe movement curve.
- Kept the package lightweight by excluding the Gaussian splat, `node_modules`, and `dist`.
