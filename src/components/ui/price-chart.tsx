import { buildStepChart } from "@/lib/chart";
import { formatPrice } from "@/lib/money";

const WIDTH = 640;
const HEIGHT = 180;

type Props = {
  observations: { observedAt: Date; price: number }[];
  /** Draw the line up to this time (e.g. now). */
  until: Date;
  label: string;
};

/** Server-rendered SVG step chart; no client JavaScript. */
export function PriceChart({ observations, until, label }: Props) {
  const chart = buildStepChart(
    observations.map((o) => ({ t: o.observedAt.getTime(), v: o.price })),
    { width: WIDTH, height: HEIGHT, padding: 12, endT: until.getTime() },
  );
  if (!chart) return <p className="text-sm text-ink-muted">No price history yet.</p>;

  return (
    <figure className="space-y-1">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}: between ${formatPrice(chart.min)} and ${formatPrice(chart.max)}`}
        className="h-40 w-full rounded-md border border-line bg-surface-muted sm:h-48"
      >
        <path
          d={chart.path}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          className="text-brand-600"
        />
      </svg>
      <figcaption className="flex justify-between text-xs text-ink-muted">
        <span>Low {formatPrice(chart.min)}</span>
        <span>High {formatPrice(chart.max)}</span>
      </figcaption>
    </figure>
  );
}
