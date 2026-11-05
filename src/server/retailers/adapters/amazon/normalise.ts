import type { NormalisedAvailability, NormalisedProduct } from "../../schemas";

// Creators API item → NormalisedProduct. Every field of an Amazon item is optional, so each
// one is read defensively; ingestion validates the result again with the shared schemas.

type Text = { displayValue?: unknown };
type Money = { amount?: unknown; currency?: unknown };

export type AmazonListing = {
  price?: { money?: Money };
  availability?: { type?: unknown };
  condition?: { value?: unknown };
  isBuyBoxWinner?: unknown;
};

export type AmazonItem = {
  asin?: unknown;
  itemInfo?: {
    title?: Text;
    byLineInfo?: { brand?: Text };
    manufactureInfo?: { model?: Text };
    externalIds?: { eans?: { displayValues?: unknown } };
    features?: { displayValues?: unknown };
  };
  images?: { primary?: { large?: { url?: unknown } } };
  browseNodeInfo?: { browseNodes?: { displayName?: unknown }[] };
  customerReviews?: { count?: unknown; starRating?: { value?: unknown } };
  offersV2?: { listings?: AmazonListing[] };
};

export const ASIN = /^[A-Z0-9]{10}$/;

/** Resources requested for catalogue items (title, images, offers…) and for price checks. */
export const CATALOGUE_RESOURCES = [
  "itemInfo.title",
  "itemInfo.byLineInfo",
  "itemInfo.manufactureInfo",
  "itemInfo.externalIds",
  "itemInfo.features",
  "images.primary.large",
  "browseNodeInfo.browseNodes",
  "customerReviews.count",
  "customerReviews.starRating",
  "offersV2.listings.price",
  "offersV2.listings.availability",
  "offersV2.listings.condition",
  "offersV2.listings.isBuyBoxWinner",
] as const;

export const PRICE_RESOURCES = [
  "offersV2.listings.price",
  "offersV2.listings.availability",
  "offersV2.listings.condition",
  "offersV2.listings.isBuyBoxWinner",
] as const;

const text = (value: Text | undefined, max: number): string | null => {
  const v = value?.displayValue;
  return typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null;
};

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** The canonical product page; the affiliate tag is added when the outbound link is built. */
export function productUrl(host: string, asin: string): string {
  return `https://${host}/dp/${asin}`;
}

/** Amazon's availability types appear as IN_STOCK or InStock; both are accepted. */
function mapAvailability(type: unknown): NormalisedAvailability | null {
  if (typeof type !== "string") return null;
  switch (type.replace(/_/g, "").toLowerCase()) {
    case "instock":
      return "IN_STOCK";
    case "instockscarce":
      return "LOW_STOCK";
    case "outofstock":
    case "unavailable":
      return "OUT_OF_STOCK";
    case "preorder":
    case "availabledate":
      return "PREORDER";
    default:
      return "UNKNOWN";
  }
}

/** The offer a shopper would see: a new-condition Buy Box winner if there is one. */
function chooseListing(listings: AmazonListing[] | undefined): AmazonListing | null {
  const offers = (listings ?? []).filter((l) => {
    const condition = l.condition?.value;
    return condition === undefined || condition === "New";
  });
  return offers.find((l) => l.isBuyBoxWinner === true) ?? offers[0] ?? null;
}

/** Price (pence) and availability from an item's offers; no offer means not buyable now. */
export function offerOf(
  item: AmazonItem,
  currency: string,
): { price: number | null; availability: NormalisedAvailability } {
  const listing = chooseListing(item.offersV2?.listings);
  const money = listing?.price?.money;
  const amount = money?.amount;
  const priced =
    typeof amount === "number" &&
    Number.isFinite(amount) &&
    amount >= 0 &&
    (money?.currency === undefined || money.currency === currency);
  if (!listing || !priced) return { price: null, availability: "OUT_OF_STOCK" };
  return {
    price: Math.round(amount * 100),
    // Amazon only lists an offer it will sell; no stated type is treated as in stock.
    availability: mapAvailability(listing.availability?.type) ?? "IN_STOCK",
  };
}

/** Null for items without an ASIN or title (nothing useful to show). */
export function toNormalisedProduct(
  item: AmazonItem,
  options: { host: string; currency: string },
): NormalisedProduct | null {
  const asin = typeof item.asin === "string" && ASIN.test(item.asin) ? item.asin : null;
  const title = text(item.itemInfo?.title, 300);
  if (!asin || !title) return null;

  const { price, availability } = offerOf(item, options.currency);
  const features = strings(item.itemInfo?.features?.displayValues);
  const gtin = strings(item.itemInfo?.externalIds?.eans?.displayValues).find((e) =>
    /^\d{8,14}$/.test(e),
  );
  const image = item.images?.primary?.large?.url;
  const rating = item.customerReviews?.starRating?.value;
  const reviews = item.customerReviews?.count;
  const category = item.browseNodeInfo?.browseNodes?.[0]?.displayName;

  return {
    externalId: asin,
    title,
    brand: text(item.itemInfo?.byLineInfo?.brand, 100),
    model: text(item.itemInfo?.manufactureInfo?.model, 100),
    gtin: gtin ?? null,
    description: features.length > 0 ? features.join("\n").slice(0, 10_000) : null,
    imageUrl: typeof image === "string" && image.startsWith("https://") ? image : null,
    productUrl: productUrl(options.host, asin),
    categoryHint:
      typeof category === "string" && category.trim() ? category.trim().slice(0, 200) : null,
    currency: options.currency,
    availability,
    rating: typeof rating === "number" && rating >= 0 && rating <= 5 ? rating : null,
    reviewCount:
      Number.isSafeInteger(reviews) && (reviews as number) >= 0 ? (reviews as number) : null,
    variants: [{ externalId: asin, name: "Default", isDefault: true, price, availability }],
  };
}
