# 3D-Gaussian-Splatting

This is a WebGPU-based viewer for [3D Gaussian Splatting for Real-Time Radiance Field Rendering](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/), a technique that takes a set of pictures of a scene from various angles, and generating a photorealistic navigable scene.

https://github.com/user-attachments/assets/64cdec44-e9f3-4872-801a-bc021e810117

## Features

- Loads Gaussian splats from PLY files and parses binary or ASCII metadata into splat objects.
- Computes per-splat covariance, projection-based basis vectors, and GPU-ready buffers for rendering.
- Renders splats with alpha blending
- Includes a simple point-rendering path for debugging and alternative visualization.

<img width="800" height="800" alt="chips_and_pop_point_cloud" src="https://github.com/user-attachments/assets/4fc34726-d54c-42da-9c8d-2246452f663f" />

## Future improvements
The current implementation only touches the surface of gaussian splatting, and there have been numerous papers suggesting improvements on the technique. I'll list a few of items that could be prioritized, but it's by no means and exhaustive list.

- GPU Sorting: currently splats are sorted on the CPU, which is very inefficient. GPU based bitonic or radix sorting will greatly improve performance.
- Lighting support
- Supporting view dependent shading effects with spherical harmonics. Currently, the colour of a splat is independant of viewing direction.

## Prerequisites

- Node.js and npm installed.
- A browser with WebGPU support enabled.

## Running locally

1. Install dependencies from the root project folder:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Open the localhost address shown in the terminal.

## Project structure

```bash
3D-Gaussian-Splatting
|-- src
|   |-- main.ts                # Application entry point
|   |-- scene.ts               # Scene setup and orchestration
|   |-- renderer.ts            # WebGPU rendering pipeline and frame loop
|   |-- camera.ts              # Camera controls and view/projection setup
|   |-- plyProcessor.ts        # PLY parsing and splat creation
|   |-- gaussianSplat.ts       # Splat math, covariance, and screen-space basis generation
|   |-- gaussianSplats.ts      # GPU splat buffer management and rendering
|   |-- points.ts              # Point rendering implementation
|-- shaders                    # All wgsl shaders for point cloud and splat rendering
```

## References
This project was informed by the original Gaussian Splatting paper and implementation notes, alongside resources like explainer articles on gaussian splatting, projection math, spherical harmonics, covariance geometry, and an existing webgl splat renderer.

- [3D Gaussian Splatting Original Project Page](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/)
- [LearnOpenCV: 3D Gaussian Splatting Projection](https://learnopencv.com/3d-gaussian-splatting/#3D-Gaussian-Splatting-Projection)
- [WebGPU Unleashed: Gaussian Splatting](https://shi-yan.github.io/webgpuunleashed/Advanced/gaussian_splatting.html)
- [A blogpost on spherical harmonics](https://patapom.com/blog/SHPortal/)
- [A Geometric Interpretation of the Covariance Matrix](https://users.cs.utah.edu/~tch/CS4640F2019/resources/A%20geometric%20interpretation%20of%20the%20covariance%20matrix.pdf)
- [A WebGL Splat Implmenetation: antimatter15/splat](https://github.com/antimatter15/splat)
