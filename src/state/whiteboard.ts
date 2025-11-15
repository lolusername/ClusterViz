import { createStore } from "solid-js/store";
import { nanoid } from "nanoid";

export type ToolId =
  | "pen"
  | "eraser"
  | "line"
  | "rectangle"
  | "ellipse"
  | "arrow"
  | "text";

export interface Point {
  x: number;
  y: number;
}

export interface PathAction {
  id: string;
  tool: ToolId;
  color: string;
  fill: string;
  weight: number;
  points: Point[];
  meta?: Record<string, unknown>;
}

export interface LayerState {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  actions: PathAction[];
}

export interface WhiteboardState {
  tool: ToolId;
  strokeColor: string;
  fillColor: string;
  weight: number;
  layers: LayerState[];
  activeLayerId: string;
  history: { layerId: string; action: PathAction }[];
  redo: { layerId: string; action: PathAction }[];
  showGrid: boolean;
  showAxes: boolean;
  pendingText: { position: Point } | null;
  interactionMode: "whiteboard" | "visualization" | "annotate";
  activeVisualization: string | null;
}

const baseLayer = (): LayerState => ({
  id: nanoid(),
  name: "Layer 1",
  visible: true,
  locked: false,
  actions: [],
});

const initialLayer = baseLayer();

const [state, setState] = createStore<WhiteboardState>({
  tool: "pen",
  strokeColor: "#0f172a",
  fillColor: "transparent",
  weight: 4,
  layers: [initialLayer],
  activeLayerId: initialLayer.id,
  history: [],
  redo: [],
  showGrid: false,
  showAxes: false,
  pendingText: null,
  interactionMode: "visualization",
  activeVisualization: null,
});

export const whiteboardState = state;

function withActiveLayer(handler: (layer: LayerState, index: number) => void) {
  const idx = state.layers.findIndex((layer) => layer.id === state.activeLayerId);
  if (idx < 0) return;
  handler(state.layers[idx], idx);
}

export const whiteboardActions = {
  setTool(tool: ToolId) {
    setState({ tool });
  },
  setStrokeColor(color: string) {
    setState({ strokeColor: color });
  },
  setFillColor(color: string) {
    setState({ fillColor: color });
  },
  setWeight(weight: number) {
    setState({ weight });
  },
  pushAction(action: PathAction) {
    withActiveLayer((layer) => {
      setState("layers", (l) => l.id === layer.id, "actions", (prev) => [...prev, action]);
      setState("history", (history) => [...history, { layerId: layer.id, action }]);
      setState({ redo: [] });
    });
  },
  undo() {
    if (!state.history.length) return;
    const history = state.history.slice();
    const last = history.pop();
    if (!last) return;
    setState({ history });
    setState("layers", (layer) => layer.id === last.layerId, "actions", (actions) =>
      actions.filter((action) => action.id !== last.action.id)
    );
    setState("redo", (redo) => [...redo, last]);
  },
  redo() {
    if (!state.redo.length) return;
    const redo = state.redo.slice();
    const next = redo.pop();
    if (!next) return;
    setState({ redo });
    setState("layers", (layer) => layer.id === next.layerId, "actions", (actions) => [
      ...actions,
      next.action,
    ]);
    setState("history", (history) => [...history, next]);
  },
  createLayer(name?: string) {
    const layer: LayerState = {
      id: nanoid(),
      name: name || `Layer ${state.layers.length + 1}`,
      visible: true,
      locked: false,
      actions: [],
    };
    setState("layers", (layers) => [...layers, layer]);
    setState({ activeLayerId: layer.id });
  },
  selectLayer(id: string) {
    setState({ activeLayerId: id });
  },
  toggleLayerVisibility(id: string) {
    setState("layers", (layer) => layer.id === id, "visible", (visible) => !visible);
  },
  toggleLayerLock(id: string) {
    setState("layers", (layer) => layer.id === id, "locked", (locked) => !locked);
  },
  removeLayer(id: string) {
    if (state.layers.length === 1) return;
    const remaining = state.layers.filter((layer) => layer.id !== id);
    setState({ layers: remaining, activeLayerId: remaining[remaining.length - 1].id });
  },
  moveLayer(id: string, direction: "up" | "down") {
    const idx = state.layers.findIndex((layer) => layer.id === id);
    if (idx < 0) return;
    const target = direction === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= state.layers.length) return;
    const layers = state.layers.slice();
    const [removed] = layers.splice(idx, 1);
    layers.splice(target, 0, removed);
    setState({ layers });
  },
  setPendingText(point: Point | null) {
    setState({ pendingText: point ? { position: point } : null });
  },
  setInteractionMode(mode: WhiteboardState["interactionMode"]) {
    setState({ interactionMode: mode });
  },
  setActiveVisualization(id: string | null) {
    setState({ activeVisualization: id });
  },
  clearLayer(id: string) {
    setState("layers", (layer) => layer.id === id, { actions: [] });
    setState({ history: state.history.filter((item) => item.layerId !== id) });
    setState({ redo: state.redo.filter((item) => item.layerId !== id) });
  },
};

export function createAction(tool: ToolId, overrides: Partial<PathAction> = {}): PathAction {
  return {
    id: nanoid(),
    tool,
    color: state.strokeColor,
    fill: state.fillColor,
    weight: state.weight,
    points: [],
    ...overrides,
  };
}
