import * as d3 from "d3";

export type Distribution = "gaussian" | "uniform" | "rings" | "grid";

export interface XYPoint {
  id: string;
  x: number;
  y: number;
}

export function generatePoints(
  width: number,
  height: number,
  distribution: Distribution,
  count = 60
): XYPoint[] {
  // Generate points without hard clamping to edges to avoid "scrunching".
  // Keep a small margin but preserve the natural shape by rejection sampling.
  const M = 8; // visual margin
  const within = (x: number, y: number) => x >= M && x <= width - M && y >= M && y <= height - M;
  const sampleWithin = (fn: () => { x: number; y: number }) => {
    for (let i = 0; i < 8; i++) {
      const { x, y } = fn();
      if (within(x, y)) return { x, y };
    }
    const { x, y } = fn();
    return { x: Math.max(M, Math.min(width - M, x)), y: Math.max(M, Math.min(height - M, y)) };
  };
  switch (distribution) {
    case "uniform":
      return Array.from({ length: count }).map((_, index) => ({
        id: `p-${index}-${crypto.randomUUID()}`,
        x: M + Math.random() * (width - 2 * M),
        y: M + Math.random() * (height - 2 * M),
      }));
    case "rings": {
      const rings = 3;
      return Array.from({ length: count }).map((_, index) => {
        const ring = index % rings;
        const radius = ((ring + 1) / rings) * Math.min(width, height) * 0.45;
        const angle = Math.random() * Math.PI * 2;
        const noise = radius * 0.08;
        const { x, y } = sampleWithin(() => {
          const r = radius + (Math.random() - 0.5) * noise;
          return {
            x: width / 2 + Math.cos(angle) * r,
            y: height / 2 + Math.sin(angle) * r,
          };
        });
        return { id: `p-${index}-${crypto.randomUUID()}`, x, y };
      });
    }
    case "grid": {
      const cols = Math.round(Math.sqrt(count));
      const rows = cols;
      const spacingX = (width - 2 * M) / (cols + 1);
      const spacingY = (height - 2 * M) / (rows + 1);
      const points: XYPoint[] = [];
      for (let r = 1; r <= rows; r++) {
        for (let c = 1; c <= cols; c++) {
          if (points.length >= count) break;
          const baseX = M + c * spacingX;
          const baseY = M + r * spacingY;
          const jitterX = (Math.random() - 0.5) * spacingX * 0.2;
          const jitterY = (Math.random() - 0.5) * spacingY * 0.2;
          points.push({
            id: `p-${points.length}-${crypto.randomUUID()}`,
            x: baseX + jitterX,
            y: baseY + jitterY,
          });
        }
      }
      return points;
    }
    case "gaussian":
    default: {
      const clusters = Math.round(Math.random() * 5 + 2);
      const centers = Array.from({ length: clusters }).map(() => ({
        x: M + Math.random() * (width - 2 * M),
        y: M + Math.random() * (height - 2 * M),
      }));
      const gaussian = d3.randomNormal.source(d3.randomLcg(Date.now()));
      return Array.from({ length: count }).map((_, index) => {
        const center = centers[index % centers.length];
        const deviation = Math.min(width, height) * 0.08;
        const { x, y } = sampleWithin(() => ({
          x: center.x + gaussian(0, deviation)(),
          y: center.y + gaussian(0, deviation)(),
        }));
        return { id: `p-${index}-${crypto.randomUUID()}`, x, y };
      });
    }
  }
}

export function distance(x1: number, y1: number, x2: number, y2: number) {
  return Math.hypot(x1 - x2, y1 - y2);
}

export function shuffle<T>(values: T[]) {
  return d3.shuffle([...values], d3.randomLcg(Date.now()));
}
