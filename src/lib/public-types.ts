// Plain data shapes for the public website. Services build these from the database so that
// pages and components never see internal fields (scores, reviewers, audit data).

export type ReferenceType = "PREVIOUS" | "AVG_30" | "AVG_90";

export type PublicDealSummary = {
  slug: string;
  title: string;
  imageUrl: string | null;
  brand: string | null;
  retailer: { slug: string; name: string };
  category: { slug: string; name: string } | null;
  /** Pence. */
  dealPrice: number;
  referencePrice: number;
  referenceType: ReferenceType;
  savingAmount: number;
  discountBps: number;
  historicalLow: number | null;
  /** When the listing's price was last checked. */
  priceCheckedAt: Date | null;
  publishedAt: Date | null;
};

export type PricePoint = { observedAt: Date; price: number };

export type PublicDealDetail = PublicDealSummary & {
  /** Code for /go/[code]; null when the retailer link isn't available. Never the URL itself. */
  linkCode: string | null;
  summary: string | null;
  description: string | null;
  expiresAt: Date | null;
  product: {
    title: string;
    model: string | null;
    description: string | null;
    rating: number | null;
    reviewCount: number | null;
    availability: string;
  };
  history: PricePoint[];
  stats: {
    current: number | null;
    lowest: number | null;
    highest: number | null;
    avg7: number | null;
    avg30: number | null;
    avg90: number | null;
  };
};

export type PublicCategory = { slug: string; name: string; dealCount: number };
export type PublicRetailer = { slug: string; name: string; dealCount: number };

export const DEAL_SORTS = ["newest", "discount", "saving", "top"] as const;
export type DealSort = (typeof DEAL_SORTS)[number];

export const DEAL_SORT_LABELS: Record<DealSort, string> = {
  newest: "Newest",
  discount: "Biggest discount",
  saving: "Biggest saving",
  top: "Top picks",
};

export function parseDealSort(value: string | undefined): DealSort {
  return (DEAL_SORTS as readonly string[]).includes(value ?? "") ? (value as DealSort) : "newest";
}

/** At or within 3% of the lowest price recorded when the deal was found. */
export function isNearHistoricalLow(
  deal: Pick<PublicDealSummary, "dealPrice" | "historicalLow">,
): boolean {
  return deal.historicalLow !== null && deal.dealPrice * 100 <= deal.historicalLow * 103;
}

export function isAtHistoricalLow(
  deal: Pick<PublicDealSummary, "dealPrice" | "historicalLow">,
): boolean {
  return deal.historicalLow !== null && deal.dealPrice <= deal.historicalLow;
}

export const REFERENCE_DESCRIPTIONS: Record<ReferenceType, string> = {
  PREVIOUS: "its previous price",
  AVG_30: "its 30-day average price",
  AVG_90: "its 90-day average price",
};
