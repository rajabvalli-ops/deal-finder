import { site } from "@/lib/site";

export function AffiliateDisclosure({ compact = false }: { compact?: boolean }) {
  const text = `${site.name} may earn a commission if you buy through links on this site. It doesn't change the price you pay, and deals are chosen by price history, not by commission.`;
  if (compact) return <p className="text-xs text-ink-muted">{text}</p>;
  return (
    <aside
      aria-label="Affiliate disclosure"
      className="rounded-lg border border-line bg-surface-muted p-4 text-sm text-ink-muted"
    >
      <strong className="text-ink">How we make money.</strong> {text}
    </aside>
  );
}
