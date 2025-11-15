import type { SharedDataset, SharedPoint } from "../state/dataset";

export function toSharedPoints<T extends { id: string; x: number; y: number; cluster?: number | null }>(
  points: readonly T[]
): SharedPoint[] {
  return points.map((point) => ({
    id: point.id,
    x: point.x,
    y: point.y,
    cluster: point.cluster ?? null,
  }));
}

export function scaleSharedPoints(points: SharedPoint[], fromWidth: number, fromHeight: number, toWidth: number, toHeight: number) {
  if (fromWidth === 0 || fromHeight === 0) return points;
  const sx = toWidth / fromWidth;
  const sy = toHeight / fromHeight;
  return points.map((point) => ({
    ...point,
    x: point.x * sx,
    y: point.y * sy,
  }));
}

export function instantiateDatasetPoints(dataset: SharedDataset, targetWidth: number, targetHeight: number) {
  return scaleSharedPoints(dataset.points, dataset.width, dataset.height, targetWidth, targetHeight);
}
