import { formatBps, formatPrice } from "./money";
import type { ReferenceType } from "./public-types";
import { formatPoundsInput, type SearchFilters } from "./validation/search";

// Wording shared by the alerts page, the admin and the matching job.

export type AlertDescription = {
  keyword: string | null;
  productTitle: string | null;
  categoryName: string | null;
  retailerName: string | null;
  maxPrice: number | null;
  minDiscountBps: number | null;
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
  return parts.filter(Boolean).join(" ");
}

/** The price condition, e.g. "£50.00 or less, 20% off or more". */
export function alertCondition(a: Pick<AlertDescription, "maxPrice" | "minDiscountBps">): string {
  const parts = [
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
  retailerName: string;
};

/** The text of an alert notification. Built from the deal engine's numbers only. */
export function alertNotificationContent(deal: MatchedDeal): { subject: string; body: string } {
  const reference = deal.referenceType === "PREVIOUS" ? "previous" : "recent average";
  return {
    subject: `Price alert: ${deal.title}`,
    body: `${deal.title} is ${formatPrice(deal.dealPrice)} at ${deal.retailerName}, ${formatBps(deal.discountBps)} below its ${reference} price.`,
  };
}

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
