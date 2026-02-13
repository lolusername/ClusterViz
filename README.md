# ClusterViz
ClusterViz is a clustering sandbox built around one core idea:

Run clustering workflows across two data spaces in the same app:
- Randomly generated points on a 2D plane.
- Image pixels treated as vectors in a pixel-value matrix (RGB space).

This makes it easy to show that the same clustering intuition can transfer from geometric data to image data.

## What It Does
- Lets you generate and edit 2D point clouds (gaussian, uniform, rings, grid, and manual edits).
- Lets you upload images, sample pixels, and cluster color vectors from the pixel matrix.
- Keeps a shared dataset state so module changes stay in sync as you switch explainers.
- Combines a whiteboard and clustering modules in one workspace for teaching and demos.

## Why This Is Useful
Most clustering demos only show one type of data. ClusterViz is designed to compare:
- Spatial clustering on a 2D plane.
- Pixel/color clustering from real images.

You can discuss the same concepts (distance, neighborhoods, cluster assignment, outliers, centroids) in both contexts without switching tools.

## Current Modules
- K-Means:
  - Interactive clustering on 2D points with draggable centroids.
  - Color clustering on image pixels in RGB space for palette extraction.
- DBSCAN:
  - Density-based clustering on the shared 2D dataset (epsilon and MinPts controls).
  - Shares the same dataset/control surface and image upload context for side-by-side teaching.

## Core Workflow
1. Create or regenerate a point dataset on the 2D canvas.
2. Optionally upload an image and sample its pixels.
3. Run clustering in the selected module.
4. Compare behavior between geometric data and pixel-value data.

## Architecture
- `src/App.tsx` builds the workspace layout (canvas, controls, library).
- `src/components/WhiteboardCanvas.tsx` hosts drawing layers and visualization overlays.
- `src/state/dataset.ts` stores shared dataset metadata (origin, points, image preview, palette swatches).
- `src/lib/ml/modules/kmeansSolid.tsx` and `src/lib/ml/modules/dbscanSolid.tsx` implement interactive modules.
- `src/lib/ml/modules/paletteUtils.ts` handles image sampling and RGB-space color clustering.

## Tech Stack
- SolidJS + Vite + TypeScript
- Tailwind/PostCSS
- D3 utilities for data helpers

## Run Locally
```bash
npm install
npm run dev
npm run build
npm run preview
```
