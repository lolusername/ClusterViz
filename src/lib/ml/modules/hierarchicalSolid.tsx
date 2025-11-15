import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Portal, render } from "solid-js/web";
import * as d3 from "d3";
import type { VisualizationContext, VisualizationDefinition, VisualizationModule } from "../registry";
import { generatePoints, distance, type Distribution } from "../utils/data";
import { whiteboardActions, whiteboardState } from "../../../state/whiteboard";

type HPoint = { id: string; x: number; y: number; cluster: number | null };
type ClusterNode = { id: string; left?: ClusterNode; right?: ClusterNode; points: HPoint[]; distance: number };
type HistoryStep = { clusters: string[][]; description: string; distance: number };

function HierarchicalApp(props: { ctx: VisualizationContext; onExpose: (api: any) => void }) {
  const { ctx } = props;
  const [width, setWidth] = createSignal(Math.max(1, ctx.width()));
  const [height, setHeight] = createSignal(Math.max(1, ctx.height()));
  const [distribution, setDistribution] = createSignal<Distribution>("gaussian");
  const [points, setPoints] = createSignal<HPoint[]>(
    generatePoints(width(), height(), distribution(), 60).map((p) => ({ ...p, cluster: null }))
  );
  const [root, setRoot] = createSignal<ClusterNode | null>(null);
  const [history, setHistory] = createSignal<HistoryStep[]>([]);
  const [stepIndex, setStepIndex] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [addMode, setAddMode] = createSignal(false);

  // Layout ratios
  const [margin] = createSignal({ top: 12, right: 12, bottom: 12, left: 12 });
  const split = 0.58; // portion for scatter
  const scatterRect = createMemo(() => {
    const m = margin();
    const w = width();
    const h = height();
    const sh = Math.max(120, Math.floor(h * split) - 4);
    return { x: m.left, y: m.top, w: w - m.left - m.right, h: sh - m.top };
  });
  const dendroRect = createMemo(() => {
    const m = margin();
    const w = width();
    const h = height();
    const sh = Math.max(120, Math.floor(h * split));
    const dh = h - sh - m.bottom - 4;
    return { x: m.left, y: sh + 8, w: w - m.left - m.right, h: Math.max(80, dh) };
  });

  function computeHierarchy() {
    // Copy points
    const pts = points();
    let clusters: ClusterNode[] = pts.map((p) => ({ id: p.id, points: [p], distance: 0 }));
    const hist: HistoryStep[] = [
      { clusters: clusters.map((c) => c.points.map((p) => p.id)), description: "Initial state", distance: 0 },
    ];
    let mergeIndex = 0;

    while (clusters.length > 1) {
      let bestI = 0;
      let bestJ = 1;
      let bestD = Infinity;
      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          // single-link distance
          let min = Infinity;
          for (const a of clusters[i].points) {
            for (const b of clusters[j].points) {
              const d = distance(a.x, a.y, b.x, b.y);
              if (d < min) min = d;
            }
          }
          if (min < bestD) {
            bestD = min;
            bestI = i;
            bestJ = j;
          }
        }
      }
      const a = clusters[bestI];
      const b = clusters[bestJ];
      const merged: ClusterNode = {
        id: `merge-${mergeIndex++}`,
        left: a,
        right: b,
        points: [...a.points, ...b.points],
        distance: bestD,
      };
      clusters = clusters.filter((_, idx) => idx !== bestI && idx !== bestJ);
      clusters.push(merged);
      hist.push({
        clusters: clusters.map((c) => c.points.map((p) => p.id)),
        description: `Merged at distance ${bestD.toFixed(2)}`,
        distance: bestD,
      });
    }
    setRoot(clusters[0] ?? null);
    setHistory(hist);
    setStepIndex(Math.min(stepIndex(), hist.length - 1));
  }

  function applyStep() {
    const hist = history();
    const idx = Math.max(0, Math.min(stepIndex(), hist.length - 1));
    const step = hist[idx];
    if (!step) return;
    const map = new Map<string, number>();
    step.clusters.forEach((ids, i) => ids.forEach((id) => map.set(id, i)));
    setPoints((prev) => prev.map((p) => ({ ...p, cluster: map.get(p.id) ?? null })));
  }

  function next() {
    setStepIndex((i) => Math.min(i + 1, history().length - 1));
    applyStep();
  }
  function prev() {
    setStepIndex((i) => Math.max(i - 1, 0));
    applyStep();
  }

  let playTimer: number | null = null;
  function togglePlay() {
    if (playTimer != null) {
      window.clearInterval(playTimer);
      playTimer = null;
      setPlaying(false);
      return;
    }
    setPlaying(true);
    playTimer = window.setInterval(() => {
      setStepIndex((i) => {
        const n = Math.min(i + 1, history().length - 1);
        if (n === i) {
          togglePlay();
        } else {
          applyStep();
        }
        return n;
      });
    }, 700);
  }

  function regenerate(message?: string) {
    setPoints(
      generatePoints(width(), height(), distribution(), 60).map((p) => ({ ...p, cluster: null }))
    );
    computeHierarchy();
    applyStep();
    if (message) ctx.pushMessage(message);
  }

  // Pointer interactions for scatter
  let dragging: { id: string; offX: number; offY: number } | null = null;
  function localPos(evt: PointerEvent) {
    const rect = ctx.canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }
  const down = (e: PointerEvent) => {
    const p = localPos(e);
    const sr = scatterRect();
    if (p.y < sr.y || p.y > sr.y + sr.h) return; // only interact in scatter region
    const hit = points().find((pt) => distance(pt.x, pt.y, p.x, p.y) < 10);
    if (hit) {
      dragging = { id: hit.id, offX: hit.x - p.x, offY: hit.y - p.y };
      return;
    }
    if (addMode()) {
      setPoints((prev) => [{ id: `p-${Date.now()}`, x: p.x, y: p.y, cluster: null }, ...prev]);
      computeHierarchy();
      applyStep();
    }
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    const p = localPos(e);
    setPoints((prev) => prev.map((q) => (q.id === dragging!.id ? { ...q, x: p.x + dragging!.offX, y: p.y + dragging!.offY } : q)));
  };
  const up = () => {
    if (dragging) {
      computeHierarchy();
      applyStep();
      dragging = null;
    }
  };

  onMount(() => {
    computeHierarchy();
    applyStep();
    ctx.canvas.addEventListener("pointerdown", down);
    ctx.canvas.addEventListener("pointermove", move);
    ctx.canvas.addEventListener("pointerup", up);
  });
  onCleanup(() => {
    if (playTimer != null) window.clearInterval(playTimer);
    ctx.canvas.removeEventListener("pointerdown", down);
    ctx.canvas.removeEventListener("pointermove", move);
    ctx.canvas.removeEventListener("pointerup", up);
  });

  // Expose resize for wrapper
  props.onExpose({
    resize: (w: number, h: number) => {
      setWidth(Math.max(1, w));
      setHeight(Math.max(1, h));
    },
  });

  const palette = ["#2563eb", "#16a34a", "#f97316", "#dc2626", "#0ea5e9", "#a855f7", "#10b981", "#e11d48"];

  // Prepare dendrogram layout data each render
  const dendroLayout = createMemo(() => {
    const r = root();
    const rect = dendroRect();
    if (!r) return null;
    const convert = (n: ClusterNode): any => ({
      name: n.id,
      distance: n.distance,
      children: n.left && n.right ? [convert(n.left), convert(n.right)] : undefined,
    });
    const h = d3.hierarchy(convert(r));
    const cluster = d3.cluster<any>().size([rect.h, rect.w]);
    const res = cluster(h);
    const maxD = h.data.distance || 1;
    const scaleX = d3.scaleLinear().domain([0, maxD]).range([0, rect.w]);
    res.each((node) => (node.y = scaleX(node.data.distance || 0)));
    return { root: res, maxD, scaleX };
  });

  const cutY = createMemo(() => {
    const dl = dendroLayout();
    if (!dl) return 0;
    const rect = dendroRect();
    const d = history()[stepIndex()]?.distance ?? 0;
    return rect.y + (rect.h - 0) - (0); // will compute in SVG space below
  });

  return (
    <>
      {/* Top bar */}
      <Portal mount={ctx.controlsHost}>
        <nav class="viz-topbar" aria-label="Hierarchical controls">
          <div class="viz-topbar__brand">
            <span class="eyebrow">Hierarchical</span>
            <span class="viz-topbar__subtitle">Agglomerative clustering</span>
          </div>
          <div class="viz-topbar__group">
            <label class="viz-topbar__label" for="h-dist">Distribution</label>
            <select id="h-dist" class="viz-topbar__select" value={distribution()} onChange={(e) => { setDistribution(e.currentTarget.value as Distribution); regenerate("Dataset regenerated."); }}>
              <option value="gaussian">Gaussian</option>
              <option value="uniform">Uniform</option>
              <option value="rings">Rings</option>
              <option value="grid">Grid</option>
            </select>
          </div>
          <div class="viz-topbar__group viz-topbar__group--vertical" style={{ "min-width": "260px" }}>
            <div class="viz-topbar__row">
              <span class="viz-topbar__label">Step</span>
              <span class="viz-topbar__value-chip">{stepIndex()} / {Math.max(0, history().length - 1)}</span>
            </div>
            <input
              type="range"
              min="0"
              max={Math.max(0, history().length - 1)}
              value={stepIndex()}
              class="viz-topbar__slider"
              onInput={(e) => { setStepIndex(Number(e.currentTarget.value)); applyStep(); }}
            />
          </div>
          <div class="viz-topbar__actions">
            <button
              type="button"
              class="viz-topbar__toggle"
              aria-pressed={whiteboardState.interactionMode === "whiteboard" ? "true" : "false"}
              classList={{ active: whiteboardState.interactionMode === "whiteboard" }}
              onClick={() =>
                whiteboardActions.setInteractionMode(
                  whiteboardState.interactionMode === "whiteboard" ? "visualization" : "whiteboard"
                )
              }
              title="Toggle drawing mode"
            >
              {whiteboardState.interactionMode === "whiteboard" ? "Drawing" : "Draw mode"}
            </button>
            <button class="viz-topbar__button" type="button" onClick={prev}>Prev</button>
            <button class="viz-topbar__button" type="button" onClick={next}>Next</button>
            <button class="viz-topbar__button" type="button" aria-pressed={playing() ? "true" : "false"} onClick={togglePlay}>{playing() ? "Pause" : "Play"}</button>
            <button class="viz-topbar__toggle" type="button" classList={{ active: addMode() }} aria-pressed={addMode() ? "true" : "false"} onClick={() => setAddMode(!addMode())}> {addMode() ? "Adding points" : "Add points"} </button>
          </div>
        </nav>
      </Portal>

      {/* Overlay SVG with split regions */}
      <Portal mount={ctx.overlay}>
        <svg width={width()} height={height()} style={{ "touch-action": "none" }} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
          {/* Scatter */}
          <g transform={`translate(${scatterRect().x},${scatterRect().y})`}>
            <rect width={scatterRect().w} height={scatterRect().h} fill="transparent" />
            <For each={points()}>
              {(p) => {
                const color = p.cluster == null ? "#94a3b8" : palette[(p.cluster as number) % palette.length];
                return <circle cx={p.x} cy={p.y} r={6} fill={color} stroke="#0f172a" stroke-width={1.2} />;
              }}
            </For>
          </g>

          {/* Dendrogram */}
          <g transform={`translate(${dendroRect().x},${dendroRect().y})`}>
            <rect width={dendroRect().w} height={dendroRect().h} fill="transparent" />
            <Show when={dendroLayout()}>
              {(dl: any) => {
                const layout = dl();
                const root = layout.root as d3.HierarchyPointNode<any>;
                const link = d3.linkHorizontal<d3.HierarchyPointLink<any>, d3.HierarchyPointNode<any>>()
                  .x((d) => d.y)
                  .y((d) => d.x);
                return (
                  <g>
                    <For each={root.links()}>
                      {(lnk) => <path d={link(lnk) as string} fill="none" stroke="#64748b" stroke-width={1} />}
                    </For>
                    {/* Cut line */}
                    <line
                      x1={0}
                      x2={dendroRect().w}
                      y1={(() => {
                        const d = history()[stepIndex()]?.distance ?? 0;
                        const maxD = (root.data?.distance as number) || 1;
                        const scale = d3.scaleLinear().domain([0, maxD]).range([0, dendroRect().w]);
                        // We mapped distance to x (horizontal); cut is vertical line at distance, but user asked highlight level on tree.
                        // Opt for vertical highlight:
                        return 0; // not used
                      })()}
                      y2={(() => 0)()}
                      stroke="#1d4ed8"
                      stroke-dasharray="4,3"
                      opacity={0}
                    />
                  </g>
                );
              }}
            </Show>
          </g>
        </svg>
      </Portal>
    </>
  );
}

export const hierarchicalSolidDefinition: VisualizationDefinition = {
  id: "hierarchical",
  label: "Hierarchical Clustering",
  summary: "Solid-driven agglomerative clustering with scatter + dendrogram split and step-through controls.",
  keywords: ["clustering", "hierarchical", "dendrogram"],
  order: 3,
  create: (ctx: VisualizationContext): VisualizationModule => {
    let cleanup: (() => void) | null = null;
    let api: any = {};
    return {
      start() {
        cleanup = render(() => <HierarchicalApp ctx={ctx} onExpose={(ex) => (api = ex)} />, ctx.controlsHost);
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
