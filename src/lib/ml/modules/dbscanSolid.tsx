import { For, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Portal, render } from "solid-js/web";
import type { VisualizationContext, VisualizationDefinition, VisualizationModule } from "../registry";
import { generatePoints, distance, type Distribution } from "../utils/data";
import { whiteboardActions, whiteboardState } from "../../../state/whiteboard";
import { datasetActions, datasetState, createDataset } from "../../../state/dataset";
import type { SharedDataset } from "../../../state/dataset";
import { instantiateDatasetPoints, toSharedPoints } from "../../../utils/dataset";
import { SharedDatasetControls } from "./SharedDatasetControls";
import { buildFallbackPalette, extractImageSamples, runColorKMeans, type ImagePreviewMeta, type PaletteSwatch, type SampledPixel, type RGB } from "./paletteUtils";

type DBPoint = {
  id: string;
  x: number;
  y: number;
  cluster: number | null;
  type: "core" | "border" | "noise" | "unclassified";
};

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

function DbscanApp(props: { ctx: VisualizationContext; onExpose: (api: any) => void }) {
  const { ctx } = props;
  const [width, setWidth] = createSignal(Math.max(1, ctx.width()));
  const [height, setHeight] = createSignal(Math.max(1, ctx.height()));
  const [epsilon, setEpsilon] = createSignal(80);
  const [minPts, setMinPts] = createSignal(4);
  const [distribution, setDistribution] = createSignal<Distribution>("gaussian");
  const [pointCount, setPointCount] = createSignal(120);
  const [points, setPoints] = createSignal<DBPoint[]>(
    generatePoints(width(), height(), distribution(), pointCount()).map((p) => ({ ...p, cluster: null, type: "unclassified" }))
  );
  const [addMode, setAddMode] = createSignal(false);
  const [colorSamples, setColorSamples] = createSignal<RGB[]>([]);
  const [palette, setPalette] = createSignal<PaletteSwatch[]>([]);
  const [paletteStatus, setPaletteStatus] = createSignal("");
  const [imagePreview, setImagePreview] = createSignal<ImagePreviewMeta | null>(null);
  let imageSampledPixels: SampledPixel[] = [];
  let paletteSignature = "";
  const [datasetOrigin, setDatasetOrigin] = createSignal<SharedDataset["origin"]>("generator");
  let suppressSharedSync = false;

  const hydrateFromDataset = (shared: SharedDataset) => {
    setDatasetOrigin(shared.origin);
    const adapted = instantiateDatasetPoints(shared, width(), height());
    setPoints(
      adapted.map((point) => ({
        id: point.id,
        x: point.x,
        y: point.y,
        cluster: null,
        type: "unclassified" as const,
      }))
    );
    setPointCount(adapted.length);
    if (shared.palettePreview) {
      imageSampledPixels = shared.palettePreview.pixels.map((pixel) => {
        const rgb = parseRgb(pixel.color) ?? [0, 0, 0];
        return { color: rgb as RGB, x: pixel.x, y: pixel.y };
      });
      setImagePreview({
        url: shared.palettePreview.imageDataUrl,
        width: shared.palettePreview.width,
        height: shared.palettePreview.height,
        sourceName: shared.palettePreview.sourceName,
        markers: shared.palettePreview.pixels.map((pixel) => ({
          x: pixel.x,
          y: pixel.y,
          color: pixel.color,
        })),
      });
      if (shared.paletteSwatches?.length) {
        paletteSignature = shared.paletteSwatches.map((swatch) => `${swatch.color}:${swatch.count}`).join("|");
        setPalette(shared.paletteSwatches);
      } else {
        paletteSignature = "";
        setPalette([]);
      }
    } else {
      imageSampledPixels = [];
      setImagePreview(null);
      setPalette([]);
      paletteSignature = "";
    }
  };

  function persistDataset(options?: { origin?: SharedDataset["origin"]; clearPreview?: boolean; preview?: ImagePreviewMeta | null }) {
    suppressSharedSync = true;
    if (options?.origin) setDatasetOrigin(options.origin);
    const base = datasetState();
    const targetPreview = options?.clearPreview ? null : options?.preview ?? imagePreview();
    const dataset = createDataset({
      id: base?.id,
      origin: datasetOrigin(),
      width: width(),
      height: height(),
      distribution: distribution(),
      points: toSharedPoints(points()),
      palettePreview: targetPreview
        ? {
            imageDataUrl: targetPreview.url,
            sourceName: targetPreview.sourceName,
            width: targetPreview.width,
            height: targetPreview.height,
            pixels: targetPreview.markers.map((marker) => ({
              x: marker.x,
              y: marker.y,
              color: marker.color,
            })),
          }
        : undefined,
      paletteSwatches: palette().map((swatch) => ({ ...swatch })),
    });
    datasetActions.save(dataset);
    queueMicrotask(() => {
      suppressSharedSync = false;
    });
  }

  const clearPalette = () => {
    imageSampledPixels = [];
    setColorSamples([]);
    setPalette([]);
    setPaletteStatus("");
    setImagePreview(null);
    persistDataset({ clearPreview: true });
  };

  function updatePaletteMarkers(swatches: PaletteSwatch[]) {
    const preview = imagePreview();
    if (!preview) {
      persistDataset();
      return;
    }
    if (!swatches.length || !imageSampledPixels.length) {
      const nextPreview = { ...preview, markers: [] };
      setImagePreview(nextPreview);
      persistDataset({ preview: nextPreview });
      return;
    }
    const available = [...imageSampledPixels];
    const markers: { x: number; y: number; color: string }[] = [];
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
      markers.push({ x: match.x, y: match.y, color: swatch.color });
    }
    const nextPreview = { ...preview, markers };
    setImagePreview(nextPreview);
    persistDataset({ preview: nextPreview });
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

  const clusterCount = () => {
    const unique = new Set<number>();
    for (const point of points()) {
      if (point.cluster != null) unique.add(point.cluster);
    }
    return unique.size;
  };

  const noiseCount = () => points().filter((p) => p.type === "noise").length;

  const clearLabels = () => {
    setPoints((prev) => prev.map((point) => ({ ...point, cluster: null, type: "unclassified" })));
    persistDataset();
  };

  createEffect(() => {
    const shared = datasetState();
    if (!shared) return;
    if (suppressSharedSync) return;
    hydrateFromDataset(shared);
  });

  createEffect(() => {
    if (suppressSharedSync) return;
    const samples = colorSamples();
    const targetClusters = Math.max(3, Math.min(6, Math.round(pointCount() / 60)));
    if (!samples.length) {
      const hadPalette = Boolean(paletteSignature);
      paletteSignature = "";
      if (hadPalette) setPalette([]);
      setPaletteStatus(imagePreview() ? "" : "Upload an image to sample colors.");
      updatePaletteMarkers([]);
      return;
    }
    setPaletteStatus("Running color clustering…");
    let swatches = runColorKMeans(samples, targetClusters);
    if (!swatches.length) {
      swatches = buildFallbackPalette(samples, targetClusters);
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

  function regenerate(message?: string) {
    setPoints(
      generatePoints(width(), height(), distribution(), pointCount()).map((p) => ({ ...p, cluster: null, type: "unclassified" }))
    );
    setDatasetOrigin("generator");
    clearPalette();
    if (message) ctx.pushMessage(message);
  }

  async function handleImageSelection(file: File) {
    setPalette([]);
    setPaletteStatus("Loading image…");
    try {
      const { preview, samples, colors } = await extractImageSamples(file, { maxDimension: 240 });
      imageSampledPixels = samples;
      const previewMeta: ImagePreviewMeta = { ...preview, sourceName: file.name, markers: [] };
      setImagePreview(previewMeta);
      setDatasetOrigin("image");
      ctx.pushMessage(`Image palette: sampled ${samples.length} colors from ${preview.width}×${preview.height} image.`);
      setColorSamples(colors);
      const targetClusters = Math.max(3, Math.min(6, Math.round(pointCount() / 60)));
      let immediate = runColorKMeans(colors, targetClusters);
      if (!immediate.length) {
        immediate = buildFallbackPalette(colors, targetClusters);
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
      persistDataset({ origin: "image", preview: previewMeta });
    } catch (err) {
      console.error(err);
      imageSampledPixels = [];
      setColorSamples([]);
      setImagePreview(null);
      const reason = err instanceof Error ? err.message : "Unknown error";
      setPaletteStatus(`Couldn't process that image. ${reason}`);
      persistDataset({ clearPreview: true });
    }
  }

  function runDbscan() {
    const eps = epsilon();
    const min = minPts();
    const pts = points().map((p) => ({ ...p, cluster: null, type: "unclassified" as const }));
    const visited = new Set<string>();
    let cluster = 0;

    const regionQuery = (origin: DBPoint) => pts.filter((q) => distance(q.x, q.y, origin.x, origin.y) <= eps);

    const expand = (seed: DBPoint, neighbors: DBPoint[], id: number) => {
      seed.cluster = id;
      seed.type = "core";
      const queue = [...neighbors];
      while (queue.length) {
        const current = queue.shift()!;
        if (!visited.has(current.id)) {
          visited.add(current.id);
          const neigh = regionQuery(current);
          if (neigh.length >= min) {
            current.type = "core";
            for (const n of neigh) if (!queue.includes(n)) queue.push(n);
          }
        }
        if (current.cluster == null) {
          current.cluster = id;
          if (current.type !== "core") current.type = "border";
        }
      }
    };

    for (const p of pts) {
      if (visited.has(p.id)) continue;
      visited.add(p.id);
      const neigh = regionQuery(p);
      if (neigh.length < min) {
        p.type = "noise";
        continue;
      }
      cluster += 1;
      expand(p, neigh, cluster);
    }

    setPoints(pts);
    ctx.pushMessage(`DBSCAN: ${cluster} clusters, ${pts.filter((p) => p.type === "noise").length} noise points.`);
    persistDataset();
  }

  // Pointer interactions
  let dragging: { point: DBPoint; offX: number; offY: number } | null = null;
  function localPos(evt: PointerEvent) {
    const rect = ctx.canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }
  const down = (e: PointerEvent) => {
    const p = localPos(e);
    const hit = points().find((pt) => distance(pt.x, pt.y, p.x, p.y) < 12);
    if (hit) {
      dragging = { point: hit, offX: hit.x - p.x, offY: hit.y - p.y };
      return;
    }
    if (addMode()) {
      const newPoint: DBPoint = { id: `p-${Date.now()}`, x: p.x, y: p.y, cluster: null, type: "unclassified" };
      const nextPoints = [newPoint, ...points()];
      setPoints(nextPoints);
      persistDataset({ origin: "manual" });
    }
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    const p = localPos(e);
    const { point, offX, offY } = dragging;
    setPoints((prev) => prev.map((q) => (q.id === point.id ? { ...q, x: p.x + offX, y: p.y + offY } : q)));
  };
  const up = () => {
    if (dragging) {
      runDbscan();
      dragging = null;
      persistDataset({ origin: "manual" });
    }
  };

  onMount(() => {
    // canvas is under overlay; bind to overlay SVG for reliability in case overlay captures events
    // The SVG itself will receive handlers via JSX below, but keep canvas listeners as fallback.
    ctx.canvas.addEventListener("pointerdown", down);
    ctx.canvas.addEventListener("pointermove", move);
    ctx.canvas.addEventListener("pointerup", up);
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
  });

  // Expose for wrapper
  props.onExpose({
    resize: (w: number, h: number) => {
      setWidth(Math.max(1, w));
      setHeight(Math.max(1, h));
      persistDataset();
    },
  });

  const paletteColors = ["#2563eb", "#16a34a", "#f97316", "#dc2626", "#0ea5e9", "#a855f7", "#10b981", "#e11d48"];

  return (
    <>
      
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
      onNewLayout={() => regenerate("Dataset randomized.")}
      palette={{
        status: paletteStatus,
        imagePreview,
        palette,
        onUpload: handleImageSelection,
        onClear: clearPalette,
        uploadId: "dbscan-image",
      }}
    />

    <section class="inspector-section">
      <header class="inspector-section__header">
        <span class="eyebrow">DBSCAN</span>
        <h2>Density clustering</h2>
        <p>Adjust ε and MinPts to surface dense regions and understand how density shapes clusters.</p>
      </header>

      <div class="inspector-section__controls">
        <div class="viz-field">
          <div class="viz-field__top">
            <label class="viz-field__label" for="db-eps">ε radius</label>
            <span class="viz-field__value">{epsilon().toFixed(0)}</span>
          </div>
          <input
            id="db-eps"
            type="range"
            min="20"
            max="160"
            value={epsilon()}
            onInput={(e) => setEpsilon(Number(e.currentTarget.value))}
          />
        </div>

        <div class="viz-field">
          <div class="viz-field__top">
            <label class="viz-field__label" for="db-min">MinPts</label>
            <span class="viz-field__value">{minPts()}</span>
          </div>
          <input
            id="db-min"
            type="range"
            min="2"
            max="12"
            value={minPts()}
            onInput={(e) => setMinPts(Number(e.currentTarget.value))}
          />
        </div>

        <div class="viz-field">
          <label class="viz-field__label" for="db-dist">Distribution</label>
          <select
            id="db-dist"
            value={distribution()}
            onChange={(e) => {
              setDistribution(e.currentTarget.value as Distribution);
              regenerate("Dataset randomized.");
            }}
          >
            <option value="gaussian">Gaussian</option>
            <option value="uniform">Uniform</option>
            <option value="rings">Rings</option>
            <option value="grid">Grid</option>
          </select>
        </div>
      </div>

      <div class="inspector-section__actions">
        <button class="viz-button" type="button" onClick={runDbscan}>
          Run clustering
        </button>
        <button type="button" class="viz-chip" onClick={clearLabels}>
          Clear labels
        </button>
        <button type="button" class="viz-chip" onClick={() => regenerate("Dataset randomized.")}>
          Randomize layout
        </button>
      </div>

      <div class="inspector-section__meta">
        <div class="viz-meta">
          <span class="viz-meta__label">Points</span>
          <strong>{points().length}</strong>
        </div>
        <div class="viz-meta">
          <span class="viz-meta__label">Clusters</span>
          <strong>{clusterCount()}</strong>
        </div>
        <div class="viz-meta">
          <span class="viz-meta__label">Noise</span>
          <strong>{noiseCount()}</strong>
        </div>
        <div class="viz-meta">
          <span class="viz-meta__label">Origin</span>
          <strong>{originLabel()}</strong>
        </div>
      </div>
    </section>
  </div>
</Portal>


      <Portal mount={ctx.overlay}>
        <svg
          class="dbscan-svg"
          width={width()}
          height={height()}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          style={{ "touch-action": "none" }}
        >
          <For each={points()}>
            {(p) => {
              const fill = p.cluster == null ? "#94a3b8" : paletteColors[(p.cluster - 1) % paletteColors.length];
              const stroke = p.type === "noise" ? "#475569" : "#0f172a";
              const dash = p.type === "noise" ? "3,2" : undefined;
              const opacity = p.type === "noise" ? 0.6 : 0.9;
              return (
                <circle
                  class="point"
                  cx={p.x}
                  cy={p.y}
                  r={7}
                  fill={fill}
                  stroke={stroke}
                  stroke-width={1.4}
                  stroke-dasharray={dash}
                  opacity={opacity}
                  style={{ filter: "drop-shadow(0 1px 1px rgba(15, 23, 42, 0.18))" }}
                />
              );
            }}
          </For>
        </svg>
      </Portal>
    </>
  );
}

export const dbscanSolidDefinition: VisualizationDefinition = {
  id: "dbscan",
  label: "DBSCAN Clustering",
  summary: "Solid-driven DBSCAN. Adjust ε and MinPts, drag/add points, and run.",
  keywords: ["clustering", "density", "unsupervised"],
  order: 2,
  create: (ctx: VisualizationContext): VisualizationModule => {
    let cleanup: (() => void) | null = null;
    let api: any = {};
    return {
      start() {
        cleanup = render(() => <DbscanApp ctx={ctx} onExpose={(ex) => (api = ex)} />, ctx.controlsHost);
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
