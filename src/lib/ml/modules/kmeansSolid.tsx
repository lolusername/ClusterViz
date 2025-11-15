import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Portal, render } from "solid-js/web";
import type { VisualizationContext, VisualizationDefinition, VisualizationModule } from "../registry";
import { generatePoints, distance, shuffle, type Distribution } from "../utils/data";
import { whiteboardActions, whiteboardState } from "../../../state/whiteboard";
import { datasetActions, datasetState, createDataset } from "../../../state/dataset";
import type { SharedDataset } from "../../../state/dataset";
import { instantiateDatasetPoints, toSharedPoints } from "../../../utils/dataset";
import { SharedDatasetControls } from "./SharedDatasetControls";
import { buildFallbackPalette, extractImageSamples, runColorKMeans, type ImagePreviewMeta, type PaletteSwatch, type SampledPixel, type RGB } from "./paletteUtils";

type KPoint = { id: string; x: number; y: number; cluster: number | null };
type Centroid = { id: string; x: number; y: number };

function clamp(value: number, min: number, max: number) {
  if (min > max) {
    [min, max] = [max, min];
  }
  return Math.min(Math.max(value, min), max);
}

function createPointSet(width: number, height: number, distribution: Distribution, count: number): KPoint[] {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  return generatePoints(safeWidth, safeHeight, distribution, count).map((point) => ({
    id: point.id,
    x: point.x,
    y: point.y,
    cluster: null,
  }));
}

function initialCentroids(width: number, height: number, k: number): Centroid[] {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const count = Math.max(1, Math.round(k));
  return Array.from({ length: count }).map((_, index) => ({
    id: `c-${index}-${crypto.randomUUID()}`,
    x: clamp(Math.random() * safeWidth, 8, safeWidth - 8),
    y: clamp(Math.random() * safeHeight, 8, safeHeight - 8),
  }));
}

function colorDistance(a: RGB, b: RGB) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function parseRgb(input: string): RGB | null {
  const match = input.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:,\s*[\d.]+)?\)/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])] as RGB;
}

function KMeansApp(props: { ctx: VisualizationContext; onExpose: (api: any) => void }) {
  const { ctx } = props;
  const [width, setWidth] = createSignal(Math.max(1, ctx.width()));
  const [height, setHeight] = createSignal(Math.max(1, ctx.height()));
  const [k, setK] = createSignal(3);
  const [distribution, setDistribution] = createSignal<Distribution>("gaussian");
  const [pointCount, setPointCount] = createSignal(120);
  const [running, setRunning] = createSignal(false);
  const [addMode, setAddMode] = createSignal(false);
  const [points, setPoints] = createSignal<KPoint[]>(createPointSet(width(), height(), distribution(), pointCount()));
  // start with no centroids so points are unclustered
  const [centroids, setCentroids] = createSignal<Centroid[]>([]);
  const [initialized, setInitialized] = createSignal(false);
  const [colorSamples, setColorSamples] = createSignal<RGB[]>([]);
  const [palette, setPalette] = createSignal<PaletteSwatch[]>([]);
  const [paletteK, setPaletteK] = createSignal(3);
  const [paletteSource, setPaletteSource] = createSignal<string | null>(null);
  const [paletteStatus, setPaletteStatus] = createSignal("");
  const [imagePreview, setImagePreview] = createSignal<ImagePreviewMeta | null>(null);
  let suppressSharedSync = false;
  const [datasetOrigin, setDatasetOrigin] = createSignal<SharedDataset["origin"]>("generator");
  let imageSampledPixels: SampledPixel[] = [];
  let paletteSignature = "";

  const hydrateFromDataset = (shared: SharedDataset) => {
    setDatasetOrigin(shared.origin);
    const adapted = instantiateDatasetPoints(shared, width(), height());
    setPoints(
      adapted.map((point) => ({
        id: point.id,
        x: point.x,
        y: point.y,
        cluster: typeof point.cluster === "number" ? point.cluster : null,
      }))
    );
    setPointCount(adapted.length);
    setCentroids([]);
    setInitialized(false);
    if (shared.distribution && ["gaussian", "uniform", "rings", "grid"].includes(shared.distribution)) {
      setDistribution(shared.distribution as Distribution);
    }
    if (shared.palettePreview) {
      const previewMarkers = shared.palettePreview.pixels.map((pixel) => ({
        x: pixel.x,
        y: pixel.y,
        color: pixel.color,
      }));
      setPaletteSource(shared.palettePreview.sourceName ?? null);
      setImagePreview({
        url: shared.palettePreview.imageDataUrl,
        width: shared.palettePreview.width,
        height: shared.palettePreview.height,
        sourceName: shared.palettePreview.sourceName,
        markers: previewMarkers,
      });
      imageSampledPixels = shared.palettePreview.pixels.reduce<SampledPixel[]>((acc, pixel) => {
        const rgb = parseRgb(pixel.color);
        if (rgb) acc.push({ x: pixel.x, y: pixel.y, color: rgb });
        return acc;
      }, []);
    if (shared.paletteSwatches?.length) {
      paletteSignature = shared.paletteSwatches.map((swatch) => `${swatch.color}:${swatch.count}`).join("|");
      setPalette(shared.paletteSwatches);
      setPaletteK(Math.max(2, Math.min(8, shared.paletteSwatches.length)));
    } else {
      paletteSignature = "";
      setPalette([]);
      }
    } else {
      setPaletteSource(null);
      setImagePreview(null);
      imageSampledPixels = [];
      paletteSignature = "";
      setPalette([]);
    }
  };

  const getPalettePreviewPayload = (preview: ImagePreviewMeta | null) => {
    if (!preview) return undefined;
    return {
      imageDataUrl: preview.url,
      sourceName: preview.sourceName,
      width: preview.width,
      height: preview.height,
      pixels: preview.markers.map((marker) => ({
        x: marker.x,
        y: marker.y,
        color: marker.color,
      })),
    };
  };

  function persistDataset(options?: { origin?: SharedDataset["origin"]; clearPreview?: boolean; preview?: ImagePreviewMeta | null }) {
    suppressSharedSync = true;
    if (options?.origin) setDatasetOrigin(options.origin);
    const base = datasetState();
    const previewSource = options?.clearPreview ? null : options?.preview !== undefined ? options.preview : imagePreview();
    const dataset = createDataset({
      id: base?.id,
      origin: datasetOrigin(),
      distribution: distribution(),
      width: width(),
      height: height(),
      points: toSharedPoints(points()),
      palettePreview: previewSource ? getPalettePreviewPayload(previewSource) : undefined,
      paletteSwatches: palette().map((swatch) => ({ ...swatch })),
    });
    datasetActions.save(dataset);
    queueMicrotask(() => {
      suppressSharedSync = false;
    });
  }

  function updatePaletteMarkers(swatches: PaletteSwatch[]) {
    const preview = imagePreview();
    if (!preview) return;
    if (!swatches.length || !imageSampledPixels.length) {
      const nextPreview = { ...preview, markers: [] };
      setImagePreview(nextPreview);
      return;
    }
    const available = [...imageSampledPixels];
    const markers: ImageMarker[] = [];
    const limit = Math.min(swatches.length, 8);
    for (let i = 0; i < limit; i++) {
      const swatch = swatches[i];
      const rgb = parseRgb(swatch.color);
      if (!rgb || !available.length) continue;
      let bestIndex = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let idx = 0; idx < available.length; idx++) {
        const candidate = available[idx];
        const dist = colorDistance(candidate.color, rgb);
        if (dist < bestDist) {
          bestDist = dist;
          bestIndex = idx;
        }
      }
      const [match] = available.splice(bestIndex, 1);
      if (!match) continue;
      markers.push({
        x: match.x,
        y: match.y,
        color: swatch.color,
      });
    }
    const nextPreview = { ...preview, markers };
    setImagePreview(nextPreview);
  }

  function syncImagePalette(target = paletteK()) {
    const samples = colorSamples();
    if (!samples.length) return;
    const desired = Math.max(2, Math.min(8, target));
    let swatches = runColorKMeans(samples, desired);
    if (!swatches.length) {
      swatches = buildFallbackPalette(samples, Math.min(6, Math.max(3, desired)));
    }
    if (!swatches.length) {
      const hadPalette = Boolean(paletteSignature);
      paletteSignature = "";
      if (hadPalette) setPalette([]);
      setPaletteStatus("Not enough distinct colors to cluster.");
      updatePaletteMarkers([]);
      return;
    }
    paletteSignature = swatches.map((swatch) => `${swatch.color}:${swatch.count}`).join("|");
    setPalette(swatches);
    setPaletteStatus("");
    updatePaletteMarkers(swatches);
  }

  const originLabel = () => {
    switch (datasetOrigin()) {
      case "image":
        return "Image pixels";
      case "manual":
        return "Manual edits";
      default:
        return "Generator";
    }
  };

  createEffect(() => {
    const shared = datasetState();
    if (!shared) return;
    if (suppressSharedSync) return;
    hydrateFromDataset(shared);
  });

  // One k-means iteration: assign → update; returns max centroid shift
  function assignClusters() {
    const cs = centroids();
    if (!cs.length) return;
    const next = points().map((p) => {
      const dists = cs.map((c) => distance(p.x, p.y, c.x, c.y));
      const minIndex = dists.indexOf(Math.min(...dists));
      return { ...p, cluster: minIndex } as KPoint;
    });
    setPoints(next);
    let maxShift = 0;
    const moved = cs.map((c, i) => {
      const members = next.filter((p) => p.cluster === i);
      if (!members.length) return c;
      const mx = members.reduce((a, b) => a + b.x, 0) / members.length;
      const my = members.reduce((a, b) => a + b.y, 0) / members.length;
      const dx = mx - c.x;
      const dy = my - c.y;
      const shift = Math.hypot(dx, dy);
      if (shift > maxShift) maxShift = shift;
      return { ...c, x: mx, y: my } as Centroid;
    });
    setCentroids(moved);
    return maxShift;
  }

  async function runToConvergence(maxIters = 15, tol = 0.25) {
    if (!centroids().length) return;
    for (let i = 0; i < maxIters; i++) {
      const shift = assignClusters();
      if ((shift ?? 0) < tol) break;
      // tiny microtask so Solid can flush and UI feels responsive
      await Promise.resolve();
    }
  }

  function regenerate(message?: string) {
    const pts = createPointSet(width(), height(), distribution(), pointCount());
    setPoints(pts);
    setCentroids([]); // keep initial state unclustered
    setInitialized(false);
    setPalette([]);
    setPaletteSource(null);
    setPaletteStatus("");
    paletteSignature = "";
    setImagePreview(null);
    imageSampledPixels = [];
    persistDataset({ origin: "generator", clearPreview: true });
    if (message) ctx.pushMessage(message);
  }

  async function animateIteration() {
    if (running()) return;
    setRunning(true);
    const shuffled = shuffle(points()).slice(0, k());
    setCentroids(
      shuffled.map((p, i) => ({ id: `c-${i}-${crypto.randomUUID()}`, x: p.x, y: p.y }))
    );
    ctx.pushMessage("Step 1: pick random centroids from existing samples.");
    await new Promise((r) => setTimeout(r, 600));
    assignClusters();
    ctx.pushMessage("Step 2: assign each point to the closest centroid.");
    await new Promise((r) => setTimeout(r, 800));
    await runToConvergence(10, 0.25);
    ctx.pushMessage("Final check: reassign using updated centroids to confirm convergence.");
    setRunning(false);
    setInitialized(true);
    persistDataset();
  }

  function clampX(x: number) {
    return clamp(x, 8, width() - 8);
  }
  function clampY(y: number) {
    return clamp(y, 8, height() - 8);
  }

  // Pointer interactions on the canvas
  let dragging: { type: "point" | "centroid"; id: string } | null = null;
  function pos(evt: PointerEvent) {
    const rect = ctx.canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }
  const down = (e: PointerEvent) => {
    const p = pos(e);
    const cHit = centroids().find((c) => distance(c.x, c.y, p.x, p.y) < 18);
    if (cHit) {
      dragging = { type: "centroid", id: cHit.id };
      return;
    }
    const ptHit = points().find((pt) => distance(pt.x, pt.y, p.x, p.y) < 10);
    if (ptHit) {
      dragging = { type: "point", id: ptHit.id };
      return;
    }
    if (addMode()) {
      const nextPoint: KPoint = { id: `p-${Date.now()}`, x: clampX(p.x), y: clampY(p.y), cluster: null };
      const nextPoints = [nextPoint, ...points()];
      setPoints(nextPoints);
      setPointCount(nextPoints.length);
      if (centroids().length) assignClusters();
      persistDataset({ origin: "manual" });
    }
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    const p = pos(e);
    if (dragging.type === "centroid") {
      setCentroids((prev) => prev.map((c) => (c.id === dragging!.id ? { ...c, x: clampX(p.x), y: clampY(p.y) } : c)));
      if (initialized()) assignClusters();
    } else {
      setPoints((prev) => prev.map((pt) => (pt.id === dragging!.id ? { ...pt, x: clampX(p.x), y: clampY(p.y) } : pt)));
      if (initialized()) assignClusters();
    }
  };
  const up = async () => {
    if (dragging) {
      if (initialized()) await runToConvergence(10, 0.25);
      ctx.pushMessage("Samples repositioned. Discuss how assignments shifted.");
      persistDataset({ origin: "manual" });
    }
    dragging = null;
  };
  const dbl = () => {
    regenerate("Dataset reseeded for a fresh comparison.");
  };

  onMount(() => {
    ctx.canvas.addEventListener("pointerdown", down);
    ctx.canvas.addEventListener("pointermove", move);
    ctx.canvas.addEventListener("pointerup", up);
    ctx.canvas.addEventListener("dblclick", dbl);
    // initial state: unclustered
    ctx.pushMessage("Uninitialized: pick \"Initialize + iterate\" to run k-means.");
    const shared = datasetState();
    if (shared) {
      suppressSharedSync = true;
      hydrateFromDataset(shared);
      queueMicrotask(() => {
        suppressSharedSync = false;
      });
    } else {
      persistDataset({ origin: "generator" });
    }
  });

  onCleanup(() => {
    ctx.canvas.removeEventListener("pointerdown", down);
    ctx.canvas.removeEventListener("pointermove", move);
    ctx.canvas.removeEventListener("pointerup", up);
    ctx.canvas.removeEventListener("dblclick", dbl);
  });

  createEffect(() => {
    if (suppressSharedSync) return;
    const samples = colorSamples();
    const clusters = paletteK();
    if (!samples.length) {
      const hadPalette = Boolean(paletteSignature);
      paletteSignature = "";
      if (hadPalette) setPalette([]);
      setPaletteStatus(imagePreview() ? "" : "Upload an image to sample colors.");
      updatePaletteMarkers([]);
      return;
    }
    setPaletteStatus("Running color clustering…");
    let swatches = runColorKMeans(samples, clusters);
    if (!swatches.length) {
      swatches = buildFallbackPalette(samples, Math.min(6, Math.max(3, clusters)));
    }
    if (!swatches.length) {
      const hadPalette = Boolean(paletteSignature);
      paletteSignature = "";
      if (hadPalette) setPalette([]);
      setPaletteStatus("Not enough distinct colors to cluster.");
      updatePaletteMarkers([]);
      return;
    }
    const signature = swatches.map((swatch) => `${swatch.color}:${swatch.count}`).join("|");
    const preview = imagePreview();
    const markerSignature = preview ? preview.markers.map((marker) => `${marker.color}:${marker.x}:${marker.y}`).join("|") : "";
    if (signature !== paletteSignature || signature !== markerSignature) {
      paletteSignature = signature;
      setPalette(swatches);
      setPaletteStatus("");
      updatePaletteMarkers(swatches);
    } else {
      setPaletteStatus("");
    }
  });

    const clearPalette = () => {
    imageSampledPixels = [];
    setColorSamples([]);
    setPalette([]);
    setPaletteSource(null);
    setPaletteStatus("");
    setImagePreview(null);
  };

  async function handleImageSelection(file: File) {
    setPalette([]);
    setPaletteStatus("Loading image…");
    try {
      const { preview, samples, colors } = await extractImageSamples(file, { maxDimension: 240 });
      imageSampledPixels = samples;
      setPaletteSource(file.name);
      const previewMeta: ImagePreviewMeta = { ...preview, sourceName: file.name, markers: [] };
      setImagePreview(previewMeta);
      ctx.pushMessage(`Image palette: sampled ${samples.length} colors from ${preview.width}×${preview.height} image.`);
      setColorSamples(colors);
      const desired = paletteK();
      let immediate = runColorKMeans(colors, desired);
      if (!immediate.length) {
        immediate = buildFallbackPalette(colors, Math.min(6, Math.max(3, desired)));
      }
      if (immediate.length) {
        paletteSignature = immediate.map((swatch) => `${swatch.color}:${swatch.count}`).join("|");
        setPalette(immediate);
        setPaletteStatus("");
        updatePaletteMarkers(immediate);
      } else {
        setPaletteStatus("Not enough distinct colors to cluster.");
        updatePaletteMarkers([]);
      }
    } catch (err) {
      console.error(err);
      imageSampledPixels = [];
      setColorSamples([]);
      setPaletteSource(null);
      setImagePreview(null);
      const reason = err instanceof Error ? err.message : "Unknown error";
      setPaletteStatus(`Couldn't process that image. ${reason}`);
    }
  }

  // Expose API back to VisualizationModule wrapper
  props.onExpose({
    resize: (w: number, h: number) => {
      setWidth(Math.max(1, w));
      setHeight(Math.max(1, h));
    },
    setK: (v: number) => {
      const next = Math.max(1, Math.round(v));
      setK(next);
      setCentroids(initialCentroids(width(), height(), next));
      assignClusters();
    },
    setDistribution: (d: Distribution) => {
      setDistribution(d);
      regenerate(`Distribution set to ${d}.`);
    },
    setPointCount: (v: number) => {
      const dial = Math.max(10, Math.round(v));
      setPointCount(dial);
      regenerate(`Generated ${dial} samples.`);
    },
    animate: () => animateIteration(),
    randomize: () => regenerate("Dataset randomized with current settings."),
    reseed: () => {
      const shuffled = shuffle(points()).slice(0, k());
      setCentroids(shuffled.map((p, i) => ({ id: `c-${i}-${crypto.randomUUID()}`, x: p.x, y: p.y })));
      assignClusters();
      ctx.pushMessage("Centroids reseeded from current dataset.");
    },
  });

  return (
    <>
      {/* Top bar and dataset console */}
      
<Portal mount={ctx.controlsHost}>
  <div class="inspector-panel">
    <SharedDatasetControls
      pointCount={pointCount}
      onPointCountChange={(value) => {
        setPointCount(value);
        regenerate(`Generated ${value} samples.`);
      }}
      addMode={addMode}
      toggleAddMode={() => setAddMode(!addMode())}
      onNewLayout={() => regenerate("Dataset randomized with current settings.")}
      palette={{
        status: paletteStatus,
        imagePreview,
        palette,
        paletteK,
        onPaletteKChange: (value: number) => {
          const next = Math.max(2, Math.min(8, Math.round(value)));
          setPaletteK(next);
          syncImagePalette(next);
        },
        onUpload: handleImageSelection,
        onClear: clearPalette,
        uploadId: "kmeans-image",
      }}
    />

    <section class="inspector-section">
      <header class="inspector-section__header">
        <span class="eyebrow">K-means</span>
        <h2>Centroid iteration</h2>
        <p>Tune cluster count, regenerate samples, or seed colors from an image. Anything you change propagates to DBSCAN.</p>
      </header>

      <div class="inspector-section__controls">
        <div class="viz-field">
          <div class="viz-field__top">
            <label class="viz-field__label" for="kmeans-k">Clusters</label>
            <span class="viz-field__value">k = {k()}</span>
          </div>
          <input
            id="kmeans-k"
            type="range"
            min="1"
            max="8"
            step="1"
            value={k()}
            onInput={(e) => {
              const next = Number(e.currentTarget.value);
              setK(next);
              if (initialized()) {
                setCentroids(initialCentroids(width(), height(), next));
                runToConvergence(12, 0.25);
              }
            }}
          />
        </div>

        <div class="viz-field">
          <label class="viz-field__label" for="kmeans-dist">Distribution</label>
          <select
            id="kmeans-dist"
            value={distribution()}
            onChange={(e) => {
              const d = e.currentTarget.value as Distribution;
              setDistribution(d);
              regenerate(`Distribution set to ${d}.`);
            }}
          >
            <option value="gaussian">Gaussian blobs</option>
            <option value="uniform">Uniform</option>
            <option value="rings">Concentric rings</option>
            <option value="grid">Grid</option>
          </select>
        </div>
      </div>

      <div class="inspector-section__actions">
        <button
          class="viz-button"
          type="button"
          disabled={running()}
          onClick={animateIteration}
          title="Initialize centroids, assign points, update centroids"
        >
          {running() ? "Optimizing…" : "Initialize + iterate"}
        </button>
        <button
          type="button"
          class="viz-chip"
          onClick={() => {
            const sh = shuffle(points()).slice(0, k());
            setCentroids(sh.map((p, i) => ({ id: `c-${i}-${crypto.randomUUID()}`, x: p.x, y: p.y })));
            assignClusters();
            ctx.pushMessage("Centroids reseeded from current dataset.");
            persistDataset();
          }}
        >
          Reseed centroids
        </button>
      </div>

      <div class="inspector-section__meta">
        <div class="viz-meta">
          <span class="viz-meta__label">Points</span>
          <strong>{points().length}</strong>
        </div>
        <div class="viz-meta">
          <span class="viz-meta__label">Distribution</span>
          <strong>{distribution()}</strong>
        </div>
        <div class="viz-meta">
          <span class="viz-meta__label">Origin</span>
          <strong>{originLabel()}</strong>
        </div>
      </div>
    </section>
  </div>
</Portal>


      {/* Visualization overlay */}
      <Portal mount={ctx.overlay}>
        <svg
          class="kmeans-svg"
          width={width()}
          height={height()}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onDblClick={dbl}
          style={{ "touch-action": "none" }}
        >
          <For each={points()}>
            {(p) => {
              const palette = [
                "#2563eb",
                "#16a34a",
                "#f97316",
                "#dc2626",
                "#0ea5e9",
                "#a855f7",
                "#10b981",
                "#e11d48",
              ];
              const fill = p.cluster == null ? "#94a3b8" : palette[p.cluster % palette.length];
              return (
                <circle
                  class="point"
                  cx={p.x}
                  cy={p.y}
                  r={7}
                  fill={fill}
                  stroke="rgba(15, 23, 42, 0.65)"
                  stroke-width={1.6}
                  style={{ filter: "drop-shadow(0 1px 1px rgba(15, 23, 42, 0.18))" }}
                />
              );
            }}
          </For>
          <For each={centroids()}>
            {(c, i) => {
              const palette = [
                "#2563eb",
                "#16a34a",
                "#f97316",
                "#dc2626",
                "#0ea5e9",
                "#a855f7",
                "#10b981",
                "#e11d48",
              ];
              const stroke = palette[(typeof i === "function" ? i() : (i as unknown as number)) % palette.length];
              return (
                <circle
                  class="centroid"
                  cx={c.x}
                  cy={c.y}
                  r={11}
                  fill="#ffffff"
                  stroke={stroke}
                  stroke-width={3}
                  style={{ filter: "drop-shadow(0 1px 2px rgba(15, 23, 42, 0.2))" }}
                />
              );
            }}
          </For>
        </svg>
      </Portal>
    </>
  );
}

export const kMeansSolidDefinition: VisualizationDefinition = {
  id: "kmeans",
  label: "K-Means Clustering",
  summary: "Solid-driven k-means: drag samples/centroids and tune parameters.",
  keywords: ["clustering", "unsupervised", "centroid"],
  order: 1,
  create: (ctx: VisualizationContext): VisualizationModule => {
    let cleanup: (() => void) | null = null;
    let api: any = {};
    return {
      start() {
        cleanup = render(() => <KMeansApp ctx={ctx} onExpose={(ex) => (api = ex)} />, ctx.controlsHost);
      },
      stop() {
        cleanup?.();
        cleanup = null;
      },
      destroy() {
        cleanup?.();
        cleanup = null;
      },
      resize(w: number, h: number) {
        api?.resize?.(w, h);
      },
    };
  },
};
