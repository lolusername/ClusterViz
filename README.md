# ClusterViz
An interactive space for teaching clustering: sketch on a whiteboard, manipulate a shared dataset, and launch explainers without leaving the canvas.

## Overview
ClusterViz mixes two ingredients that usually live in different tabs. The multi-layer board handles notes, diagrams, and quick annotations; the visualization rail mounts Solid-powered modules (k-means, DBSCAN today) that reuse the same dataset and controls. Everything is wired through Solid signals so swapping modules or resizing the canvas keeps the state intact.

## Features
- Layered sketching with pens, shapes, fill/outline colors, locking, and undo/redo (`src/components/ToolPanel.tsx`, `src/lib/whiteboard/engine.ts`).
- Dataset console for density sliders, distribution presets, and manual point drops that sync across modules (`src/state/dataset.ts`, `SharedDatasetControls.tsx`).
- Palette extraction from any uploaded image using RGB-space k-means, shared by all modules (`src/lib/ml/modules/paletteUtils.ts`).
- Library of explainers you can search and launch inline; each registers through `src/lib/ml/registry.ts`.
- K-Means module with draggable centroids, initialization walkthroughs, and palette-aware persistence (`kmeansSolid.tsx`).
- DBSCAN module with ε / MinPts sliders, noise/core/border labels, and drag-to-rerun interactions (`dbscanSolid.tsx`).

## Architecture snapshot
- `src/App.tsx` arranges the workspace, while `WhiteboardCanvas.tsx` hosts both the drawing layers and visualization overlay.
- `whiteboardState`, `datasetState`, and `visualizationState` (in `src/state/`) keep Solid stores for tools, shared data, and active modules.
- The canvas engine caches one off-screen canvas per layer, draws previews on an overlay surface, and dispatches commits back to the store.
- Visualization modules receive a `VisualizationContext` (canvas, overlay, controls host, width/height helpers) so they can manage lifecycles without touching global DOM.

## Stack & scripts
- SolidJS + Vite + TypeScript, Tailwind/PostCSS for styling.
- D3 for sampling utilities, TensorFlow.js already included for future modules.

```bash
npm install
npm run dev
npm run build   # bundles to dist/
npm run preview # serve the production build
```
