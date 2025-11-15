export interface VisualizationContext {
  canvas: HTMLCanvasElement;
  overlay: HTMLDivElement;
  controlsHost: HTMLDivElement;
  requestRender: () => void;
  width: () => number;
  height: () => number;
  pushMessage: (message: string) => void;
}

export interface VisualizationDefinition {
  id: string;
  label: string;
  summary: string;
  keywords: string[];
  order: number;
  create: (context: VisualizationContext) => VisualizationModule;
}

export interface VisualizationModule {
  resize?(width: number, height: number): void;
  destroy?(): void;
  start(): void;
  stop(): void;
}

const registry = new Map<string, VisualizationDefinition>();

export function register(definition: VisualizationDefinition) {
  registry.set(definition.id, definition);
}

export function list() {
  return Array.from(registry.values()).sort((a, b) => a.order - b.order);
}

export function get(id: string) {
  return registry.get(id);
}
