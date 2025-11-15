import { createSignal } from "solid-js";
import type { VisualizationModule } from "../lib/ml/registry";

const [activeVisualization, setActiveVisualization] = createSignal<string | null>(null);
const DEFAULT_MESSAGES: Record<string, string[]> = {
  kmeans: [
    "Use the sidebar to tune cluster count, distribution, and sample density on the fly.",
    "Randomize layouts with one click to discuss initialization sensitivity.",
    "Drag samples or centroids to show how k-means responds to manual tweaks.",
  ],
  dbscan: [
    "Adjust ε and MinPts to contrast dense clusters vs. noise.",
    "Explain core, border, and noise points by adding samples interactively.",
  ],
};

const [messages, setMessages] = createSignal<string[]>([]);
const [status, setStatus] = createSignal<"idle" | "running" | "completed">("idle");
const [activeModule, setActiveModule] = createSignal<VisualizationModule | null>(null);

export const visualizationState = {
  activeId: activeVisualization,
  messages,
  status,
  activeModule,
};

export const visualizationActions = {
  activate(id: string | null) {
    setActiveVisualization(id);
    if (!id) {
      setMessages([]);
    } else {
      setMessages(DEFAULT_MESSAGES[id] ?? []);
    }
    setStatus("idle");
  },
  pushMessage(message: string) {
    setMessages((prev) => {
      if (prev.includes(message)) return prev;
      return [message, ...prev].slice(0, 5);
    });
  },
  setStatus(state: "idle" | "running" | "completed") {
    setStatus(state);
  },
  setActiveModule(module: VisualizationModule | null) {
    setActiveModule(module);
  },
};
