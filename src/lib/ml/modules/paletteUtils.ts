import type { VisualizationContext } from "../registry";

export type RGB = [number, number, number];

export interface PaletteSwatch {
  color: string;
  fraction: number;
  count: number;
}

export interface SampledPixel {
  color: RGB;
  x: number;
  y: number;
}

export interface ImageMarker {
  x: number;
  y: number;
  color: string;
}

export interface ImagePreviewMeta {
  url: string;
  width: number;
  height: number;
  sourceName?: string;
  markers: ImageMarker[];
}

export function runColorKMeans(samples: RGB[], clusters: number, maxIterations = 12, tolerance = 1.5): PaletteSwatch[] {
  if (!samples.length || clusters < 1) return [];
  const k = Math.min(clusters, samples.length);
  if (k === 0) return [];

  const centroids: RGB[] = [];
  const used = new Set<number>();
  while (centroids.length < k) {
    const idx = Math.floor(Math.random() * samples.length);
    if (used.has(idx)) continue;
    used.add(idx);
    centroids.push([...samples[idx]] as RGB);
  }

  const assignments = new Array(samples.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    const accum = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let c = 0; c < centroids.length; c++) {
        const dist = colorDistance(sample, centroids[c]);
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      assignments[i] = best;
      const acc = accum[best];
      acc[0] += sample[0];
      acc[1] += sample[1];
      acc[2] += sample[2];
      acc[3] += 1;
    }

    let maxShift = 0;
    for (let c = 0; c < centroids.length; c++) {
      const count = accum[c][3];
      if (!count) continue;
      const next: RGB = [accum[c][0] / count, accum[c][1] / count, accum[c][2] / count];
      const shift = colorDistance(next, centroids[c]);
      if (shift > maxShift) maxShift = shift;
      centroids[c] = next;
    }

    if (maxShift < tolerance) break;
  }

  const counts = new Array(centroids.length).fill(0);
  assignments.forEach((cluster) => {
    counts[cluster] += 1;
  });

  return centroids
    .map((c, idx) => {
      const count = counts[idx] || 0;
      const fraction = count ? count / samples.length : 0;
      return {
        color: `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`,
        count,
        fraction,
      } as PaletteSwatch;
    })
    .filter((swatch) => swatch.count > 0)
    .sort((a, b) => b.count - a.count);
}

export function buildFallbackPalette(samples: RGB[], limit: number): PaletteSwatch[] {
  if (!samples.length) return [];
  const frequency = new Map<string, number>();
  for (const sample of samples) {
    const key = `${Math.round(sample[0])}|${Math.round(sample[1])}|${Math.round(sample[2])}`;
    frequency.set(key, (frequency.get(key) ?? 0) + 1);
  }
  const total = samples.length;
  return Array.from(frequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, limit))
    .map(([key, count]) => {
      const [r, g, b] = key.split("|").map((value) => Number(value));
      return {
        color: `rgb(${r}, ${g}, ${b})`,
        count,
        fraction: count / total,
      };
    });
}

export interface ExtractImageOptions {
  maxDimension?: number;
}

export async function extractImageSamples(file: File, options: ExtractImageOptions = {}) {
  const maxDimension = options.maxDimension ?? 220;
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Image load failed"));
      img.src = objectUrl;
    });

    const naturalWidth = img.naturalWidth || img.width;
    const naturalHeight = img.naturalHeight || img.height;
    const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
    const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
    const targetHeight = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    let context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      context = canvas.getContext("2d");
    }
    if (!context) throw new Error("This browser does not expose a 2D canvas context for image sampling.");
    context.drawImage(img, 0, 0, targetWidth, targetHeight);
    const { data } = context.getImageData(0, 0, targetWidth, targetHeight);

    const samples: SampledPixel[] = [];
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha < 32) continue;
      const index = i / 4;
      const x = index % targetWidth;
      const y = Math.floor(index / targetWidth);
      samples.push({
        color: [data[i], data[i + 1], data[i + 2]],
        x: x / targetWidth,
        y: y / targetHeight,
      });
    }

    const preview: ImagePreviewMeta = {
      url: canvas.toDataURL("image/png"),
      width: targetWidth,
      height: targetHeight,
      sourceName: file.name,
      markers: [],
    };

    const colors = samples.map((pixel) => pixel.color);

    return { preview, samples, colors };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function colorDistance(a: RGB, b: RGB) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}
