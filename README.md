# Super Agent Whiteboard – Solid + D3 Rewrite

This branch is the first pass of the SolidJS-based rewrite requested for the Super Agent ML whiteboard. The project removes the original Svelte/p5 stack and replaces it with a lean Solid + Canvas core, plus D3/TensorFlow-ready visualization infrastructure.

## Tech stack

- **SolidJS + Vite** – component system and reactivity
- **Custom canvas engine** – whiteboard strokes, shapes, erasing, annotations, layers
- **D3 v7** – GPU-friendly rendering pipeline for interactive ML plots (k-means implemented)
- **TensorFlow.js ready** – architecture prepared for future ML visualizations

## Running locally

```bash
npm install
npm run dev
```

## Current status (rewrite in progress)

- ✅ New Solid layout (tool panel, layers, visualization library, annotation prompts)
- ✅ Canvas engine with multi-layer support, undo/redo, notes/text overlays, grid/axes
- ✅ D3-powered clustering suite: K-Means (now with image palette extraction) and DBSCAN demos
- 🚧 Visualization control panel – hooks exist, UI wiring pending

## Next steps

1. Deepen clustering controls (distance metrics, linkage strategies, seeding options).
2. Wire visualization control widgets (sliders, toggles, buttons) via `visualizationActions` state.
3. Expand export pipeline (PNG/SVG/JSON) and ensure parity with the former feature set.

Because this is a full rewrite, expect APIs and component boundaries to continue evolving. The new structure is now primed for performance work without p5 overhead.
