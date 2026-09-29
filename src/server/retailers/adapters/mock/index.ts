import { z } from "zod";
import type { NormalisedPriceUpdate } from "../../schemas";
import type { AdapterContext, RetailerAdapter } from "../../types";
import { MOCK_HOST, mockProductSpecs, toNormalisedProduct } from "./catalogue";

const configSchema = z.object({
  /** Number of fictional products in the catalogue. */
  productCount: z.int().min(1).max(1000).default(24),
});

/** Development-only adapter serving a deterministic fictional catalogue. Makes no network calls. */
export function createMockRetailerAdapter(
  config: unknown,
  context: AdapterContext,
): RetailerAdapter {
  const { productCount } = configSchema.parse(config);
  const specs = mockProductSpecs(productCount);
  const byId = new Map(specs.map((s) => [s.id, s]));

  return {
    key: "mock",
    allowedHosts: [MOCK_HOST],
    capabilities: { catalogue: true, priceLookup: true },

    async fetchCatalogue({ cursor, limit }) {
      const start = cursor === null ? 0 : Number.parseInt(cursor, 10);
      if (!Number.isSafeInteger(start) || start < 0) throw new Error(`Invalid cursor: ${cursor}`);
      const now = context.now();
      const items = specs.slice(start, start + limit).map((s) => toNormalisedProduct(s, now));
      const next = start + limit;
      return { items, nextCursor: next < specs.length ? String(next) : null };
    },

    async fetchPrices(productExternalIds) {
      const now = context.now();
      return productExternalIds.flatMap((id): NormalisedPriceUpdate[] => {
        const spec = byId.get(id);
        if (!spec) return [];
        const product = toNormalisedProduct(spec, now);
        return [
          {
            productExternalId: id,
            currency: product.currency,
            variants: product.variants.map(({ externalId, price, availability }) => ({
              externalId,
              price,
              availability,
            })),
          },
        ];
      });
    },

    buildAffiliateUrl(productUrl) {
      const url = new URL(productUrl);
      url.searchParams.set("ref", "mock-affiliate");
      return url.toString();
    },

    async healthCheck() {
      return { ok: true, detail: `${specs.length} fictional products` };
    },
  };
}
