import type { LayerState, PathAction, Point, ToolId, WhiteboardState } from "../../state/whiteboard";

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  getState: () => WhiteboardState;
  onRequestText: (point: Point) => void;
  onCommit: (layerId: string, action: PathAction) => void;
}

interface PointerState {
  pointerId: number;
  action: PathAction | null;
  start: Point | null;
  moved: boolean;
}

export class WhiteboardEngine {
  private canvas: HTMLCanvasElement;
  private overlay: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private overlayCtx: CanvasRenderingContext2D;
  private getState: () => WhiteboardState;
  private onRequestText: (point: Point) => void;
  private onCommit: (layerId: string, action: PathAction) => void;
  private pointer: PointerState = { pointerId: -1, action: null, start: null, moved: false };
  private layerContexts = new Map<string, CanvasRenderingContext2D>();
  private disposed = false;

  constructor(options: EngineOptions) {
    this.canvas = options.canvas;
    this.overlay = options.overlay;
    const ctx = this.canvas.getContext("2d");
    const overlayCtx = this.overlay.getContext("2d");
    if (!ctx || !overlayCtx) {
      throw new Error("Unable to acquire canvas contexts");
    }
    this.ctx = ctx;
    this.overlayCtx = overlayCtx;
    this.getState = options.getState;
    this.onRequestText = options.onRequestText;
    this.onCommit = options.onCommit;
    this.setupEvents();
  }

  destroy() {
    this.disposed = true;
    this.canvas.onpointerdown = null;
    this.canvas.onpointermove = null;
    this.canvas.onpointerup = null;
    this.canvas.onpointercancel = null;
  }

  setSize(width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.overlay.width = width;
    this.overlay.height = height;
    this.layerContexts.forEach((ctx) => {
      ctx.canvas.width = width;
      ctx.canvas.height = height;
    });
    this.render();
  }

  syncLayers(layers: LayerState[]) {
    // ensure contexts exist
    const ids = new Set(layers.map((layer) => layer.id));
    layers.forEach((layer) => {
      if (!this.layerContexts.has(layer.id)) {
        const canvas = document.createElement("canvas");
        canvas.width = this.canvas.width;
        canvas.height = this.canvas.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        this.layerContexts.set(layer.id, ctx);
        this.redrawLayer(layer);
      } else {
        this.redrawLayer(layer);
      }
    });
    // cleanup removed layers
    [...this.layerContexts.keys()].forEach((id) => {
      if (!ids.has(id)) {
        this.layerContexts.delete(id);
      }
    });
    this.render();
  }

  redrawLayer(layer: LayerState) {
    const ctx = this.layerContexts.get(layer.id);
    if (!ctx) return;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    layer.actions.forEach((action) => {
      this.drawAction(ctx, action, false);
    });
  }

  render() {
    const state = this.getState();
    this.ctx.save();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (state.showGrid) {
      this.drawGrid();
    }
    if (state.showAxes) {
      this.drawAxes();
    }
    state.layers.forEach((layer) => {
      if (!layer.visible) return;
      const layerCtx = this.layerContexts.get(layer.id);
      if (!layerCtx) return;
      this.ctx.drawImage(layerCtx.canvas, 0, 0);
    });
    this.ctx.restore();
  }

  private drawGrid() {
    const spacing = 40;
    this.ctx.save();
    this.ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
    this.ctx.lineWidth = 1;
    for (let x = 0; x < this.canvas.width; x += spacing) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.canvas.height);
      this.ctx.stroke();
    }
    for (let y = 0; y < this.canvas.height; y += spacing) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvas.width, y);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  private drawAxes() {
    this.ctx.save();
    this.ctx.strokeStyle = "rgba(37, 99, 235, 0.4)";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(0, this.canvas.height / 2);
    this.ctx.lineTo(this.canvas.width, this.canvas.height / 2);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.moveTo(this.canvas.width / 2, 0);
    this.ctx.lineTo(this.canvas.width / 2, this.canvas.height);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private setupEvents() {
    this.canvas.onpointerdown = (event) => this.handlePointerDown(event);
    this.canvas.onpointermove = (event) => this.handlePointerMove(event);
    this.canvas.onpointerup = (event) => this.handlePointerUp(event);
    this.canvas.onpointercancel = (event) => this.handlePointerUp(event);
  }

  private pointerPosition(event: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  private handlePointerDown(event: PointerEvent) {
    if (this.disposed) return;
    const state = this.getState();
    const layer = state.layers.find((layer) => layer.id === state.activeLayerId);
    if (!layer || layer.locked) return;
    if (state.interactionMode !== "whiteboard") return;

    this.canvas.setPointerCapture(event.pointerId);
    const tool = state.tool;
    const pos = this.pointerPosition(event);
    this.pointer = {
      pointerId: event.pointerId,
      action: null,
      start: pos,
      moved: false,
    };

    if (tool === "text") {
      this.onRequestText(pos);
      return;
    }
    // notes removed

    const action: PathAction = {
      id: crypto.randomUUID(),
      tool,
      color: state.strokeColor,
      fill: state.fillColor,
      weight: state.weight,
      points: [pos],
    };
    this.pointer.action = action;
    this.overlayCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.pointer.moved = false;
  }

  private handlePointerMove(event: PointerEvent) {
    if (this.disposed) return;
    if (this.pointer.pointerId !== event.pointerId) return;
    const action = this.pointer.action;
    if (!action) return;
    const pos = this.pointerPosition(event);
    action.points.push(pos);
    this.pointer.moved = true;
    this.overlayCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.drawAction(this.overlayCtx, action, true);
  }

  private handlePointerUp(event: PointerEvent) {
    if (this.disposed) return;
    if (this.pointer.pointerId !== event.pointerId) return;
    this.canvas.releasePointerCapture(event.pointerId);
    const action = this.pointer.action;
    const state = this.getState();
    const layer = state.layers.find((layer) => layer.id === state.activeLayerId);
    if (action && layer) {
      if (!this.pointer.moved && (action.tool === "line" || action.tool === "rectangle" || action.tool === "ellipse" || action.tool === "arrow")) {
        action.points.push({ ...action.points[0] });
      }
      const ctx = this.layerContexts.get(layer.id);
      if (ctx) {
        this.overlayCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
        this.drawAction(ctx, action, false);
        this.onCommit(layer.id, action);
        this.render();
      }
    }
    this.pointer = { pointerId: -1, action: null, start: null, moved: false };
  }

  private drawAction(ctx: CanvasRenderingContext2D, action: PathAction, preview: boolean) {
    if (!action.points.length) return;
    const strokeColor = action.color;
    const fillColor = action.fill;
    const weight = action.weight;

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    switch (action.tool) {
      case "pen":
      case "highlighter": {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = weight;
        if (action.tool === "highlighter") {
          ctx.globalAlpha = 0.35;
        }
        ctx.beginPath();
        action.points.forEach((point, index) => {
          if (index === 0) {
            ctx.moveTo(point.x, point.y);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        });
        ctx.stroke();
        break;
      }
      case "eraser": {
        ctx.globalCompositeOperation = "destination-out";
        ctx.lineWidth = weight;
        ctx.beginPath();
        action.points.forEach((point, index) => {
          if (index === 0) {
            ctx.moveTo(point.x, point.y);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        });
        ctx.stroke();
        break;
      }
      case "line": {
        const start = action.points[0];
        const end = action.points[action.points.length - 1];
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = weight;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        break;
      }
      case "rectangle":
      case "ellipse": {
        const start = action.points[0];
        const end = action.points[action.points.length - 1];
        const width = end.x - start.x;
        const height = end.y - start.y;
        ctx.lineWidth = weight;
        ctx.strokeStyle = strokeColor;
        if (fillColor && fillColor !== "transparent") {
          ctx.fillStyle = fillColor;
        }
        if (action.tool === "rectangle") {
          if (fillColor && fillColor !== "transparent") {
            ctx.fillRect(start.x, start.y, width, height);
          }
          ctx.strokeRect(start.x, start.y, width, height);
        } else {
          const centerX = start.x + width / 2;
          const centerY = start.y + height / 2;
          ctx.beginPath();
          ctx.ellipse(centerX, centerY, Math.abs(width / 2), Math.abs(height / 2), 0, 0, Math.PI * 2);
          if (fillColor && fillColor !== "transparent") {
            ctx.fill();
          }
          ctx.stroke();
        }
        break;
      }
      case "arrow": {
        const start = action.points[0];
        const end = action.points[action.points.length - 1];
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const headLength = Math.max(10, weight * 2.5);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = weight;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(
          end.x - headLength * Math.cos(angle - Math.PI / 6),
          end.y - headLength * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          end.x - headLength * Math.cos(angle + Math.PI / 6),
          end.y - headLength * Math.sin(angle + Math.PI / 6)
        );
        ctx.lineTo(end.x, end.y);
        ctx.fillStyle = strokeColor;
        ctx.fill();
        break;
      }
      case "text": {
        if (!action.meta?.text) break;
        const start = action.points[0];
        ctx.fillStyle = strokeColor;
        ctx.font = `${action.meta?.fontSize || 18}px Inter, sans-serif`;
        ctx.fillText(String(action.meta.text), start.x, start.y);
        break;
      }
      
      default:
        break;
    }
    ctx.restore();
  }
}

if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, width, height, radius) {
    const r = typeof radius === "number" ? radius : 0;
    this.beginPath();
    this.moveTo(x + r, y);
    this.lineTo(x + width - r, y);
    this.quadraticCurveTo(x + width, y, x + width, y + r);
    this.lineTo(x + width, y + height - r);
    this.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    this.lineTo(x + r, y + height);
    this.quadraticCurveTo(x, y + height, x, y + height - r);
    this.lineTo(x, y + r);
    this.quadraticCurveTo(x, y, x + r, y);
    this.closePath();
    return this;
  } as typeof CanvasRenderingContext2D.prototype.roundRect;
}
