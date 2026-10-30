import { formatBps, formatPrice } from "./money";
import type { DealLevel, ReferenceType } from "./public-types";
import { formatPoundsInput, type SearchFilters } from "./validation/search";

// Wording shared by the alerts page, the admin and the matching job.

export type AlertDescription = {
  keyword: string | null;
  productTitle: string | null;
  categoryName: string | null;
  retailerName: string | null;
  maxPrice: number | null;
  minDiscountBps: number | null;
  minLevel: DealLevel | null;
};

/** What an alert watches, e.g. "“kettle” in Kitchen at Example Shop". */
export function alertWatching(
  a: Pick<AlertDescription, "keyword" | "productTitle" | "categoryName" | "retailerName">,
): string {
  const subject = a.productTitle ?? (a.keyword ? `“${a.keyword}”` : null);
  const parts = [
    subject && a.categoryName ? `${subject} in ${a.categoryName}` : (subject ?? a.categoryName),
    a.retailerName && `at ${a.retailerName}`,
  ];
  return parts.filter(Boolean).join(" ") || "Everything";
}

/** The price condition, e.g. "£50.00 or less, 20% off or more". */
export function alertCondition(
  a: Pick<AlertDescription, "maxPrice" | "minDiscountBps"> & { minLevel?: DealLevel | null },
): string {
  const parts = [
    a.minLevel === "PRICE_ERROR" && "Possible price errors only",
    a.minLevel === "BIG_DROP" && "Big drops and price errors only",
    a.maxPrice !== null && `${formatPrice(a.maxPrice)} or less`,
    a.minDiscountBps !== null && `${formatBps(a.minDiscountBps, 0)} off or more`,
  ];
  return parts.filter(Boolean).join(", ") || "Any new deal";
}

export type MatchedDeal = {
  title: string;
  dealPrice: number;
  discountBps: number;
  referenceType: ReferenceType;
  level: DealLevel;
  retailerName: string;
};

/** The text of an alert notification. Built from the deal engine's numbers only. */
export function alertNotificationContent(deal: MatchedDeal): { subject: string; body: string } {
  const reference = deal.referenceType === "PREVIOUS" ? "previous" : "recent average";
  const prefix = LEVEL_PREFIX[deal.level];
  const body = `${deal.title} is ${formatPrice(deal.dealPrice)} at ${deal.retailerName}, ${formatBps(deal.discountBps)} below its ${reference} price.`;
  return {
    subject: `${prefix}: ${deal.title}`,
    body:
      deal.level === "PRICE_ERROR"
        ? `${body} This may be a pricing mistake — retailers often correct or cancel these quickly.`
        : body,
  };
}

const LEVEL_PREFIX: Record<DealLevel, string> = {
  NORMAL: "Price alert",
  BIG_DROP: "Big price drop",
  PRICE_ERROR: "Possible price error",
};

/** Short public label for a deal's level, or null for an ordinary deal. */
export const DEAL_LEVEL_LABELS: Record<DealLevel, string | null> = {
  NORMAL: null,
  BIG_DROP: "Big drop",
  PRICE_ERROR: "Possible price error",
};

/**
 * "Get alerts for this search": the alerts page, prefilled with the search's keyword and
 * filters (it reads them with parseSearchParams). Sort, page and stock aren't alert criteria.
 */
export function alertHrefForSearch(filters: SearchFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.retailer) params.set("retailer", filters.retailer);
  if (filters.maxPrice !== null) params.set("max", formatPoundsInput(filters.maxPrice));
  if (filters.minDiscount !== null) params.set("discount", String(filters.minDiscount));
  const query = params.toString();
  return query ? `/alerts?${query}` : "/alerts";
}
