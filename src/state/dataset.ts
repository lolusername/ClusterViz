import { createSignal } from "solid-js";
import { nanoid } from "nanoid";

export interface SharedPoint {
  id: string;
  x: number;
  y: number;
  cluster?: number | null;
}

export interface PalettePixel {
  x: number;
  y: number;
  color: string;
}

export interface SharedDataset {
  id: string;
  width: number;
  height: number;
  origin: "generator" | "image" | "manual";
  distribution?: string;
  createdAt: number;
  points: SharedPoint[];
  palettePreview?: {
    imageDataUrl: string;
    sourceName?: string;
    width: number;
    height: number;
    pixels: PalettePixel[];
  };
  paletteSwatches?: { color: string; fraction: number; count: number }[];
}

const [state, setState] = createSignal<SharedDataset | null>(null);

export const datasetState = state;

export const datasetActions = {
  save(dataset: SharedDataset) {
    setState(dataset);
  },
  updatePoints(points: SharedPoint[]) {
    const current = state();
    if (!current) return;
    setState({ ...current, points });
  },
  clear() {
    setState(null);
  },
};

export function createDataset(params: Omit<SharedDataset, "id" | "createdAt"> & { id?: string }) {
  return {
    id: params.id ?? nanoid(),
    createdAt: Date.now(),
    ...params,
  };
}
