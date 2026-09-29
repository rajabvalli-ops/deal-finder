import type { NormalisedPriceUpdate, NormalisedProduct } from "./schemas";

/** Runtime services handed to adapters. The clock is injected so imports can be replayed. */
export type AdapterContext = {
  now: () => Date;
  env: Readonly<Record<string, string | undefined>>;
};

export type CataloguePage = { items: NormalisedProduct[]; nextCursor: string | null };

/**
 * One implementation per data source (a retailer API, an affiliate feed…). Adapters only
 * fetch and normalise; they never touch the database. See docs/ARCHITECTURE.md §6.
 */
export interface RetailerAdapter {
  readonly key: string;
  /** Hosts that product and affiliate URLs may point to. Anything else is rejected. */
  readonly allowedHosts: readonly string[];
  readonly capabilities: { catalogue: boolean; priceLookup: boolean };

  /** One page of the catalogue. Pass the returned cursor to get the next page. */
  fetchCatalogue(request: { cursor: string | null; limit: number }): Promise<CataloguePage>;

  /** Current prices for known products. Unknown IDs are omitted from the result. */
  fetchPrices(productExternalIds: readonly string[]): Promise<NormalisedPriceUpdate[]>;

  /** Outbound link for a product page, including any affiliate tracking. */
  buildAffiliateUrl(productUrl: string): string;

  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}

export type AdapterFactory = (config: unknown, context: AdapterContext) => RetailerAdapter;
