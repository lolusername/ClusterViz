import * as d3 from "d3";
import type { VisualizationContext, VisualizationDefinition, VisualizationModule } from "../registry";
import { generatePoints, distance, type Distribution } from "../utils/data";

type HPoint = {
  id: string;
  x: number;
  y: number;
  cluster: number | null;
};

type ClusterNode = {
  id: string;
  left?: ClusterNode;
  right?: ClusterNode;
  points: HPoint[];
  distance: number;
};

type HistoryStep = {
  clusters: string[][];
  description: string;
  distance: number;
};

export class HierarchicalModule implements VisualizationModule {
  private context: VisualizationContext;
  private points: HPoint[] = [];
  private pointById = new Map<string, HPoint>();
  private root: ClusterNode | null = null;
  private history: HistoryStep[] = [];
  private stepIndex = 0;
  private clusterTarget = 3;
  private distribution: Distribution = "gaussian";

  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
  private controls: HTMLDivElement | null = null;
  private clusterSlider: HTMLInputElement | null = null;
  private clusterLabel: HTMLElement | null = null;
  private stepSlider: HTMLInputElement | null = null;
  private stepLabel: HTMLElement | null = null;
  private playButton: HTMLButtonElement | null = null;
  private playTimer: number | null = null;

  private dragging: { point: HPoint; offsetX: number; offsetY: number } | null = null;
  private scatterBounds = { minX: 16, maxX: 16, minY: 16, maxY: 16 };

  constructor(context: VisualizationContext) {
    this.context = context;
  }

  start() {
    this.updateScatterBounds();
    this.generatePoints();
    this.computeHierarchy();
    this.goToStep(this.findStepForClusterCount(this.clusterTarget), false);
    this.setupSvg();
    this.setupControls();
    this.render();
    this.context.pushMessage("Agglomerative clustering starts with every point as its own cluster, then merges the closest pairs.");
  }

  stop() {
    this.stopPlay();
    this.destroyControls();
  }

  destroy() {
    this.stopPlay();
    this.svg?.remove();
    this.destroyControls();
  }

  resize(width: number, height: number) {
    this.updateScatterBounds();
    this.points.forEach((point) => {
      point.x = this.clampX(point.x);
      point.y = this.clampY(point.y);
    });
    this.computeHierarchy();
    this.goToStep(this.stepIndex, false);
    this.svg?.attr("width", width).attr("height", height);
    this.updateControlsUI();
  }

  private updateScatterBounds() {
    const width = this.context.width();
    const height = this.context.height();
    const scatterWidth = Math.max(120, width * 0.55);
    const scatterHeight = Math.max(120, height * 0.85);
    this.scatterBounds = {
      minX: 16,
      maxX: 16 + scatterWidth,
      minY: 16,
      maxY: 16 + scatterHeight,
    };
  }

  private clampX(x: number) {
    return Math.max(this.scatterBounds.minX, Math.min(this.scatterBounds.maxX, x));
  }

  private clampY(y: number) {
    return Math.max(this.scatterBounds.minY, Math.min(this.scatterBounds.maxY, y));
  }

  private pointerFromEvent(event: PointerEvent) {
    const rect = this.context.canvas.getBoundingClientRect();
    return {
      x: this.clampX(event.clientX - rect.left),
      y: this.clampY(event.clientY - rect.top),
    };
  }

  private generatePoints() {
    const scatterWidth = this.scatterBounds.maxX - this.scatterBounds.minX - 16;
    const scatterHeight = this.scatterBounds.maxY - this.scatterBounds.minY - 16;
    const raw = generatePoints(scatterWidth, scatterHeight, this.distribution, 60);
    this.points = raw.map((point) => ({
      id: point.id,
      x: this.scatterBounds.minX + 8 + point.x,
      y: this.scatterBounds.minY + 8 + point.y,
      cluster: null,
    }));
    this.pointById = new Map(this.points.map((point) => [point.id, point]));
    this.clusterTarget = Math.min(this.clusterTarget, Math.max(1, this.points.length));
  }

  private computeHierarchy() {
    this.pointById = new Map(this.points.map((point) => [point.id, point]));
    let clusters: ClusterNode[] = this.points.map((point) => ({
      id: point.id,
      points: [point],
      distance: 0,
    }));

    this.history = [
      {
        clusters: clusters.map((cluster) => cluster.points.map((point) => point.id)),
        description: "Initial state: each point is its own cluster.",
        distance: 0,
      },
    ];

    let mergeIndex = 0;
    while (clusters.length > 1) {
      let bestI = 0;
      let bestJ = 1;
      let bestDistance = Infinity;
      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          const dist = this.singleLinkDistance(clusters[i], clusters[j]);
          if (dist < bestDistance) {
            bestDistance = dist;
            bestI = i;
            bestJ = j;
          }
        }
      }

      const [clusterA, clusterB] = [clusters[bestI], clusters[bestJ]];
      const merged: ClusterNode = {
        id: `merge-${mergeIndex++}`,
        left: clusterA,
        right: clusterB,
        points: [...clusterA.points, ...clusterB.points],
        distance: bestDistance,
      };

      clusters = clusters.filter((_, index) => index !== bestI && index !== bestJ);
      clusters.push(merged);

      this.history.push({
        clusters: clusters.map((cluster) => cluster.points.map((point) => point.id)),
        description: `Merged two clusters (sizes ${clusterA.points.length} + ${clusterB.points.length}) at distance ${bestDistance.toFixed(2)}.`,
        distance: bestDistance,
      });
    }

    this.root = clusters[0] ?? null;
  }

  private singleLinkDistance(a: ClusterNode, b: ClusterNode) {
    let min = Infinity;
    for (const p of a.points) {
      for (const q of b.points) {
        const d = distance(p.x, p.y, q.x, q.y);
        if (d < min) min = d;
      }
    }
    return min;
  }

  private setupSvg() {
    this.svg?.remove();
    this.svg = d3
      .select(this.context.overlay)
      .append("svg")
      .attr("class", "hierarchical-svg")
      .attr("width", this.context.width())
      .attr("height", this.context.height());

    const canvas = this.context.canvas;
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("pointerleave", this.handlePointerUp);
  }

  private destroyControls() {
    if (this.controls) {
      this.controls.remove();
      this.controls = null;
    }
    this.clusterSlider = null;
    this.clusterLabel = null;
    this.stepSlider = null;
    this.stepLabel = null;
    this.playButton = null;

    const canvas = this.context.canvas;
    canvas.removeEventListener("pointerdown", this.handlePointerDown);
    canvas.removeEventListener("pointermove", this.handlePointerMove);
    canvas.removeEventListener("pointerup", this.handlePointerUp);
    canvas.removeEventListener("pointerleave", this.handlePointerUp);
  }

  private setupControls() {
    this.destroyControls();
    const host = this.context.controlsHost;
    const bar = document.createElement("div");
    bar.className = "viz-topbar";

    const clusterSliderId = `hierarchical-clusters-${crypto.randomUUID()}`;
    const stepSliderId = `hierarchical-steps-${crypto.randomUUID()}`;
    const distributionSelectId = `hierarchical-dist-${crypto.randomUUID()}`;

    const brand = document.createElement("div");
    brand.className = "viz-topbar__brand";
    brand.innerHTML = `<span class="eyebrow">Hierarchical</span><span class="viz-topbar__subtitle">Merge walkthrough</span>`;
    bar.appendChild(brand);

    const clusterGroup = document.createElement("div");
    clusterGroup.className = "viz-topbar__group viz-topbar__group--slider";
    const clusterLabel = document.createElement("label");
    clusterLabel.className = "viz-topbar__label";
    clusterLabel.setAttribute("for", clusterSliderId);
    clusterLabel.textContent = "Clusters";
    const clusterSlider = document.createElement("input");
    clusterSlider.type = "range";
    clusterSlider.min = "1";
    clusterSlider.max = String(Math.max(this.points.length, 1));
    clusterSlider.value = String(this.clusterTarget);
    clusterSlider.className = "viz-topbar__slider";
    const clusterValue = document.createElement("span");
    clusterValue.className = "viz-topbar__value";
    clusterValue.textContent = `= ${this.clusterTarget}`;
    clusterSlider.addEventListener("input", (event) => {
      this.clusterTarget = Number((event.currentTarget as HTMLInputElement).value);
      const targetStep = this.findStepForClusterCount(this.clusterTarget);
      this.goToStep(targetStep);
    });
    clusterGroup.append(clusterLabel, clusterSlider, clusterValue);
    bar.appendChild(clusterGroup);

    const stepGroup = document.createElement("div");
    stepGroup.className = "viz-topbar__group viz-topbar__group--slider";
    const stepLabel = document.createElement("span");
    stepLabel.className = "viz-topbar__label";
    stepLabel.textContent = "Merge step";
    const stepSlider = document.createElement("input");
    stepSlider.type = "range";
    stepSlider.min = "0";
    stepSlider.max = String(Math.max(this.history.length - 1, 0));
    stepSlider.value = String(this.stepIndex);
    stepSlider.className = "viz-topbar__slider";
    stepSlider.id = stepSliderId;
    const stepValue = document.createElement("span");
    stepValue.className = "viz-topbar__value";
    stepValue.textContent = `${this.stepIndex}`;
    stepSlider.addEventListener("input", (event) => {
      this.stopPlay();
      const value = Number((event.currentTarget as HTMLInputElement).value);
      this.goToStep(value);
    });
    stepGroup.append(stepLabel, stepSlider, stepValue);
    bar.appendChild(stepGroup);

    const distributionGroup = document.createElement("div");
    distributionGroup.className = "viz-topbar__group";
    const distributionLabel = document.createElement("label");
    distributionLabel.className = "viz-topbar__label";
    distributionLabel.setAttribute("for", distributionSelectId);
    distributionLabel.textContent = "Distribution";
    const distributionSelect = document.createElement("select");
    distributionSelect.id = distributionSelectId;
    distributionSelect.className = "viz-topbar__select";
    [
      { value: "gaussian", text: "Gaussian" },
      { value: "uniform", text: "Uniform" },
      { value: "rings", text: "Rings" },
      { value: "grid", text: "Grid" },
    ].forEach((option) => {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.text;
      if (option.value === this.distribution) opt.selected = true;
      distributionSelect.appendChild(opt);
    });
    distributionSelect.addEventListener("change", (event) => {
      this.stopPlay();
      this.distribution = (event.currentTarget as HTMLSelectElement).value as Distribution;
      this.generatePoints();
      this.recomputeHierarchy(`Distribution switched to ${this.distribution}.`);
    });
    distributionGroup.append(distributionLabel, distributionSelect);
    bar.appendChild(distributionGroup);

    const actions = document.createElement("div");
    actions.className = "viz-topbar__actions";

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.textContent = "Prev";
    prevBtn.className = "viz-topbar__button";
    prevBtn.addEventListener("click", () => {
      this.stopPlay();
      this.goToStep(this.stepIndex - 1);
    });

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.textContent = "Next";
    nextBtn.className = "viz-topbar__button";
    nextBtn.addEventListener("click", () => {
      this.stopPlay();
      this.goToStep(this.stepIndex + 1);
    });

    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.textContent = "Play";
    playBtn.className = "viz-topbar__button";
    playBtn.addEventListener("click", () => {
      if (this.playTimer != null) {
        this.stopPlay();
      } else {
        this.startPlay();
      }
    });

    const regenerateBtn = document.createElement("button");
    regenerateBtn.type = "button";
    regenerateBtn.textContent = "Regenerate";
    regenerateBtn.className = "viz-topbar__button";
    regenerateBtn.addEventListener("click", () => {
      this.stopPlay();
      this.generatePoints();
      this.recomputeHierarchy("Dataset regenerated. Follow the new merge history.");
    });

    actions.append(prevBtn, nextBtn, playBtn, regenerateBtn);
    bar.appendChild(actions);

    host.appendChild(bar);
    this.controls = bar;
    this.clusterSlider = clusterSlider;
    this.clusterLabel = clusterValue;
    this.stepSlider = stepSlider;
    this.stepLabel = stepValue;
    this.playButton = playBtn;

    const canvas = this.context.canvas;
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("pointerleave", this.handlePointerUp);

    this.updateControlsUI();
  }
  private updateControlsUI() {
    const current = this.history[this.stepIndex];
    if (this.clusterLabel && current) {
      this.clusterLabel.textContent = `Clusters: ${current.clusters.length}`;
    }
    if (this.clusterSlider && current) {
      this.clusterSlider.min = "1";
      this.clusterSlider.max = String(this.points.length);
      this.clusterSlider.value = String(current.clusters.length);
    }
    if (this.stepSlider) {
      this.stepSlider.max = String(Math.max(this.history.length - 1, 0));
      this.stepSlider.value = String(this.stepIndex);
    }
    if (this.stepLabel) {
      this.stepLabel.textContent = `step ${this.stepIndex} / ${Math.max(this.history.length - 1, 0)}`;
    }
    if (this.playButton) {
      this.playButton.textContent = this.playTimer != null ? "Pause" : "Play";
    }
  }

  private startPlay() {
    if (this.playTimer != null) return;
    const tick = () => {
      if (this.stepIndex >= this.history.length - 1) {
        this.stopPlay();
        return;
      }
      this.goToStep(this.stepIndex + 1);
      this.playTimer = window.setTimeout(tick, 800);
    };
    this.playTimer = window.setTimeout(tick, 0);
    this.updateControlsUI();
  }

  private stopPlay() {
    if (this.playTimer != null) {
      window.clearTimeout(this.playTimer);
      this.playTimer = null;
      this.updateControlsUI();
    }
  }

  private handlePointerDown = (event: PointerEvent) => {
    const pos = this.pointerFromEvent(event);
    const hit = this.points.find((point) => distance(point.x, point.y, pos.x, pos.y) < 10);
    if (hit && !event.shiftKey) {
      this.dragging = { point: hit, offsetX: hit.x - pos.x, offsetY: hit.y - pos.y };
      return;
    }
    const newPoint: HPoint = {
      id: `p-${Date.now()}`,
      x: pos.x,
      y: pos.y,
      cluster: null,
    };
    this.points.push(newPoint);
    this.pointById.set(newPoint.id, newPoint);
    this.context.pushMessage("Point added. Recompute to see how the merge history changes.");
    this.recomputeHierarchy();
  };

  private handlePointerMove = (event: PointerEvent) => {
    if (!this.dragging) return;
    const pos = this.pointerFromEvent(event);
    const { point, offsetX, offsetY } = this.dragging;
    point.x = this.clampX(pos.x + offsetX);
    point.y = this.clampY(pos.y + offsetY);
    this.render();
  };

  private handlePointerUp = () => {
    if (this.dragging) {
      this.context.pushMessage("Point moved. Recomputing merge distances...");
      this.recomputeHierarchy();
    }
    this.dragging = null;
  };

  private recomputeHierarchy(message?: string) {
    this.computeHierarchy();
    const target = this.findStepForClusterCount(this.clusterTarget);
    this.goToStep(target, false);
    if (message) {
      this.context.pushMessage(message);
    }
    this.updateControlsUI();
  }

  private findStepForClusterCount(count: number) {
    for (let i = 0; i < this.history.length; i++) {
      if (this.history[i].clusters.length === count) {
        return i;
      }
    }
    return Math.max(this.history.length - 1, 0);
  }

  private goToStep(index: number, announce = true) {
    if (!this.history.length) return;
    this.stepIndex = Math.max(0, Math.min(index, this.history.length - 1));
    this.applyStep();
    this.updateControlsUI();
    if (announce) {
      this.context.pushMessage(this.history[this.stepIndex].description);
    }
    this.render();
  }

  private applyStep() {
    const step = this.history[this.stepIndex];
    if (!step) return;
    this.points.forEach((point) => (point.cluster = null));
    step.clusters.forEach((ids, index) => {
      ids.forEach((id) => {
        const point = this.pointById.get(id);
        if (point) point.cluster = index;
      });
    });
    this.clusterTarget = step.clusters.length;
  }

  private buildHierarchyTree() {
    if (!this.root) return null;
    const convert = (node: ClusterNode): any => {
      const children = [] as any[];
      if (node.left) children.push(convert(node.left));
      if (node.right) children.push(convert(node.right));
      return {
        name: node.id,
        distance: node.distance,
        children: children.length ? children : undefined,
      };
    };
    return d3.hierarchy(convert(this.root));
  }

  private render() {
    if (!this.svg) return;
    const width = this.context.width();
    const height = this.context.height();
    const scatterWidth = this.scatterBounds.maxX - this.scatterBounds.minX;
    const scatterHeight = this.scatterBounds.maxY - this.scatterBounds.minY;

    const palette = d3.schemeTableau10;
    const color = (cluster: number | null) => (cluster == null ? "#cbd5f5" : palette[cluster % palette.length]);

    const points = this.svg.selectAll<SVGCircleElement, HPoint>("circle.point").data(this.points, (d) => d.id);
    points
      .join(
        (enter) =>
          enter
            .append("circle")
            .attr("class", "point")
            .attr("r", 6),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("cx", (d) => this.clampX(d.x))
      .attr("cy", (d) => this.clampY(d.y))
      .attr("fill", (d) => color(d.cluster))
      .attr("stroke", "#0f172a")
      .attr("stroke-width", 1.2);

    const hierarchy = this.buildHierarchyTree();
    if (!hierarchy) return;

    const dendroWidth = Math.max(160, width - scatterWidth - 80);
    const dendroHeight = scatterHeight;
    const clusterLayout = d3.cluster<any>().size([dendroHeight, dendroWidth]);
    const root = clusterLayout(hierarchy);

    const offsetX = this.scatterBounds.maxX + 24;
    const offsetY = this.scatterBounds.minY;

    const linkGenerator = d3
      .linkHorizontal<d3.HierarchyPointLink<any>, d3.HierarchyPointNode<any>>()
      .x((d) => offsetX + d.y)
      .y((d) => offsetY + d.x);

    const links = this.svg
      .selectAll<SVGPathElement, d3.HierarchyPointLink<any>>("path.link")
      .data(root.links(), (d) => `${d.source.data.name}-${d.target.data.name}`);

    links
      .join(
        (enter) =>
          enter
            .append("path")
            .attr("class", "link")
            .attr("fill", "none")
            .attr("stroke", "#94a3b8")
            .attr("stroke-width", 1),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("d", linkGenerator as any);

    const nodes = this.svg
      .selectAll<SVGCircleElement, d3.HierarchyPointNode<any>>("circle.node")
      .data(root.descendants(), (d) => d.data.name);

    nodes
      .join(
        (enter) =>
          enter
            .append("circle")
            .attr("class", "node")
            .attr("r", 3)
            .attr("fill", "#1f2937"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("cx", (d) => offsetX + d.y)
      .attr("cy", (d) => offsetY + d.x);
  }
}

export const hierarchicalDefinition: VisualizationDefinition = {
  id: "hierarchical",
  label: "Hierarchical Clustering",
  summary: "Step through agglomerative merges with a live scatter + dendrogram.",
  keywords: ["clustering", "hierarchical", "dendrogram"],
  order: 3,
  create: (context) => new HierarchicalModule(context),
};
