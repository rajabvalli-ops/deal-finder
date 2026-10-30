export type ChartPoint = { t: number; v: number };

export type StepChart = {
  /** SVG path data for a step line (a price holds until the next observation). */
  path: string;
  min: number;
  max: number;
};

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Scales time-ordered points into a step-line path inside width × height (with padding).
 * The line extends to `endT` (e.g. now) so the current price is visible.
 */
export function buildStepChart(
  points: readonly ChartPoint[],
  options: { width: number; height: number; padding?: number; endT?: number },
): StepChart | null {
  if (points.length === 0) return null;
  const pad = options.padding ?? 8;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const t0 = sorted[0]!.t;
  const t1 = Math.max(options.endT ?? sorted.at(-1)!.t, sorted.at(-1)!.t);
  const min = Math.min(...sorted.map((p) => p.v));
  const max = Math.max(...sorted.map((p) => p.v));
  const innerW = options.width - pad * 2;
  const innerH = options.height - pad * 2;

  const x = (t: number) => round(pad + (t1 === t0 ? innerW : ((t - t0) / (t1 - t0)) * innerW));
  // Equal min and max: draw a flat line through the middle.
  const y = (v: number) =>
    round(max === min ? pad + innerH / 2 : pad + ((max - v) / (max - min)) * innerH);

  let path = `M ${t1 === t0 ? round(pad) : x(t0)} ${y(sorted[0]!.v)}`;
  for (let i = 1; i < sorted.length; i++) {
    path += ` H ${x(sorted[i]!.t)} V ${y(sorted[i]!.v)}`;
  }
  path += ` H ${x(t1)}`;
  return { path, min, max };
}
